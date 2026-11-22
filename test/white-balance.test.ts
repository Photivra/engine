// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  createColorTemperatureWhiteBalanceIntent,
  createLockedWhiteBalanceState,
  estimateAutoWhiteBalance,
  InvalidConfigurationError,
  InvalidScientificInputError,
  parseResolvedWhiteBalanceState,
  parseWhiteBalanceProfile,
  resolveCaptureColorModel,
  resolveColorTemperatureWhiteBalance,
  resolveCustomWhiteBalance,
  resolveManualWhiteBalance,
  resolvePresetWhiteBalance,
  type PreWhiteBalanceRgbSampleSet,
  type WhiteBalanceProfile
} from "../src/index.js";

const evidence = (
  ref: string
): readonly [{
  sourceOrigin: "photivra";
  sourceReference: string;
  reuseStatus: "photivra-owned";
}] => [{
  sourceOrigin: "photivra",
  sourceReference: ref,
  reuseStatus: "photivra-owned"
}];

const profile = (): WhiteBalanceProfile =>
  parseWhiteBalanceProfile({
    schemaVersion: "0.1.0",
    profileId: "generic-wb",
    profileVersion: "1.0.0",
    scientificStatus: "approximation",
    inputDomain:
      "relative-pre-wb-camera-linear-rgb",
    presets: [
      {
        presetId: "daylight-like",
        label: "Daylight",
        channelGains: {
          value: {
            red: 1.2,
            green: 1,
            blue: 1.45
          },
          evidence: evidence("preset-daylight")
        },
        nominalColorTemperatureKelvin:
          5200,
        nominalTint: 0.03,
        limitations: [
          "Generic educational preset."
        ]
      },
      {
        presetId: "warm-indoor",
        label: "Incandescent",
        channelGains: {
          value: {
            red: 0.8,
            green: 1,
            blue: 2.1
          },
          evidence: evidence("preset-warm")
        }
      }
    ],
    awbPolicies: [
      {
        policyId: "neutral",
        intent: "neutral-priority",
        correctionStrength: {
          value: 1,
          evidence: evidence("awb-neutral")
        }
      },
      {
        policyId: "standard",
        intent: "standard",
        correctionStrength: {
          value: 0.8,
          evidence: evidence("awb-standard")
        }
      },
      {
        policyId: "ambience",
        intent: "ambience-preserving",
        correctionStrength: {
          value: 0.5,
          evidence: evidence("awb-ambience")
        },
        limitations: [
          "Intentionally preserves more observed cast."
        ]
      }
    ],
    evidence: evidence("wb-profile"),
    limitations: [
      "Generic camera-linear approximation."
    ]
  });

const sampleSet = (
  imageStateId: string,
  red: number,
  green: number,
  blue: number
): PreWhiteBalanceRgbSampleSet => ({
  imageStateId,
  inputDomain:
    "relative-pre-wb-camera-linear-rgb",
  samples: [
    {
      sampleId: "region",
      red,
      green,
      blue,
      weight: 1,
      clipped: false
    }
  ]
});

describe("manual and preset white balance", () => {
  it("resolves preset gains from the declared profile rather than a universal Kelvin label", () => {
    const state =
      resolvePresetWhiteBalance({
        stateId: "preset-1",
        profile: profile(),
        presetId: "daylight-like"
      });

    expect(state.channelGains).toEqual({
      red: 1.2,
      green: 1,
      blue: 1.45
    });
    expect(state.presetId)
      .toBe("daylight-like");
    expect(state.sourceProfile)
      .toEqual({
        profileId: "generic-wb",
        profileVersion: "1.0.0"
      });
    expect(state.source).toBe("preset");
  });

  it("keeps manual WB fixed independently from scene signal changes", () => {
    const first =
      resolveManualWhiteBalance({
        stateId: "manual-a",
        channelGains: {
          red: 1.5,
          green: 1,
          blue: 0.75
        }
      });
    const second =
      resolveManualWhiteBalance({
        stateId: "manual-b",
        channelGains: {
          red: 1.5,
          green: 1,
          blue: 0.75
        }
      });

    expect(first.channelGains)
      .toEqual(second.channelGains);
    expect(first.sceneIlluminationModified)
      .toBe(false);
    expect(
      first.rawCaptureDestructivelyModified
    ).toBe(false);
    expect(first.physicalExposureModified)
      .toBe(false);
    expect(first.focusModified).toBe(false);
  });

  it("keeps color temperature and tint independent without fabricating camera gains", () => {
    const neutralTint =
      createColorTemperatureWhiteBalanceIntent({
        intentId: "kelvin-a",
        colorTemperatureKelvin: 5000,
        tint: 0
      });
    const magentaTint =
      createColorTemperatureWhiteBalanceIntent({
        intentId: "kelvin-b",
        colorTemperatureKelvin: 5000,
        tint: 0.2
      });

    expect(
      neutralTint.colorTemperatureKelvin
    ).toBe(
      magentaTint.colorTemperatureKelvin
    );
    expect(neutralTint.tint)
      .not.toBe(magentaTint.tint);
    expect(neutralTint.channelGainsResolved)
      .toBe(false);
    expect(
      neutralTint.requiresCameraProfileColorimetry
    ).toBe(true);
  });
});

describe("custom white balance", () => {
  it("resolves a declared neutral custom measurement from pre-WB camera-linear signal", () => {
    const state =
      resolveCustomWhiteBalance({
        stateId: "custom-1",
        sampleSet:
          sampleSet(
            "capture-reference",
            0.5,
            1,
            2
          )
      });

    expect(state.channelGains.red)
      .toBeCloseTo(2, 12);
    expect(state.channelGains.green)
      .toBe(1);
    expect(state.channelGains.blue)
      .toBeCloseTo(0.5, 12);
    expect(state.measurement)
      .toMatchObject({
        imageStateId:
          "capture-reference",
        usableSampleCount: 1,
        rejectedClippedSampleCount: 0
      });
    expect(state.source)
      .toBe("custom-measurement");
  });

  it("rejects clipped or insufficient custom-WB samples", () => {
    expect(() =>
      resolveCustomWhiteBalance({
        stateId: "custom-clipped",
        sampleSet: {
          imageStateId: "capture-a",
          inputDomain:
            "relative-pre-wb-camera-linear-rgb",
          samples: [
            {
              sampleId: "clipped",
              red: 1,
              green: 1,
              blue: 1,
              weight: 1,
              clipped: true
            }
          ]
        }
      })
    ).toThrow("must not contain clipped samples");

    expect(() =>
      resolveCustomWhiteBalance({
        stateId: "custom-zero",
        sampleSet:
          sampleSet(
            "capture-b",
            0,
            1,
            1
          )
      })
    ).toThrow(
      "requires positive signal in every"
    );
  });
});

describe("auto white balance", () => {
  it("responds to changed pre-WB camera signal without an illuminant oracle", () => {
    const warm =
      estimateAutoWhiteBalance({
        stateId: "awb-warm",
        profile: profile(),
        policyId: "neutral",
        sampleSet:
          sampleSet(
            "warm-capture",
            2,
            1,
            0.5
          )
      });
    const cool =
      estimateAutoWhiteBalance({
        stateId: "awb-cool",
        profile: profile(),
        policyId: "neutral",
        sampleSet:
          sampleSet(
            "cool-capture",
            0.5,
            1,
            2
          )
      });

    expect(warm.channelGains)
      .not.toEqual(cool.channelGains);
    expect(warm.trueIlluminantMetadataUsed)
      .toBe(false);
    expect(cool.trueIlluminantMetadataUsed)
      .toBe(false);
  });

  it("is deterministic for identical observable input and policy", () => {
    const input = {
      profile: profile(),
      policyId: "standard",
      sampleSet:
        sampleSet(
          "same-capture",
          1.8,
          1,
          0.7
        )
    };

    const first =
      estimateAutoWhiteBalance({
        stateId: "same-state",
        ...input
      });
    const second =
      estimateAutoWhiteBalance({
        stateId: "same-state",
        ...input
      });

    expect(second).toEqual(first);
  });

  it("supports neutral and ambience-preserving policies without pretending one universal AWB", () => {
    const observed =
      sampleSet(
        "warm-room",
        2,
        1,
        0.5
      );
    const neutral =
      estimateAutoWhiteBalance({
        stateId: "neutral",
        profile: profile(),
        policyId: "neutral",
        sampleSet: observed
      });
    const ambience =
      estimateAutoWhiteBalance({
        stateId: "ambience",
        profile: profile(),
        policyId: "ambience",
        sampleSet: observed
      });

    expect(neutral.channelGains)
      .toEqual({
        red: 0.5,
        green: 1,
        blue: 2
      });
    expect(ambience.channelGains.red)
      .toBeCloseTo(
        Math.sqrt(0.5),
        12
      );
    expect(ambience.channelGains.blue)
      .toBeCloseTo(
        Math.sqrt(2),
        12
      );
    expect(
      ambience.awbPolicy?.intent
    ).toBe("ambience-preserving");
  });

  it("excludes clipped AWB samples but reports them and fails when none remain", () => {
    const state =
      estimateAutoWhiteBalance({
        stateId: "awb-clipped",
        profile: profile(),
        policyId: "standard",
        sampleSet: {
          imageStateId: "mixed-clipping",
          inputDomain:
            "relative-pre-wb-camera-linear-rgb",
          samples: [
            {
              sampleId: "good",
              red: 1,
              green: 1,
              blue: 1,
              weight: 1,
              clipped: false
            },
            {
              sampleId: "bad",
              red: 100,
              green: 100,
              blue: 100,
              weight: 1,
              clipped: true
            }
          ]
        }
      });

    expect(
      state.measurement
        ?.rejectedClippedSampleCount
    ).toBe(1);
    expect(
      state.measurement
        ?.usableSampleCount
    ).toBe(1);

    expect(() =>
      estimateAutoWhiteBalance({
        stateId: "awb-no-data",
        profile: profile(),
        policyId: "standard",
        sampleSet: {
          imageStateId: "all-clipped",
          inputDomain:
            "relative-pre-wb-camera-linear-rgb",
          samples: [
            {
              sampleId: "bad",
              red: 1,
              green: 1,
              blue: 1,
              weight: 1,
              clipped: true
            }
          ]
        }
      })
    ).toThrow("at least one usable");
  });

  it("keeps one global WB under mixed illumination so local color differences can remain", () => {
    const mixed: PreWhiteBalanceRgbSampleSet = {
      imageStateId: "mixed-light",
      inputDomain:
        "relative-pre-wb-camera-linear-rgb",
      samples: [
        {
          sampleId: "warm-side",
          red: 2,
          green: 1,
          blue: 0.5,
          weight: 1,
          clipped: false
        },
        {
          sampleId: "cool-side",
          red: 0.5,
          green: 1,
          blue: 2,
          weight: 1,
          clipped: false
        }
      ]
    };

    const state =
      estimateAutoWhiteBalance({
        stateId: "mixed-awb",
        profile: profile(),
        policyId: "neutral",
        sampleSet: mixed
      });

    const warmAfter = {
      red:
        2 * state.channelGains.red,
      green:
        1 * state.channelGains.green,
      blue:
        0.5 * state.channelGains.blue
    };
    const coolAfter = {
      red:
        0.5 * state.channelGains.red,
      green:
        1 * state.channelGains.green,
      blue:
        2 * state.channelGains.blue
    };

    expect(warmAfter)
      .not.toEqual(coolAfter);
    expect(state.limitations.join(" "))
      .toMatch(/global WB/u);
  });

  it("locks the resolved AWB state while later observable scene signal can change", () => {
    const original =
      estimateAutoWhiteBalance({
        stateId: "awb-before",
        profile: profile(),
        policyId: "standard",
        sampleSet:
          sampleSet(
            "capture-before",
            2,
            1,
            0.5
          )
      });
    const locked =
      createLockedWhiteBalanceState({
        stateId: "awb-locked",
        sourceState: original
      });
    const after =
      estimateAutoWhiteBalance({
        stateId: "awb-after",
        profile: profile(),
        policyId: "standard",
        sampleSet:
          sampleSet(
            "capture-after",
            0.5,
            1,
            2
          )
      });

    expect(locked.locked).toBe(true);
    expect(locked.sourceStateId)
      .toBe("awb-before");
    expect(locked.channelGains)
      .toEqual(original.channelGains);
    expect(after.channelGains)
      .not.toEqual(locked.channelGains);
    expect(Object.isFrozen(locked))
      .toBe(true);
  });

  it("never changes physical exposure, focus, raw capture, or scene illumination", () => {
    const state =
      estimateAutoWhiteBalance({
        stateId: "awb-boundary",
        profile: profile(),
        policyId: "standard",
        sampleSet:
          sampleSet(
            "capture-boundary",
            1.3,
            1,
            0.8
          )
      });

    expect(state).toMatchObject({
      trueIlluminantMetadataUsed: false,
      sceneIlluminationModified: false,
      rawCaptureDestructivelyModified: false,
      physicalExposureModified: false,
      focusModified: false
    });
  });
});

describe("white-balance profile validation", () => {
  it("fails closed on duplicate profile identities and invalid AWB strength", () => {
    const base = profile();

    expect(() =>
      parseWhiteBalanceProfile({
        ...base,
        presets: [
          base.presets[0],
          base.presets[0]
        ]
      })
    ).toThrow("duplicate presetId");

    expect(() =>
      parseWhiteBalanceProfile({
        ...base,
        awbPolicies: [
          {
            ...base.awbPolicies[0],
            correctionStrength: {
              value: 1.2,
              evidence:
                evidence("invalid-strength")
            }
          }
        ]
      })
    ).toThrow("from zero through one");
  });

  it("rejects unsupported estimator input domains and unknown preset/policy IDs", () => {
    expect(() =>
      parseWhiteBalanceProfile({
        ...profile(),
        inputDomain: "display-rgb"
      })
    ).toThrow("inputDomain");

    expect(() =>
      resolvePresetWhiteBalance({
        stateId: "missing-preset",
        profile: profile(),
        presetId: "missing"
      })
    ).toThrow("not declared");

    expect(() =>
      estimateAutoWhiteBalance({
        stateId: "missing-policy",
        profile: profile(),
        policyId: "missing",
        sampleSet:
          sampleSet("capture", 1, 1, 1)
      })
    ).toThrow("not declared");
  });
});

// foundation-09 (#699): domain errors instead of raw TypeErrors, and a lock builds only states the engine parses again.
describe("white-balance state input checks", () => {
  const domain = (call: () => unknown, message: string | RegExp): void => {
    let error: unknown;
    try { call(); } catch (e) { error = e; }
    expect(error instanceof InvalidConfigurationError || error instanceof InvalidScientificInputError, String(error)).toBe(true);
    expect(String(error)).toMatch(message);
  };
  it("refuses a missing gain record, a null sample, a non-boolean clipped and an invalid source state", () => {
    domain(() => resolveManualWhiteBalance({ stateId: "s" } as never), "channelGains");
    domain(() => resolveManualWhiteBalance({ stateId: "s", channelGains: { red: 1, green: 1, blue: 1, magenta: 9 } } as never), "magenta");
    domain(() => resolveCustomWhiteBalance({ stateId: "c", sampleSet: { ...sampleSet("i", 1, 1, 1), samples: [null] } } as never), "sampleSet.samples[0]");
    for (const clipped of ["true", 1, null]) {
      const set = sampleSet("i", 1, 1, 1);
      domain(() => estimateAutoWhiteBalance({ stateId: "a", profile: profile(), policyId: "standard", sampleSet: { ...set, samples: [{ ...set.samples[0]!, clipped }] } } as never),
        "sampleSet.samples[0].clipped");
    }
    domain(() => createLockedWhiteBalanceState({ stateId: "locked" } as never), "sourceState");
    const manual = resolveManualWhiteBalance({ stateId: "m", channelGains: { red: 1.5, green: 1, blue: 0.75 } });
    domain(() => createLockedWhiteBalanceState({ stateId: "locked", sourceState: { stateId: "m", channelGains: manual.channelGains, limitations: "abc", version: 5,
      source: "made-up", inputDomain: null, trueIlluminantMetadataUsed: true, extra: {} } } as never), /./u);
    domain(() => createLockedWhiteBalanceState({ stateId: "locked", sourceState: { ...manual, extra: {} } } as never), "extra");
  });
  it("locks a state of every source into one the parser accepts, with unchanged gains", () => {
    const camera = { profileId: "ideal-colorimetric", profileVersion: "0.1.0", xyzToCameraRgb: resolveCaptureColorModel().xyzToCameraRgb };
    const sources = [
      resolveManualWhiteBalance({ stateId: "m", channelGains: { red: 1.5, green: 1, blue: 0.75 } }),
      resolvePresetWhiteBalance({ stateId: "p", profile: profile(), presetId: "daylight-like" }),
      resolveCustomWhiteBalance({ stateId: "c", sampleSet: sampleSet("i", 0.5, 1, 2) }),
      estimateAutoWhiteBalance({ stateId: "a", profile: profile(), policyId: "standard", sampleSet: sampleSet("i", 2, 1, 0.5) }),
      resolveColorTemperatureWhiteBalance({ stateId: "k", intent: createColorTemperatureWhiteBalanceIntent({ intentId: "k", colorTemperatureKelvin: 5000, tint: 0 }),
        whiteLocus: "planckian", tintInterpretation: "duv-cie-1960-uv", camera })];
    for (const source of sources) {
      const locked = createLockedWhiteBalanceState({ stateId: "locked-" + source.stateId, sourceState: source });
      expect(locked.channelGains, source.source).toEqual(source.channelGains);
      expect(locked).toMatchObject({ locked: true, sourceStateId: source.stateId, source: source.source });
      expect(Object.isFrozen(locked)).toBe(true);
      expect(parseResolvedWhiteBalanceState(locked)).toEqual(locked);
    }
  });
});
