// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  calculateCaptureExtendedObjectTemporalProjection,
  calculateExtendedObjectProjectionTrajectory,
  resolveCaptureMode,
  resolveCaptureModeTiming,
  type ResolvedCaptureModeTiming
} from "../src/index.js";
import { probeSubObjects } from "./helpers/sub-object-probe.js";

const evidence = (ref: string) => [{
  sourceOrigin: "photivra" as const,
  sourceReference: ref,
  reuseStatus: "photivra-owned" as const
}] as const;

const rollingTiming = ():
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
          "rolling-timing",
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
            value: 0.01,
            unit: "s",
            evidence:
              evidence("open-duration")
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
            value: 0.01,
            unit: "s",
            evidence:
              evidence("close-duration")
          }
        },
        readout: {
          readoutMode: "rolling",
          captureReadoutDurationSeconds: {
            value: 0.015,
            unit: "s",
            evidence:
              evidence("readout-duration")
          },
          scanDirectionNative: {
            value: "top-to-bottom",
            evidence:
              evidence("readout-direction")
          },
          spatialSamplingSkewSeconds: {
            value: 0.015,
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
          "Synthetic rolling timing."
        ]
      },
      nominalExposureDurationSeconds: {
        value: 0.02,
        unit: "s",
        evidence:
          evidence("exposure")
      },
      samplePointsNative: [
        {
          x: 50,
          y: 20
        },
        {
          x: 50,
          y: 80
        }
      ]
    });
  };

describe("extended-object time-varying projection", () => {
  it("shows radial scale motion for an extended fronto-parallel object moving in depth while its on-axis center remains stationary", () => {
    const result =
      calculateExtendedObjectProjectionTrajectory({
        objectId: "card",
        focalLengthMm: 50,
        objectTranslationVelocityMps: {
          x: 0,
          y: 0,
          z: -1
        },
        cameraTranslationVelocityMps: {
          x: 0,
          y: 0,
          z: 0
        },
        sampleTimesSecondsFromReference: [
          0.5,
          1
        ],
        points: [
          {
            pointId: "center",
            positionCameraM: {
              x: 0,
              y: 0,
              z: 10
            }
          },
          {
            pointId: "left",
            positionCameraM: {
              x: -1,
              y: 0,
              z: 10
            }
          },
          {
            pointId: "right",
            positionCameraM: {
              x: 1,
              y: 0,
              z: 10
            }
          }
        ],
        frontoparallelPlane: {
          kind:
            "fronto-parallel-planar-patch",
          referenceDepthM: 10
        }
      }).value;

    const center =
      result
        .pointTrajectories
        .find(
          (point) =>
            point.pointId ===
            "center"
        )!;
    const left =
      result
        .pointTrajectories
        .find(
          (point) =>
            point.pointId ===
            "left"
        )!;
    const right =
      result
        .pointTrajectories
        .find(
          (point) =>
            point.pointId ===
            "right"
        )!;

    expect(
      center.nodes[1]!
        .deltaFromReferenceImagePlaneMm
        .distance
    ).toBeCloseTo(0, 14);
    expect(
      left.nodes[1]!
        .deltaFromReferenceImagePlaneMm
        .x
    ).toBeLessThan(0);
    expect(
      right.nodes[1]!
        .deltaFromReferenceImagePlaneMm
        .x
    ).toBeGreaterThan(0);

    expect(
      result
        .planarMagnificationDiagnostic
        ?.scaleByTime[1]
        ?.scaleFromReference
    ).toBeCloseTo(
      10 / 9,
      14
    );
    expect(
      left.nodes[1]!
        .planarMagnificationScaleFromReference
    ).toBeCloseTo(
      right.nodes[1]!
        .planarMagnificationScaleFromReference!,
      14
    );
    expect(result).toMatchObject({
      metricSceneDepthRequired:
        true,
      oneGlobalHomographyAuthorized:
        false,
      oneGlobalScaleAuthorizedForArbitrary3dGeometry:
        false,
      cameraRotationComposed:
        false,
      visibilityOcclusionModeled:
        false,
      blurKernelCalculated:
        false,
      radianceIntegrated:
        false,
      timeVaryingDefocusMayBeRequired:
        true
    });
  });

  it("keeps lateral and depth translation as spatially varying point trajectories instead of collapsing them to one scalar blur", () => {
    const result =
      calculateExtendedObjectProjectionTrajectory({
        objectId: "mixed",
        focalLengthMm: 85,
        focusDistanceM: 8,
        objectTranslationVelocityMps: {
          x: 0.5,
          y: 0.2,
          z: -0.5
        },
        cameraTranslationVelocityMps: {
          x: 0.1,
          y: 0,
          z: 0
        },
        sampleTimesSecondsFromReference: [
          0.1,
          0.2
        ],
        points: [
          {
            pointId: "near",
            positionCameraM: {
              x: -0.5,
              y: 0,
              z: 5
            }
          },
          {
            pointId: "far",
            positionCameraM: {
              x: 0.5,
              y: 0.2,
              z: 12
            }
          }
        ]
      }).value;

    const near =
      result
        .pointTrajectories[0]!
        .nodes[1]!;
    const far =
      result
        .pointTrajectories[1]!
        .nodes[1]!;

    expect(
      near
        .deltaFromReferenceImagePlaneMm
        .distance
    ).not.toBeCloseTo(
      far
        .deltaFromReferenceImagePlaneMm
        .distance,
      12
    );
    expect(
      result
        .planarMagnificationDiagnostic
    ).toBeNull();
    expect(
      result
        .relativeTranslationVelocityMps
    ).toEqual({
      x: 0.4,
      y: 0.2,
      z: -0.5
    });
  });

  it("reports one uniform planar scale under shared lateral plus axial rigid translation", () => {
    const result =
      calculateExtendedObjectProjectionTrajectory({
        objectId: "plane",
        focalLengthMm: 50,
        objectTranslationVelocityMps: {
          x: 1,
          y: 0,
          z: 2
        },
        cameraTranslationVelocityMps: {
          x: 0,
          y: 0,
          z: 0
        },
        sampleTimesSecondsFromReference: [
          0.25
        ],
        points: [
          {
            pointId: "a",
            positionCameraM: {
              x: -1,
              y: -1,
              z: 10
            }
          },
          {
            pointId: "b",
            positionCameraM: {
              x: 1,
              y: 1,
              z: 10
            }
          }
        ],
        frontoparallelPlane: {
          kind:
            "fronto-parallel-planar-patch",
          referenceDepthM: 10
        }
      }).value;

    expect(
      result
        .planarMagnificationDiagnostic
        ?.uniformScaleAuthorizedWithinDeclaredPatch
    ).toBe(true);
    expect(
      result
        .planarMagnificationDiagnostic
        ?.scaleByTime[0]
        ?.scaleFromReference
    ).toBeCloseTo(
      10 / 10.5,
      14
    );
    expect(
      result
        .pointTrajectories
        .every(
          (point) =>
            point.nodes[0]!
              .planarMagnificationScaleFromReference ===
            result
              .pointTrajectories[0]!
              .nodes[0]!
              .planarMagnificationScaleFromReference
        )
    ).toBe(true);
  });

  it("refuses to label depth-varying geometry as a fronto-parallel planar patch", () => {
    expect(() =>
      calculateExtendedObjectProjectionTrajectory({
        objectId: "not-plane",
        focalLengthMm: 50,
        objectTranslationVelocityMps: {
          x: 0,
          y: 0,
          z: 0
        },
        cameraTranslationVelocityMps: {
          x: 0,
          y: 0,
          z: 0
        },
        sampleTimesSecondsFromReference: [
          0.1
        ],
        points: [
          {
            pointId: "a",
            positionCameraM: {
              x: 0,
              y: 0,
              z: 5
            }
          },
          {
            pointId: "b",
            positionCameraM: {
              x: 0,
              y: 0,
              z: 6
            }
          }
        ],
        frontoparallelPlane: {
          kind:
            "fronto-parallel-planar-patch",
          referenceDepthM: 5
        }
      })
    ).toThrow(
      "must lie at frontoparallelPlane.referenceDepthM"
    );
  });

  it("fails closed when any point reaches or crosses the camera plane", () => {
    expect(() =>
      calculateExtendedObjectProjectionTrajectory({
        objectId: "crossing",
        focalLengthMm: 50,
        objectTranslationVelocityMps: {
          x: 0,
          y: 0,
          z: -2
        },
        cameraTranslationVelocityMps: {
          x: 0,
          y: 0,
          z: 0
        },
        sampleTimesSecondsFromReference: [
          1
        ],
        points: [{
          pointId: "point",
          positionCameraM: {
            x: 0.1,
            y: 0,
            z: 1
          }
        }]
      })
    ).toThrow(
      "must remain in front of the camera plane"
    );
  });
});

describe("capture-local extended-object projection", () => {
  it("uses each point's authoritative #12 local exposure interval", () => {
    const timing =
      rollingTiming();
    const result =
      calculateCaptureExtendedObjectTemporalProjection({
        objectId: "rolling-object",
        timing,
        focalLengthMm: 50,
        objectTranslationVelocityMps: {
          x: 0.2,
          y: 0,
          z: -0.2
        },
        cameraTranslationVelocityMps: {
          x: 0,
          y: 0,
          z: 0
        },
        temporalSampleCount: 2,
        points: [
          {
            pointId: "upper",
            destinationPointNative: {
              x: 50,
              y: 20
            },
            positionCameraM: {
              x: -0.5,
              y: 0,
              z: 8
            }
          },
          {
            pointId: "lower",
            destinationPointNative: {
              x: 50,
              y: 80
            },
            positionCameraM: {
              x: 0.5,
              y: 0,
              z: 8
            }
          }
        ],
        frontoparallelPlane: {
          kind:
            "fronto-parallel-planar-patch",
          referenceDepthM: 8
        }
      }).value;

    const upper =
      result
        .pointTrajectories[0]!;
    const lower =
      result
        .pointTrajectories[1]!;

    expect(
      upper
        .localExposureWindow
        .startSecondsFromCaptureReference
    ).toBeLessThan(
      lower
        .localExposureWindow
        .startSecondsFromCaptureReference
    );
    expect(
      upper.nodes[0]!
        .timeSecondsFromReference
    ).toBeLessThan(
      lower.nodes[0]!
        .timeSecondsFromReference
    );
    expect(
      upper.nodes[0]!
        .timeMeasureSeconds +
      upper.nodes[1]!
        .timeMeasureSeconds
    ).toBeCloseTo(
      upper
        .localExposureWindow
        .durationSeconds,
      14
    );
    expect(result).toMatchObject({
      timeReference:
        "first-opening-boundary-phase",
      temporalSampleCount: 2,
      planarMagnificationDiagnosticAvailable:
        true,
      sensorReadoutTimingUsedAsExposureTiming:
        false,
      visibilityOcclusionModeled:
        false,
      blurKernelCalculated:
        false,
      radianceIntegrated:
        false
    });
  });

  it("fails closed when an object point has no committed #12 exposure sample", () => {
    expect(() =>
      calculateCaptureExtendedObjectTemporalProjection({
        objectId: "missing",
        timing:
          rollingTiming(),
        focalLengthMm: 50,
        objectTranslationVelocityMps: {
          x: 0,
          y: 0,
          z: 0
        },
        cameraTranslationVelocityMps: {
          x: 0,
          y: 0,
          z: 0
        },
        temporalSampleCount: 2,
        points: [{
          pointId: "point",
          destinationPointNative: {
            x: 1,
            y: 1
          },
          positionCameraM: {
            x: 0,
            y: 0,
            z: 5
          }
        }]
      })
    ).toThrow(
      "must match exactly one committed exposure-window sample point"
    );
  });
});

describe("extended-object validation boundaries", () => {
  it("rejects duplicate point identity and non-increasing sample times", () => {
    expect(() =>
      calculateExtendedObjectProjectionTrajectory({
        objectId: "duplicates",
        focalLengthMm: 50,
        objectTranslationVelocityMps: {
          x: 0,
          y: 0,
          z: 0
        },
        cameraTranslationVelocityMps: {
          x: 0,
          y: 0,
          z: 0
        },
        sampleTimesSecondsFromReference: [
          0.1
        ],
        points: [
          {
            pointId: "same",
            positionCameraM: {
              x: 0,
              y: 0,
              z: 5
            }
          },
          {
            pointId: "same",
            positionCameraM: {
              x: 1,
              y: 0,
              z: 5
            }
          }
        ]
      })
    ).toThrow(
      "duplicate pointId"
    );

    expect(() =>
      calculateExtendedObjectProjectionTrajectory({
        objectId: "times",
        focalLengthMm: 50,
        objectTranslationVelocityMps: {
          x: 0,
          y: 0,
          z: 0
        },
        cameraTranslationVelocityMps: {
          x: 0,
          y: 0,
          z: 0
        },
        sampleTimesSecondsFromReference: [
          0.2,
          0.1
        ],
        points: [{
          pointId: "point",
          positionCameraM: {
            x: 0,
            y: 0,
            z: 5
          }
        }]
      })
    ).toThrow(
      "must be strictly increasing"
    );
  });

  it("rejects empty geometry and invalid reference depth", () => {
    expect(() =>
      calculateExtendedObjectProjectionTrajectory({
        objectId: "empty",
        focalLengthMm: 50,
        objectTranslationVelocityMps: {
          x: 0,
          y: 0,
          z: 0
        },
        cameraTranslationVelocityMps: {
          x: 0,
          y: 0,
          z: 0
        },
        sampleTimesSecondsFromReference: [
          0.1
        ],
        points: []
      })
    ).toThrow(
      "points must be a non-empty array"
    );

    expect(() =>
      calculateExtendedObjectProjectionTrajectory({
        objectId: "bad-depth",
        focalLengthMm: 50,
        objectTranslationVelocityMps: {
          x: 0,
          y: 0,
          z: 0
        },
        cameraTranslationVelocityMps: {
          x: 0,
          y: 0,
          z: 0
        },
        sampleTimesSecondsFromReference: [
          0.1
        ],
        points: [{
          pointId: "point",
          positionCameraM: {
            x: 0,
            y: 0,
            z: 5
          }
        }],
        frontoparallelPlane: {
          kind:
            "fronto-parallel-planar-patch",
          referenceDepthM: 0
        }
      })
    ).toThrow(
      "referenceDepthM"
    );
  });
});


describe("extended-object reference and relative-motion invariants", () => {
  it("allows signed physical sample times around a caller-declared reference phase", () => {
    const result =
      calculateExtendedObjectProjectionTrajectory({
        objectId: "signed-reference",
        focalLengthMm: 50,
        objectTranslationVelocityMps: {
          x: 1,
          y: 0,
          z: 0
        },
        cameraTranslationVelocityMps: {
          x: 0,
          y: 0,
          z: 0
        },
        sampleTimesSecondsFromReference: [
          -0.01,
          0,
          0.01
        ],
        points: [{
          pointId: "point",
          positionCameraM: {
            x: 0,
            y: 0,
            z: 5
          }
        }]
      }).value;

    expect(
      result
        .pointTrajectories[0]
        ?.nodes.map(
          (node) =>
            node
              .timeSecondsFromReference
        )
    ).toEqual([
      -0.01,
      0,
      0.01
    ]);
    expect(result.timeReference)
      .toBe(
        "caller-declared-common-reference-phase"
      );
  });

  it("cancels equal camera and object rigid translation without reclassifying either input", () => {
    const velocity = {
      x: 1,
      y: -0.25,
      z: 0.5
    };
    const result =
      calculateExtendedObjectProjectionTrajectory({
        objectId: "co-moving",
        focalLengthMm: 50,
        objectTranslationVelocityMps:
          velocity,
        cameraTranslationVelocityMps:
          velocity,
        sampleTimesSecondsFromReference: [
          0,
          0.25
        ],
        points: [{
          pointId: "point",
          positionCameraM: {
            x: 1,
            y: 0.5,
            z: 5
          }
        }]
      }).value;

    expect(
      result
        .objectTranslationVelocityMps
    ).toEqual(velocity);
    expect(
      result
        .cameraTranslationVelocityMps
    ).toEqual(velocity);
    expect(
      result
        .relativeTranslationVelocityMps
    ).toEqual({
      x: 0,
      y: 0,
      z: 0
    });
    expect(
      result
        .pointTrajectories[0]
        ?.nodes[1]
        ?.deltaFromReferenceImagePlaneMm
    ).toEqual({
      x: 0,
      y: 0,
      distance: 0
    });
    expect(
      result
        .timeVaryingDefocusMayBeRequired
    ).toBe(false);
  });
});

describe("extended-object projection rejects a missing, null or non-object sub-object with a domain error (2.0.0 pre-release review)", () => {
  it("probes every nested object of valid requests", async () => {
    const points = [{ pointId: "upper", destinationPointNative: { x: 50, y: 20 }, positionCameraM: { x: -0.5, y: 0, z: 8 } },
      { pointId: "lower", destinationPointNative: { x: 50, y: 80 }, positionCameraM: { x: 0.5, y: 0, z: 8 } }];
    const plane = { kind: "fronto-parallel-planar-patch", referenceDepthM: 8 };
    const cases: [string, (input: unknown) => unknown, object][] = [
      ["calculateExtendedObjectProjectionTrajectory", (input): unknown => calculateExtendedObjectProjectionTrajectory(input as never), { objectId: "card", focalLengthMm: 50,
        objectTranslationVelocityMps: { x: 0.2, y: 0, z: -0.2 }, cameraTranslationVelocityMps: { x: 0, y: 0, z: 0 }, sampleTimesSecondsFromReference: [0.5],
        points: points.map(({ pointId, positionCameraM }) => ({ pointId, positionCameraM })), frontoparallelPlane: plane }],
      ["calculateCaptureExtendedObjectTemporalProjection", (input): unknown => calculateCaptureExtendedObjectTemporalProjection(input as never), { objectId: "rolling-object",
        timing: rollingTiming(), focalLengthMm: 50, objectTranslationVelocityMps: { x: 0.2, y: 0, z: -0.2 }, cameraTranslationVelocityMps: { x: 0, y: 0, z: 0 },
        temporalSampleCount: 2, points, frontoparallelPlane: plane }]
    ];
    for (const [name, call, input] of cases) {
      expect(() => call(input), name).not.toThrow();
      const { probedPaths, escaped } = await probeSubObjects(call, input, { maximumDepth: 4 });
      expect(probedPaths, name).toBeGreaterThan(3);
      expect(escaped, name).toEqual([]);
    }
  });
});

describe("misspelled nested keys (sensor-14, #701)", () => {
  const input = (overrides: Record<string, unknown>): never => ({ objectId: "card", focalLengthMm: 50, objectTranslationVelocityMps: { x: 0.2, y: 0, z: -0.2 },
    cameraTranslationVelocityMps: { x: 0, y: 0, z: 0 }, sampleTimesSecondsFromReference: [0.5],
    points: [{ pointId: "a", positionCameraM: { x: -0.5, y: 0, z: 8 } }, { pointId: "b", positionCameraM: { x: 0.5, y: 0, z: 8 } }],
    frontoparallelPlane: { kind: "fronto-parallel-planar-patch", referenceDepthM: 8 }, ...overrides }) as never;
  const unknown = expect.objectContaining({ name: "InvalidConfigurationError", message: expect.stringContaining("unknown field") });
  it("refuses extra keys in points, vectors and the plane declaration", () => {
    expect(() => calculateExtendedObjectProjectionTrajectory(input({}))).not.toThrow();
    expect(() => calculateExtendedObjectProjectionTrajectory(input({ frontoparallelPlane: { kind: "fronto-parallel-planar-patch", referenceDepthM: 8, extra: 1 } }))).toThrow(unknown);
    expect(() => calculateExtendedObjectProjectionTrajectory(input({ cameraTranslationVelocityMps: { x: 0, y: 0, z: 0, w: 1 } }))).toThrow(unknown);
    expect(() => calculateExtendedObjectProjectionTrajectory(input({ points: [{ pointId: "a", positionCameraM: { x: 0, y: 0, z: 8 }, destinationPointNative: { x: 1, y: 1 } }] })))
      .toThrow(unknown);
  });
});
