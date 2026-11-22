// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { calculateEnvironmentSensorPhotoSignal, resolveLensSampledPsf } from "../src/index.js";
import { executeEnvironmentSensorPhotoSignal, planEnvironmentSensorPhotoSignal } from "../src/sensor/environment-photo-signal.js";
import { markEngineOwnedLensSampledPsfProfile } from "../src/optics/lens-psf-profile.js";
import { siteInput, evaluator } from "./helpers/environment-raw-fixture.js";
import { psfInput } from "./helpers/psf-quadrature-fixture.js";

it.each([false, true])("photo-only retention keeps the identical photo result and drops only per-evaluation records (psf=%s)", psf => {
  const { evaluateRadiance, ...data } = siteInput(undefined, psf);
  const full = executeEnvironmentSensorPhotoSignal(planEnvironmentSensorPhotoSignal(data), evaluateRadiance);
  const lean = executeEnvironmentSensorPhotoSignal(planEnvironmentSensorPhotoSignal(data), evaluateRadiance, undefined, "photo-only");
  expect(lean.value.photo).toEqual(full.value.photo);
  expect(lean.value.instants.map(i => i.evaluations)).toEqual(full.value.instants.map(() => []));
  expect(lean.value.instants.map(({ evaluations, ...rest }) => { void evaluations; return rest; }))
    .toEqual(full.value.instants.map(({ evaluations, ...rest }) => { void evaluations; return rest; }));
  expect(full.value.instants.every(i => i.evaluations.length > 0)).toBe(true);
});

it("copies caller input by default and adopts an engine-owned clone without copying", () => {
  const { evaluateRadiance, ...data } = siteInput();void evaluateRadiance;
  const copied = planEnvironmentSensorPhotoSignal(data);
  expect(copied.owned).not.toBe(data);
  if (data.psf.kind !== "sampled-local") throw Error("fixture");
  expect(Object.isFrozen(data.psf.configuration.psf.profile)).toBe(false);
  const owned = structuredClone(data), adopted = planEnvironmentSensorPhotoSignal(owned, "engine-owned");
  expect(adopted.owned).toBe(owned);
  expect(adopted.instants).toEqual(copied.instants);
});

it("hands supplied code one immutable planned request per evaluation", () => {
  const input = siteInput();
  input.evaluateRadiance = (q): ReturnType<typeof evaluator> => { expect(Object.isFrozen(q)).toBe(true);
    expect(Object.isFrozen(q.target)).toBe(true); expect(() => { (q as { sampleId: string }).sampleId = "x"; }).toThrow(TypeError); return evaluator(q); };
  calculateEnvironmentSensorPhotoSignal(input);
});

it("re-parses caller PSF profiles on every resolve and caches only registered engine-owned profiles", () => {
  const p = psfInput().psf, query = { ...p, wavelengthNm: 450, fieldPointMm: { x: 0, y: 0 } };
  const before = resolveLensSampledPsf(query).value.kernel.normalizedIntensity;
  const changed = structuredClone(p.profile);
  for (const node of changed.nodes) node.kernel.normalizedIntensity = node.kernel.normalizedIntensity.map((_, i) => i === 4 ? 1 : 0);
  expect(resolveLensSampledPsf({ ...query, profile: changed }).value.kernel.normalizedIntensity).not.toEqual(before);
  const owned = structuredClone(p.profile);
  markEngineOwnedLensSampledPsfProfile(owned);
  const first = resolveLensSampledPsf({ ...query, profile: owned });
  expect(first.value.kernel.normalizedIntensity).toEqual(before);
  expect(Object.isFrozen(owned)).toBe(true);
  expect(Object.isFrozen(owned.nodes[0]!.kernel.normalizedIntensity)).toBe(true);
  expect(resolveLensSampledPsf({ ...query, profile: owned })).toEqual(first);
  const invalid = structuredClone(p.profile) as unknown as Record<string, unknown>;
  invalid.schemaVersion = "9";
  markEngineOwnedLensSampledPsfProfile(invalid);
  expect(() => resolveLensSampledPsf({ ...query, profile: invalid as unknown as typeof p.profile })).toThrow("lensPsfProfile.schemaVersion");
  expect(Object.isFrozen(invalid)).toBe(false);
});

it("rejects a null sensor record with a domain error (sensor-11, #701)", () => {
  const data: Record<string, unknown> = { ...siteInput(undefined, false) }; delete data.evaluateRadiance;
  expect(() => planEnvironmentSensorPhotoSignal({ ...data, sensor: null } as never)).toThrow(expect.objectContaining({ name: "InvalidScientificInputError" }));
});
