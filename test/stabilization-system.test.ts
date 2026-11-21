// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  calculateStabilizedCaptureTemporalSamples,
  calculateStabilizedRotationTrajectory,
  parseStabilizationDisturbanceTrajectory,
  parseStabilizationSystemProfile,
  resolveCaptureMode,
  resolveCaptureModeTiming,
  type ResolvedCaptureModeTiming,
  type StabilizationDisturbanceTrajectory,
  type StabilizationSystemProfile
} from "../src/index.js";
import { probeSubObjects } from "./helpers/sub-object-probe.js";

const evidence = (ref: string) => [{
  sourceOrigin: "photivra" as const,
  sourceReference: ref,
  reuseStatus: "photivra-owned" as const
}] as const;

const trajectory = (
  scale = 1
): StabilizationDisturbanceTrajectory =>
  parseStabilizationDisturbanceTrajectory({
    version: "0.1.0",
    trajectoryId: "disturbance",
    timeReference:
      "first-opening-boundary-phase",
    samples: [
      {
        timeSecondsFromCaptureReference:
          0,
        angularDisplacementRad: {
          pitch: 0,
          yaw: 0,
          roll: 0
        }
      },
      {
        timeSecondsFromCaptureReference:
          0.01,
        angularDisplacementRad: {
          pitch: 0.02 * scale,
          yaw: 0.01 * scale,
          roll: 0.005 * scale
        }
      },
      {
        timeSecondsFromCaptureReference:
          0.02,
        angularDisplacementRad: {
          pitch: 0.04 * scale,
          yaw: 0.02 * scale,
          roll: 0.01 * scale
        }
      }
    ],
    initialAngularDisplacementIsZero:
      true,
    cameraTranslationIncluded:
      false,
    subjectMotionIncluded: false,
    supportStateEncoded: false,
    evidence:
      evidence("disturbance"),
    limitations: [
      "Synthetic controlled rotation."
    ]
  });

const profile = (
  overrides:
    Partial<StabilizationSystemProfile> = {}
): StabilizationSystemProfile =>
  parseStabilizationSystemProfile({
    schemaVersion: "0.1.0",
    profileId: "stabilizer",
    profileVersion: "1.0.0",
    profileKind:
      "generic-synthetic",
    scientificStatus:
      "approximation",
    architecture:
      "sensor-shift",
    captureKind: "still",
    axisResponses: [
      {
        axis: "pitch",
        correctionGain: {
          value: 1,
          evidence:
            evidence("pitch-gain")
        },
        latencySeconds: {
          value: 0,
          evidence:
            evidence("pitch-latency")
        },
        maximumCorrectionAngleRad: {
          value: 1,
          evidence:
            evidence("pitch-limit")
        }
      },
      {
        axis: "yaw",
        correctionGain: {
          value: 1,
          evidence:
            evidence("yaw-gain")
        },
        latencySeconds: {
          value: 0,
          evidence:
            evidence("yaw-latency")
        },
        maximumCorrectionAngleRad: {
          value: 1,
          evidence:
            evidence("yaw-limit")
        }
      },
      {
        axis: "roll",
        correctionGain: {
          value: 1,
          evidence:
            evidence("roll-gain")
        },
        latencySeconds: {
          value: 0,
          evidence:
            evidence("roll-latency")
        },
        maximumCorrectionAngleRad: {
          value: 1,
          evidence:
            evidence("roll-limit")
        }
      }
    ],
    panningPolicy: {
      kind: "none"
    },
    controlTransientModeled:
      false,
    spontaneousDriftModeled:
      false,
    cameraTranslationCorrectionModeled:
      false,
    digitalStabilizationIncluded:
      false,
    supportPolicyIncluded:
      false,
    stopRatingUsedAsDynamicResponse:
      false,
    evidence:
      evidence("stabilizer"),
    limitations: [
      "Synthetic response."
    ],
    ...overrides
  });

const offProfile = ():
  StabilizationSystemProfile =>
    parseStabilizationSystemProfile({
      schemaVersion: "0.1.0",
      profileId: "off",
      profileVersion: "1.0.0",
      profileKind:
        "generic-synthetic",
      scientificStatus:
        "approximation",
      architecture: "off",
      captureKind: "still",
      axisResponses: [],
      panningPolicy: {
        kind: "none"
      },
      controlTransientModeled:
        false,
      spontaneousDriftModeled:
        false,
      cameraTranslationCorrectionModeled:
        false,
      digitalStabilizationIncluded:
        false,
      supportPolicyIncluded:
        false,
      stopRatingUsedAsDynamicResponse:
        false,
      evidence:
        evidence("off"),
      limitations: [
        "Stabilization disabled."
      ]
    });

const timing = ():
  ResolvedCaptureModeTiming => {
    const nativeRaster = {
      pixelWidth: 100,
      pixelHeight: 100
    };
    const mode =
      resolveCaptureMode({
        nativeRaster,
        profile: {
          schemaVersion: "0.1.0",
          modes: [{
            modeId: "still",
            evidence:
              evidence("mode"),
            acquisition: {
              kind: "single-frame"
            },
            perFrameSampling: {
              kind:
                "native-effective-raster"
            },
            processedImageRaster: {
              value: nativeRaster,
              evidence:
                evidence("raster")
            },
            dependencies: [
              "mode-specific-readout-timing"
            ]
          }]
        },
        modeId: "still"
      });

    return resolveCaptureModeTiming({
      captureMode: mode,
      timingProfile: {
        schemaVersion: "0.1.0",
        profileId:
          "timing",
        profileVersion: "1.0.0",
        captureModeId: "still",
        scientificStatus:
          "approximation",
        scheduleFamily:
          "global-or-uniform-linear-native-scan",
        shutterMechanism:
          "electronic",
        opening: {
          kind:
            "uniform-linear-native-scan",
          directionNative: {
            value: "top-to-bottom",
            evidence:
              evidence("open-direction")
          },
          traversalDurationSeconds: {
            value: 0.004,
            unit: "s",
            evidence:
              evidence("open-time")
          }
        },
        closing: {
          kind:
            "uniform-linear-native-scan",
          directionNative: {
            value: "top-to-bottom",
            evidence:
              evidence("close-direction")
          },
          traversalDurationSeconds: {
            value: 0.004,
            unit: "s",
            evidence:
              evidence("close-time")
          }
        },
        readout: {
          readoutMode: "rolling",
          captureReadoutDurationSeconds: {
            value: 0.01,
            unit: "s",
            evidence:
              evidence("readout")
          },
          scanDirectionNative: {
            value: "top-to-bottom",
            evidence:
              evidence("readout-dir")
          },
          spatialSamplingSkewSeconds: {
            value: 0.01,
            unit: "s",
            evidence:
              evidence("readout-skew")
          }
        },
        nonUniformScheduleModeled:
          false,
        evidence:
          evidence("timing"),
        limitations: [
          "Synthetic timing."
        ]
      },
      nominalExposureDurationSeconds: {
        value: 0.012,
        unit: "s",
        evidence:
          evidence("exposure")
      },
      samplePointsNative: [
        {
          x: 50,
          y: 25
        },
        {
          x: 50,
          y: 75
        }
      ]
    });
  };

describe("time-domain stabilization trajectory", () => {
  it("returns the uncorrected disturbance when stabilization is off", () => {
    const result =
      calculateStabilizedRotationTrajectory({
        disturbance:
          trajectory(),
        profile:
          offProfile(),
        captureKind:
          "still"
      }).value;

    expect(
      result.samples.map(
        (sample) =>
          sample
            .residualAngularDisplacementRad
      )
    ).toEqual(
      trajectory().samples.map(
        (sample) =>
          sample
            .angularDisplacementRad
      )
    );
    expect(
      result.samples.every(
        (sample) =>
          sample
            .appliedCorrectionAngularDisplacementRad
            .pitch === 0 &&
          sample
            .appliedCorrectionAngularDisplacementRad
            .yaw === 0 &&
          sample
            .appliedCorrectionAngularDisplacementRad
            .roll === 0
      )
    ).toBe(true);
    expect(
      result.supportStateConsumed
    ).toBe(false);
  });

  it("can fully cancel the synthetic rotational disturbance with unity zero-latency response", () => {
    const result =
      calculateStabilizedRotationTrajectory({
        disturbance:
          trajectory(),
        profile:
          profile(),
        captureKind:
          "still"
      }).value;

    for (
      const sample of
      result.samples
    ) {
      expect(
        sample
          .residualAngularDisplacementRad
          .pitch
      ).toBeCloseTo(0, 14);
      expect(
        sample
          .residualAngularDisplacementRad
          .yaw
      ).toBeCloseTo(0, 14);
      expect(
        sample
          .residualAngularDisplacementRad
          .roll
      ).toBeCloseTo(0, 14);
    }
  });

  it("never creates motion from an explicit zero-disturbance stable-support boundary", () => {
    const result =
      calculateStabilizedRotationTrajectory({
        disturbance:
          trajectory(0),
        profile:
          profile(),
        captureKind:
          "still"
      }).value;

    expect(
      result.zeroDisturbanceCanCreateMotion
    ).toBe(false);
    expect(
      result.samples.every(
        (sample) =>
          Math.hypot(
            sample
              .residualAngularDisplacementRad
              .pitch,
            sample
              .residualAngularDisplacementRad
              .yaw,
            sample
              .residualAngularDisplacementRad
              .roll
          ) === 0
      )
    ).toBe(true);
  });

  it("models explicit latency as delayed correction rather than a stop-rating multiplier", () => {
    const delayed =
      profile({
        axisResponses: [
          {
            ...profile()
              .axisResponses[0]!,
            latencySeconds: {
              value: 0.01,
              evidence:
                evidence("delay")
            }
          }
        ]
      });

    const result =
      calculateStabilizedRotationTrajectory({
        disturbance:
          trajectory(),
        profile:
          delayed,
        captureKind:
          "still"
      }).value;
    const middle =
      result.samples[1]!;

    expect(
      middle.axes.find(
        (axis) =>
          axis.axis === "pitch"
      )?.delayedMeasuredAngleRad
    ).toBe(0);
    expect(
      middle
        .residualAngularDisplacementRad
        .pitch
    ).toBeCloseTo(
      middle
        .disturbanceAngularDisplacementRad
        .pitch,
      14
    );
    expect(
      "stopRatingUsedAsDynamicResponse" in
        (result as unknown as
          Record<string, unknown>)
    ).toBe(false);
  });

  it("clips correction at an explicit per-axis travel limit", () => {
    const limited =
      profile({
        axisResponses: [{
          ...profile()
            .axisResponses[0]!,
          maximumCorrectionAngleRad: {
            value: 0.01,
            evidence:
              evidence("small-limit")
          }
        }]
      });

    const result =
      calculateStabilizedRotationTrajectory({
        disturbance:
          trajectory(),
        profile:
          limited,
        captureKind:
          "still"
      }).value;
    const last =
      result.samples[2]!;
    const pitch =
      last.axes.find(
        (axis) =>
          axis.axis === "pitch"
      )!;

    expect(
      pitch
        .appliedCorrectionAngleRad
    ).toBeCloseTo(0.01, 14);
    expect(
      pitch
        .correctionLimitReached
    ).toBe(true);
    expect(
      pitch.residualAngleRad
    ).toBeCloseTo(0.03, 14);
  });

  it("bypasses only the explicitly declared panning axis", () => {
    const panning =
      profile({
        panningPolicy: {
          kind:
            "declared-axis-bypass",
          axis: "yaw",
          evidence:
            evidence("pan-yaw")
        }
      });

    const result =
      calculateStabilizedRotationTrajectory({
        disturbance:
          trajectory(),
        profile:
          panning,
        captureKind:
          "still"
      }).value;
    const last =
      result.samples[2]!;

    expect(
      last
        .residualAngularDisplacementRad
        .yaw
    ).toBeCloseTo(0.02, 14);
    expect(
      last
        .residualAngularDisplacementRad
        .pitch
    ).toBeCloseTo(0, 14);
    expect(
      last.axes.find(
        (axis) =>
          axis.axis === "yaw"
      )
        ?.bypassedForDeclaredPan
    ).toBe(true);
  });

  it("applies coordinated body+lens correction once and validates allocation", () => {
    const coordinated =
      profile({
        architecture:
          "coordinated-physical",
        coordinatedAllocation: {
          bodyFraction: 0.6,
          lensFraction: 0.4,
          evidence:
            evidence("coordination"),
          totalCorrectionAppliedOnce:
            true
        }
      });

    const result =
      calculateStabilizedRotationTrajectory({
        disturbance:
          trajectory(),
        profile:
          coordinated,
        captureKind:
          "still"
      }).value;

    expect(
      result
        .coordinatedCorrectionDoubleCounted
    ).toBe(false);
    expect(
      result.samples[2]!
        .residualAngularDisplacementRad
        .pitch
    ).toBeCloseTo(0, 14);

    expect(() =>
      parseStabilizationSystemProfile({
        ...coordinated,
        coordinatedAllocation: {
          ...coordinated
            .coordinatedAllocation!,
          bodyFraction: 0.7,
          lensFraction: 0.4
        }
      })
    ).toThrow(
      "must equal one"
    );
  });
});

describe("capture-local stabilization sampling", () => {
  it("samples residual stabilization on each authoritative #12 local exposure clock", () => {
    const resolvedTiming =
      timing();
    const result =
      calculateStabilizedCaptureTemporalSamples({
        disturbance:
          trajectory(),
        profile:
          profile(),
        captureKind:
          "still",
        timing:
          resolvedTiming,
        samplePointsNative: [
          {
            x: 50,
            y: 25
          },
          {
            x: 50,
            y: 75
          }
        ],
        temporalSampleCount: 2
      }).value;

    expect(result).toMatchObject({
      timeReference:
        "first-opening-boundary-phase",
      quadratureScheme:
        "uniform-midpoint",
      temporalSampleCount: 2,
      sensorReadoutTimingUsedAsExposureTiming:
        false,
      supportStateConsumed:
        false,
      translationCorrectionModeled:
        false,
      digitalStabilizationApplied:
        false
    });
    expect(
      result.points[0]!
        .localExposureWindow
        .startSecondsFromCaptureReference
    ).toBeLessThan(
      result.points[1]!
        .localExposureWindow
        .startSecondsFromCaptureReference
    );
    expect(
      result.points.every(
        (point) =>
          point.nodes.every(
            (node) =>
              Math.hypot(
                node.stabilization
                  .residualAngularDisplacementRad
                  .pitch,
                node.stabilization
                  .residualAngularDisplacementRad
                  .yaw,
                node.stabilization
                  .residualAngularDisplacementRad
                  .roll
              ) <
              1e-12
          )
      )
    ).toBe(true);
  });

  it("fails closed when a requested point was not committed to #12 timing", () => {
    expect(() =>
      calculateStabilizedCaptureTemporalSamples({
        disturbance:
          trajectory(),
        profile:
          profile(),
        captureKind:
          "still",
        timing:
          timing(),
        samplePointsNative: [{
          x: 1,
          y: 1
        }],
        temporalSampleCount: 2
      })
    ).toThrow(
      "must match exactly one committed exposure-window sample point"
    );
  });

  it("fails when disturbance support does not cover an exposure-time node", () => {
    const short =
      parseStabilizationDisturbanceTrajectory({
        ...trajectory(),
        samples: [
          trajectory().samples[0],
          {
            timeSecondsFromCaptureReference:
              0.005,
            angularDisplacementRad: {
              pitch: 0.01,
              yaw: 0,
              roll: 0
            }
          }
        ]
      });

    expect(() =>
      calculateStabilizedCaptureTemporalSamples({
        disturbance:
          short,
        profile:
          profile(),
        captureKind:
          "still",
        timing:
          timing(),
        samplePointsNative: [{
          x: 50,
          y: 75
        }],
        temporalSampleCount: 2
      })
    ).toThrow(
      "outside the disturbance trajectory support"
    );
  });
});

describe("stabilization validation boundaries", () => {
  it("rejects nonzero initial displacement and non-monotonic disturbance times", () => {
    expect(() =>
      parseStabilizationDisturbanceTrajectory({
        ...trajectory(),
        samples: [
          {
            timeSecondsFromCaptureReference:
              0,
            angularDisplacementRad: {
              pitch: 0.1,
              yaw: 0,
              roll: 0
            }
          },
          trajectory().samples[1]
        ]
      })
    ).toThrow(
      "must begin at capture-reference t=0 with zero"
    );

    expect(() =>
      parseStabilizationDisturbanceTrajectory({
        ...trajectory(),
        samples: [
          trajectory().samples[0],
          trajectory().samples[2],
          trajectory().samples[1]
        ]
      })
    ).toThrow(
      "strictly increasing"
    );
  });

  it("rejects digital/support/stop-rating behavior inside the physical profile", () => {
    for (
      const key of [
        "digitalStabilizationIncluded",
        "supportPolicyIncluded",
        "stopRatingUsedAsDynamicResponse"
      ] as const
    ) {
      expect(() =>
        parseStabilizationSystemProfile({
          ...profile(),
          [key]: true
        })
      ).toThrow(
        key + " must be false"
      );
    }
  });

  it("rejects enabled profiles with no axis response and off profiles with active response", () => {
    expect(() =>
      parseStabilizationSystemProfile({
        ...profile(),
        axisResponses: []
      })
    ).toThrow(
      "must declare at least one axis response"
    );

    expect(() =>
      parseStabilizationSystemProfile({
        ...offProfile(),
        axisResponses: [
          profile().axisResponses[0]!
        ]
      })
    ).toThrow(
      "must not declare axis responses"
    );
  });

  it("requires exact still/video applicability", () => {
    expect(() =>
      calculateStabilizedRotationTrajectory({
        disturbance:
          trajectory(),
        profile:
          profile(),
        captureKind:
          "video"
      })
    ).toThrow(
      "must exactly match"
    );
  });

  it("rejects implicit panning on an undeclared correction axis", () => {
    expect(() =>
      parseStabilizationSystemProfile({
        ...profile({
          axisResponses: [
            {
              axis: "pitch",
              correctionGain: {
                value: 1,
                evidence:
                  evidence("pitch-gain")
              },
              latencySeconds: {
                value: 0,
                evidence:
                  evidence("pitch-latency")
              },
              maximumCorrectionAngleRad: {
                value: 1,
                evidence:
                  evidence("pitch-limit")
              }
            }
          ]
        }),
        panningPolicy: {
          kind:
            "declared-axis-bypass",
          axis: "yaw",
          evidence:
            evidence("bad-pan")
        }
      })
    ).toThrow(
      "must exist in axisResponses"
    );
  });
});


describe("stabilization closeout fail-closed boundaries", () => {
  it("validates profile schema, duplicate axes, response gain, and coordinated ownership", () => {
    expect(() =>
      parseStabilizationSystemProfile({
        ...profile(),
        schemaVersion: "9.9.9"
      })
    ).toThrow("schemaVersion");

    expect(() =>
      parseStabilizationSystemProfile({
        ...profile(),
        axisResponses: [
          profile().axisResponses[0]!,
          profile().axisResponses[0]!
        ]
      })
    ).toThrow(
      "must not contain duplicate axes"
    );

    expect(() =>
      parseStabilizationSystemProfile({
        ...profile(),
        axisResponses: [{
          ...profile().axisResponses[0]!,
          correctionGain: {
            value: 1.1,
            evidence:
              evidence("bad-gain")
          }
        }]
      })
    ).toThrow(
      "must lie from zero through one"
    );

    expect(() =>
      parseStabilizationSystemProfile({
        ...profile(),
        architecture:
          "coordinated-physical"
      })
    ).toThrow(
      "requires an explicit body/lens correction allocation"
    );

    expect(() =>
      parseStabilizationSystemProfile({
        ...profile(),
        coordinatedAllocation: {
          bodyFraction: 0.5,
          lensFraction: 0.5,
          evidence:
            evidence("unexpected-coordination"),
          totalCorrectionAppliedOnce:
            true
        }
      })
    ).toThrow(
      "Only coordinated physical stabilization"
    );
  });

  it("keeps off mode free of panning policy and validates disturbance metadata", () => {
    expect(() =>
      parseStabilizationSystemProfile({
        ...offProfile(),
        panningPolicy: {
          kind:
            "declared-axis-bypass",
          axis: "yaw",
          evidence:
            evidence("off-pan")
        }
      })
    ).toThrow(
      "must use panningPolicy.kind"
    );

    expect(() =>
      parseStabilizationDisturbanceTrajectory({
        ...trajectory(),
        supportStateEncoded:
          true
      })
    ).toThrow(
      "metadata is invalid"
    );

    expect(() =>
      parseStabilizationDisturbanceTrajectory({
        ...trajectory(),
        samples: [
          trajectory().samples[0]
        ]
      })
    ).toThrow(
      "at least two samples"
    );
  });

  it("validates capture-local request shape and still/video applicability", () => {
    expect(() =>
      calculateStabilizedCaptureTemporalSamples({
        disturbance:
          trajectory(),
        profile:
          profile(),
        captureKind:
          "video",
        timing:
          timing(),
        samplePointsNative: [{
          x: 50,
          y: 25
        }],
        temporalSampleCount: 2
      })
    ).toThrow(
      "must exactly match"
    );

    expect(() =>
      calculateStabilizedCaptureTemporalSamples({
        disturbance:
          trajectory(),
        profile:
          profile(),
        captureKind:
          "still",
        timing:
          timing(),
        samplePointsNative: [],
        temporalSampleCount: 2
      })
    ).toThrow(
      "must be a non-empty array"
    );

    expect(() =>
      calculateStabilizedCaptureTemporalSamples({
        disturbance:
          trajectory(),
        profile:
          profile(),
        captureKind:
          "still",
        timing:
          timing(),
        samplePointsNative: [{
          x: 50,
          y: 25
        }],
        temporalSampleCount: 0
      })
    ).toThrow(
      "temporalSampleCount"
    );
  });
});

describe("capture-local stabilization rejects a missing, null or non-object sub-object with a domain error (2.0.0 pre-release review)", () => {
  it("probes every nested object of a valid request", async () => {
    const input = { disturbance: trajectory(), profile: profile(), captureKind: "still", timing: timing(),
      samplePointsNative: [{ x: 50, y: 25 }, { x: 50, y: 75 }], temporalSampleCount: 2 };
    const call = (value: unknown): unknown => calculateStabilizedCaptureTemporalSamples(value as never);
    expect(() => call(input)).not.toThrow();
    const { probedPaths, escaped } = await probeSubObjects(call, input, { maximumDepth: 4 });
    expect(probedPaths).toBeGreaterThan(5);
    expect(escaped).toEqual([]);
  });
});

describe("sparse arrays (sensor-12, #701)", () => {
  it("refuses trajectory samples and axis responses with holes", () => {
    expect(() => parseStabilizationDisturbanceTrajectory({ ...trajectory(), samples: new Array(2) as never })).toThrow(expect.objectContaining({ name: "InvalidConfigurationError" }));
    expect(() => parseStabilizationSystemProfile({ ...profile(), axisResponses: new Array(1) as never })).toThrow(expect.objectContaining({ name: "InvalidConfigurationError" }));
  });
});

describe("local exposure duration (sensor-19, #701)", () => {
  it("refuses a zero or negative local exposure duration in a hand-built timing", () => {
    for (const duration of [0, -0.2]) {
      const resolved = structuredClone(timing()) as unknown as { exposureWindows: { samples: { startOffsetSecondsFromOpeningReference: number; endOffsetSecondsFromOpeningReference: number; localExposureDurationSeconds: number }[] } };
      for (const sample of resolved.exposureWindows.samples) {
        sample.startOffsetSecondsFromOpeningReference = 0.6;
        sample.localExposureDurationSeconds = duration;
        sample.endOffsetSecondsFromOpeningReference = 0.6 + duration;
      }
      expect(() => calculateStabilizedCaptureTemporalSamples({ disturbance: trajectory(), profile: profile(), captureKind: "still", timing: resolved as never,
        samplePointsNative: [{ x: 50, y: 25 }], temporalSampleCount: 2 }), String(duration)).toThrow("positive finite local exposure duration");
    }
  });
});
