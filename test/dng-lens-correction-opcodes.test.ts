// SPDX-License-Identifier: Apache-2.0

/**
 * #587: `output.dng.lensCorrectionOpcodes`, the catalogue lens's corrections as optional DNG opcodes in OpcodeList3. Each switches
 * on alone; none gives the same DNG bytes; the RAW codes never change; the opcodes, read back with an independent parser that follows
 * the DNG specification's opcode list layout and equations, reproduce the profile's mapping (exactly) and gain (#584, within 0.1 %)
 * on a barrel and a pincushion lens; the DNG still parses.
 */
import { describe, expect, it } from "vitest";
import {
  calculatePeripheralIlluminationCorrection, createGenericLensCorrectionProfile, GENERIC_LENS_CATALOGUE, InvalidConfigurationError, parseDngRawImage,
  resolveGenericLens, serializeNativeRawDng, serializeSimulatedCaptureDngFromParts, simulateCapture, type IlluminationLensCorrection, type SimulateCaptureOptions,
  type SimulateCaptureResult
} from "../src/index.js";
import { createDngLensCorrectionOpcodes, DNG_VIGNETTE_FIT_TOLERANCE } from "../src/capture/dng-lens-correction-opcodes.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { genericLensDispersion } from "../src/equipment/generic-lens-catalogue.js";

/** D at the generic channel wavelengths (createGenericLensCorrectionProfile's default channel dispersion). */
const GENERIC_CHANNELS = { red: genericLensDispersion(610), green: genericLensDispersion(540), blue: genericLensDispersion(465) };

type Selection = { distortion?: boolean; lateralColor?: boolean; vignetting?: boolean };
const ALL = { distortion: true, lateralColor: true, vignetting: true };
const W = 48, H = 32, PITCH_MM = 0.75, AREA = { widthMm: W * PITCH_MM, heightMm: H * PITCH_MM };
const checks = { preset: "checkerboard" as const, squaresAcross: 24, darkReflectance: 0.1, lightReflectance: 0.8 };
function options(lensId: string, fNumber: number, dng?: { lensCorrectionOpcodes?: Selection }, lensCorrections?: Selection): SimulateCaptureOptions {
  return { scene: checks, subjectDistanceM: 5, fast: true, lens: { catalogue: lensId, fNumber }, exposure: { mode: "manual", shutterSeconds: 1 / 4000, iso: 100 },
    sensor: { pixelPitchMicrometers: PITCH_MM * 1000, spectralStepNanometers: 50 },
    output: { width: W, height: H, format: "dng", ...(dng ? { dng } : {}), ...(lensCorrections ? { lensCorrections } : {}) } };
}

/** A DNG opcode as an independent reader decodes it (DNG specification, "Opcode List Processing"; big-endian). */
interface Opcode { id: number; version: number[]; flags: number; params: DataView }
/** Finds a little-endian TIFF IFD0 tag and returns its type and bytes. */
function ifd0Tag(bytes: Uint8Array, id: number): { type: number; data: Uint8Array } | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), ifd = v.getUint32(4, true), n = v.getUint16(ifd, true);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (v.getUint16(e, true) !== id) continue;
    const type = v.getUint16(e + 2, true), count = v.getUint32(e + 4, true), size = count * ([0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8][type] ?? 1);
    const at = size <= 4 ? e + 8 : v.getUint32(e + 8, true);
    return { type, data: bytes.slice(at, at + size) };
  }
  return null;
}
function opcodeList(bytes: Uint8Array): Opcode[] {
  const tag = ifd0Tag(bytes, 51022);
  if (!tag) return [];
  expect(tag.type).toBe(7);
  const v = new DataView(tag.data.buffer), out: Opcode[] = [];
  let at = 4;
  for (let i = 0; i < v.getUint32(0); i++) {
    const size = v.getUint32(at + 12);
    out.push({ id: v.getUint32(at), version: Array.from(tag.data.slice(at + 4, at + 8)), flags: v.getUint32(at + 8), params: new DataView(tag.data.buffer, at + 16, size) });
    at += 16 + size;
  }
  expect(at).toBe(tag.data.length);
  return out;
}
/** FixVignetteRadial's gain at normalized radius r (spec: g = 1 + k0r² + k1r⁴ + k2r⁶ + k3r⁸ + k4r¹⁰). */
function vignetteGain(o: Opcode, r: number): number {
  expect(o.params.byteLength).toBe(56);
  const k = [0, 1, 2, 3, 4].map((i) => o.params.getFloat64(i * 8)), t = r * r;
  expect([o.params.getFloat64(40), o.params.getFloat64(48)]).toEqual([0.5, 0.5]);
  return 1 + k[0]! * t + k[1]! * t ** 2 + k[2]! * t ** 3 + k[3]! * t ** 4 + k[4]! * t ** 5;
}
/** WarpRectilinear's source point (pixels from the centre) for a destination point p, plane c (spec equations, tangential terms included). */
function warpSource(o: Opcode, c: number, px: number, py: number, width: number, height: number): [number, number] {
  const planes = o.params.getUint32(0);
  expect(o.params.byteLength).toBe(4 + planes * 48 + 16);
  const base = 4 + (planes === 1 ? 0 : c) * 48, [kr0, kr1, kr2, kr3, kt0, kt1] = [0, 1, 2, 3, 4, 5].map((i) => o.params.getFloat64(base + i * 8)) as number[];
  const cx = o.params.getFloat64(4 + planes * 48), cy = o.params.getFloat64(12 + planes * 48);
  expect([cx, cy]).toEqual([0.5, 0.5]);
  const m = Math.hypot(width, height) / 2, dx = px / m, dy = py / m, r2 = dx * dx + dy * dy, f = kr0! + kr1! * r2 + kr2! * r2 ** 2 + kr3! * r2 ** 3;
  return [m * (dx * f + 2 * kt0! * dx * dy + kt1! * (r2 + 2 * dx * dx)), m * (dy * f + kt0! * (r2 + 2 * dy * dy) + 2 * kt1! * dx * dy)];
}
const assumption = (r: SimulateCaptureResult, id: string): Record<string, unknown> | undefined => r.assumptions.find((a) => a.id === id)?.value as Record<string, unknown> | undefined;

describe("output.dng.lensCorrectionOpcodes (#587)", { timeout: scaledTimeout(60_000) }, () => {
  it("switches each correction on separately; none gives the same DNG bytes; the RAW codes never change", async () => {
    const run = (selection?: Selection): Promise<SimulateCaptureResult> => simulateCapture(options("pv-16-2.8", 2.8, selection ? { lensCorrectionOpcodes: selection } : undefined));
    const [none, off, distortion, lateralColor, vignetting, all] = await Promise.all([run(), run({ distortion: false, lateralColor: false, vignetting: false }),
      run({ distortion: true }), run({ lateralColor: true }), run({ vignetting: true }), run(ALL)]);
    expect(Buffer.from(off.image.dng!).equals(Buffer.from(none.image.dng!))).toBe(true);
    expect(assumption(off, "output.dng.lensCorrectionOpcodes")).toBeUndefined();
    const ids = (r: SimulateCaptureResult): number[][] => opcodeList(r.image.dng!).map((o) => [o.id, o.id === 1 ? o.params.getUint32(0) : 0]);
    expect(ids(none)).toEqual([]);
    expect(ids(distortion)).toEqual([[1, 1]]);
    expect(ids(lateralColor)).toEqual([[1, 3]]);
    expect(ids(vignetting)).toEqual([[3, 0]]);
    expect(ids(all)).toEqual([[3, 0], [1, 3]]);
    const parsedNone = parseDngRawImage({ bytes: none.image.dng! });
    for (const r of [distortion, lateralColor, vignetting, all]) {
      // Every opcode is optional (flags bit 0), DNG 1.3.0.0, not preview-skipped.
      for (const o of opcodeList(r.image.dng!)) expect([o.flags, o.version]).toEqual([1, [1, 3, 0, 0]]);
      // The RAW pixel data and every parsed tag are those of the DNG without opcodes; the file still parses.
      expect(Array.from(r.raw.codes)).toEqual(Array.from(none.raw.codes));
      const parsed = parseDngRawImage({ bytes: r.image.dng! });
      expect(Buffer.from(parsed.codes.buffer, parsed.codes.byteOffset, parsed.codes.byteLength).equals(Buffer.from(parsedNone.codes.buffer, parsedNone.codes.byteOffset, parsedNone.codes.byteLength))).toBe(true);
      expect({ ...parsed, codes: null }).toEqual({ ...parsedNone, codes: null });
      expect(Buffer.from(ifd0Tag(r.image.dng!, 50707)!.data)).toEqual(Buffer.from([1, 1, 0, 0]));
    }
    // The opcodes apply to the stage-3 image: the ActiveArea, which is the output frame.
    expect(parsedNone.activeArea).toMatchObject({ width: W, height: H });
    expect(assumption(all, "output.dng.lensCorrectionOpcodes")).toMatchObject({ tag: 51022, opcodes: [{ opcode: "FixVignetteRadial" }, { opcode: "WarpRectilinear" }] });
  });

  it.each([["pv-16-2.8", 2.8], ["pv-300-5.6", 5.6]] as const)("reproduces the profile's mapping exactly and its gain within 0.1 percent: %s at f/%s", async (lensId, fNumber) => {
    const [dngRun, jpegLike] = await Promise.all([simulateCapture(options(lensId, fNumber, { lensCorrectionOpcodes: ALL })), simulateCapture(options(lensId, fNumber, undefined, ALL))]);
    const [vignette, warp] = opcodeList(dngRun.image.dng!) as [Opcode, Opcode];
    const lens = resolveGenericLens({ lensId, activeImagingArea: AREA, fNumber });
    const profile = createGenericLensCorrectionProfile({ lensId, activeImagingArea: AREA, state: { bodyId: "b", bodyVersion: "1", lensId, lensVersion: "1",
      focalLengthMm: lens.focalLengthMm, aperture: fNumber, focusDistanceM: 5, captureMode: "still", outputWidth: W, outputHeight: H, frameRateHz: 0, stabilizationMode: "off" },
      // #589: the capture's own channels' effective dispersion, which the opcodes and output.lensCorrections share.
      channelDispersion: (assumption(dngRun, "output.dng.lensCorrectionOpcodes") as { channelDispersion: { red: number; green: number; blue: number } }).channelDispersion });
    expect((assumption(jpegLike, "output.lensCorrections") as { channelDispersion: unknown }).channelDispersion).toEqual((assumption(dngRun, "output.dng.lensCorrectionOpcodes") as { channelDispersion: unknown }).channelDispersion);
    const [d, ca, v] = profile.components as [{ transform: { profile: { coefficients: { k1: number } } } }, { transforms: Record<string, { matrix: number[] }> }, IlluminationLensCorrection];
    // Gain: the profile's det J/E (#584) at the sensor point, from calculatePeripheralIlluminationCorrection, on a fine grid.
    const R = Math.hypot(W, H) / 2;
    let gainError = 0;
    for (let y = 0; y <= H; y += 2) for (let x = 0; x <= W; x += 2) {
      const px = x - W / 2, py = H / 2 - y, expected = calculatePeripheralIlluminationCorrection({ component: v, imagePointMm: { x: px * PITCH_MM, y: py * PITCH_MM }, signal: 1, noiseVariance: 0, clippingLevel: 100 }).value.gain;
      gainError = Math.max(gainError, Math.abs(vignetteGain(vignette, Math.hypot(px, py) / R) / expected - 1));
    }
    expect(gainError).toBeLessThan(DNG_VIGNETTE_FIT_TOLERANCE);
    // Mapping: output.lensCorrections' source point s = q(1 + k1|q|²/R²), q = a_c·p/magnification, the profile's k1 and a_c.
    const magnification = (assumption(jpegLike, "output.lensCorrections") as { magnification: number }).magnification, k1 = d.transform.profile.coefficients.k1;
    expect((assumption(dngRun, "output.dng.lensCorrectionOpcodes") as { opcodes: { magnification?: number }[] }).opcodes[1]!.magnification).toBe(magnification);
    let mappingError = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) (["red", "green", "blue"] as const).forEach((channel, c) => {
      const px = x + 0.5 - W / 2, py = H / 2 - y - 0.5, a = ca.transforms[channel]!.matrix[0]! / magnification, qx = a * px, qy = a * py, f = 1 + k1 * (qx * qx + qy * qy) / (R * R);
      const [sx, sy] = warpSource(warp, c, px, py, W, H);
      mappingError = Math.max(mappingError, Math.hypot(sx - qx * f, sy - qy * f));
    });
    expect(mappingError).toBeLessThan(1e-9);
    // The magnification fills the frame: pincushion needs it, barrel does not.
    if (lensId === "pv-300-5.6") expect(magnification).toBeGreaterThan(1.01); else expect(magnification).toBe(1);
  });

  it("fits FixVignetteRadial within 0.1 % for every catalogue lens, wide open and stopped down", () => {
    let worst = 0;
    for (const entry of GENERIC_LENS_CATALOGUE) for (const fNumber of [entry.widestFNumber, Math.min(entry.narrowestFNumber, entry.widestFNumber * 2), entry.narrowestFNumber]) {
      const lens = resolveGenericLens({ lensId: entry.lensId, activeImagingArea: AREA, fNumber });
      const { opcodes } = createDngLensCorrectionOpcodes(lens, { distortion: false, lateralColor: false, vignetting: true }, W, H, PITCH_MM, GENERIC_CHANNELS);
      worst = Math.max(worst, (opcodes[0] as { maximumRelativeFitError: number }).maximumRelativeFitError);
    }
    // Measured 2026-11-09: 0.062 % at most (PV 600 6.3 wide open).
    expect(worst).toBeLessThan(DNG_VIGNETTE_FIT_TOLERANCE);
  });

  it("writes the same opcodes from parts as from the whole frame", async () => {
    const whole = options("pv-300-5.6", 5.6, { lensCorrectionOpcodes: ALL }), result = await simulateCapture(whole);
    const tiles = [{ x: 0, y: 0, width: 24, height: 32 }, { x: 24, y: 0, width: 24, height: 32 }];
    const parts = await Promise.all(tiles.map(async (region) => {
      const r = await simulateCapture({ ...whole, output: { width: W, height: H, format: "srgb-8", region } });
      return { raw: r.raw, region: r.region! };
    }));
    const joined = await serializeSimulatedCaptureDngFromParts(whole, parts);
    expect(Buffer.from(joined.bytes).equals(Buffer.from(result.image.dng!))).toBe(true);
  });

  it("refuses requests it cannot honor, by name, and checks caller opcode lists", async () => {
    const base = options("pv-50-1.8", 4, { lensCorrectionOpcodes: ALL });
    await expect(simulateCapture({ ...base, lens: { fNumber: 4 } })).rejects.toThrow(/output.dng.lensCorrectionOpcodes needs lens.catalogue/);
    await expect(simulateCapture({ ...base, output: { ...base.output, region: { x: 0, y: 0, width: 8, height: 8 } } })).rejects.toThrow(/lensCorrectionOpcodes needs the whole frame/);
    await expect(simulateCapture({ ...base, output: { ...base.output, dng: { lensCorrectionOpcodes: { vignetting: 1 as never } } } })).rejects.toThrow(InvalidConfigurationError);
    await expect(simulateCapture({ ...base, output: { ...base.output, dng: { lensCorrectionOpcodes: { sharpen: true } as never } } })).rejects.toThrow(InvalidConfigurationError);
    const r = await simulateCapture(options("pv-50-1.8", 4)), colorProfile = r.request.development.colorProfile;
    for (const bad of [new Uint8Array(3), Uint8Array.of(0, 0, 0, 1), Uint8Array.of(0, 0, 0, 1, ...new Array<number>(12).fill(0), 0), Uint8Array.of(0, 0, 0, 2, ...new Array<number>(16).fill(0))])
      await expect(serializeNativeRawDng({ raw: r.raw, colorProfile, opcodeList3: bad })).rejects.toThrow(/opcodeList3/);
    const list = createDngLensCorrectionOpcodes(resolveGenericLens({ lensId: "pv-50-1.8", activeImagingArea: AREA, fNumber: 4 }), { distortion: true, lateralColor: false, vignetting: false }, W, H, PITCH_MM, GENERIC_CHANNELS).opcodeList3;
    const dng = await serializeNativeRawDng({ raw: r.raw, colorProfile, opcodeList3: list });
    expect(Buffer.from(ifd0Tag(dng.bytes, 51022)!.data).equals(Buffer.from(list))).toBe(true);
  });
});
