// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  createExposureMeterTargetFromMeteringResult,
  meterRelativeExposure,
  parseExposureMeteringProfile,
  parseExposureProgramLineProfile,
  parseGenericBodyExposureCapabilityProfile,
  parseGenericLensExposureCapabilityProfile,
  resolveCaptureGeometry,
  resolveFullAutoExposureMode,
  resolveGenericEquipmentExposureCapabilities,
  resolveProgramAutoExposureMode,
  simulateCapture,
  InvalidConfigurationError,
  InvalidScientificInputError,
  type ExposureMeterTarget,
  type ExposureProgramLineProfile,
  type FullAutoExposurePolicy,
  type ResolvedGenericEquipmentExposureCapabilities
} from "../src/index.js";
import { probeSubObjects } from "./helpers/sub-object-probe.js";

const evidence = (ref: string) => [{
  sourceOrigin: "photivra" as const,
  sourceReference: ref,
  reuseStatus: "photivra-owned" as const
}] as const;

const referenceExposure = {
  aperture: 4,
  shutterSeconds: 1 / 125,
  iso: 100
};

const capabilities = (options: {
  autoIso?: "supported" | "unsupported" | "unknown";
  shutterGrid?: "continuous" | readonly number[];
  apertureGrid?: "continuous" | readonly number[];
  isoValues?: readonly number[];
} = {}): ResolvedGenericEquipmentExposureCapabilities => {
  const body = parseGenericBodyExposureCapabilityProfile({
    schemaVersion: "0.1.0",
    profileId: "body",
    profileVersion: "1.0.0",
    scientificStatus: "approximation",
    evidence: evidence("body"),
    shutter: {
      durationSecondsRange: {
        value: {
          minimum: 1 / 8000,
          maximum: 30
        },
        evidence: evidence("shutter")
      },
      settingGrid:
        options.shutterGrid &&
        options.shutterGrid !== "continuous"
          ? {
              kind: "discrete-values",
              values: {
                value:
                  options.shutterGrid,
                evidence:
                  evidence("shutter-grid")
              }
            }
          : {
              kind:
                "continuous-within-range"
            }
    },
    iso: {
      range: {
        value: {
          minimum: 100,
          maximum: 12800
        },
        evidence: evidence("iso")
      },
      settingGrid: {
        kind: "discrete-values",
        values: {
          value:
            options.isoValues ?? [
              100,
              200,
              400,
              800,
              1600,
              3200,
              6400,
              12800
            ],
          evidence:
            evidence("iso-grid")
        }
      },
      autoIso: {
        value:
          options.autoIso ??
          "supported",
        evidence: evidence("auto")
      }
    }
  });

  const lens = parseGenericLensExposureCapabilityProfile({
    schemaVersion: "0.1.0",
    profileId: "lens",
    profileVersion: "1.0.0",
    scientificStatus: "approximation",
    evidence: evidence("lens"),
    focalLengthMmRange: {
      value: {
        minimum: 50,
        maximum: 50
      },
      evidence: evidence("focal")
    },
    aperture: {
      widestAvailableFNumber: {
        kind: "constant",
        fNumber: {
          value: 1.8,
          evidence: evidence("wide")
        }
      },
      narrowestAvailableFNumber: {
        value: 16,
        evidence: evidence("narrow")
      },
      settingGrid:
        options.apertureGrid &&
        options.apertureGrid !== "continuous"
          ? {
              kind: "discrete-values",
              values: {
                value:
                  options.apertureGrid,
                evidence:
                  evidence("ap-grid")
              }
            }
          : {
              kind:
                "continuous-within-range"
            }
    }
  });

  return resolveGenericEquipmentExposureCapabilities({
    bodyProfile: body,
    lensProfile: lens,
    selectedFocalLengthMm: 50
  });
};

const programLine = (): ExposureProgramLineProfile =>
  parseExposureProgramLineProfile({
    schemaVersion: "0.1.0",
    profileId: "balanced-line",
    profileVersion: "1.0.0",
    scientificStatus: "approximation",
    policyKind: "generic-program-line",
    interpolation:
      "log2-aperture-shutter",
    evidence: evidence("program-line"),
    limitations: [
      "Generic educational policy."
    ],
    nodes: [
      {
        nodeId: "minus-two",
        opticalExposureStopsFromReference:
          -2,
        aperture: 8,
        shutterSeconds: 1 / 125
      },
      {
        nodeId: "zero",
        opticalExposureStopsFromReference:
          0,
        aperture: 4,
        shutterSeconds: 1 / 125
      },
      {
        nodeId: "plus-two",
        opticalExposureStopsFromReference:
          2,
        aperture: 4,
        shutterSeconds: 4 / 125
      }
    ]
  });

const targetForScale = (
  scale: number,
  targetId = "target"
): ExposureMeterTarget => {
  const profile =
    parseExposureMeteringProfile({
      schemaVersion: "0.1.0",
      profileId: "meter",
      scientificStatus: "approximation",
      inputDomain:
        "relative-pre-exposure-linear-signal",
      captureRegion:
        "oriented-active-capture",
      policy: {
        kind: "multi-zone-uniform"
      },
      target: {
        kind:
          "relative-signal-reference",
        targetRelativeSignal: 1,
        evidence: evidence("target")
      },
      evidence: evidence("meter"),
      limitations: ["test"]
    });

  const meter =
    meterRelativeExposure({
      profile,
      sampleSet: {
        measurementId: "m",
        sceneStateId: "s",
        inputDomain:
          "relative-pre-exposure-linear-signal",
        captureRegion:
          "oriented-active-capture",
        captureGeometry:
          resolveCaptureGeometry({
            imagingArea: {
              widthMm: 36,
              heightMm: 24
            },
            nativeRaster: {
              pixelWidth: 6000,
              pixelHeight: 4000
            },
            orientation: "landscape"
          }).value,
        processingState: {
          exposureSettingsApplied: false,
          whiteBalanceApplied: false,
          toneMappingApplied: false,
          displayGammaApplied: false,
          sharpeningApplied: false
        },
        samples: [{
          sampleId: "z",
          positionOrientedCaptureUv: {
            u: 0.5,
            v: 0.5
          },
          relativeLinearSignal:
            1 / scale,
          areaWeight: 1
        }]
      }
    }).value;

  return createExposureMeterTargetFromMeteringResult({
    targetId,
    meterResult: meter
  });
};

const darkTarget = (): ExposureMeterTarget => {
  const profile =
    parseExposureMeteringProfile({
      schemaVersion: "0.1.0",
      profileId: "meter",
      scientificStatus: "approximation",
      inputDomain:
        "relative-pre-exposure-linear-signal",
      captureRegion:
        "oriented-active-capture",
      policy: {
        kind: "multi-zone-uniform"
      },
      target: {
        kind:
          "relative-signal-reference",
        targetRelativeSignal: 1,
        evidence: evidence("target")
      },
      evidence: evidence("meter"),
      limitations: ["test"]
    });
  const meter =
    meterRelativeExposure({
      profile,
      sampleSet: {
        measurementId: "dark",
        sceneStateId: "dark",
        inputDomain:
          "relative-pre-exposure-linear-signal",
        captureRegion:
          "oriented-active-capture",
        captureGeometry:
          resolveCaptureGeometry({
            imagingArea: {
              widthMm: 36,
              heightMm: 24
            },
            nativeRaster: {
              pixelWidth: 6000,
              pixelHeight: 4000
            },
            orientation: "landscape"
          }).value,
        processingState: {
          exposureSettingsApplied: false,
          whiteBalanceApplied: false,
          toneMappingApplied: false,
          displayGammaApplied: false,
          sharpeningApplied: false
        },
        samples: [{
          sampleId: "z",
          positionOrientedCaptureUv: {
            u: 0.5,
            v: 0.5
          },
          relativeLinearSignal: 0,
          areaWeight: 1
        }]
      }
    }).value;
  return createExposureMeterTargetFromMeteringResult({
    targetId: "dark-target",
    meterResult: meter
  });
};

describe("generic exposure program-line profile", () => {
  it("parses a versioned generic program line", () => {
    const line = programLine();
    expect(line.profileId)
      .toBe("balanced-line");
    expect(line.nodes.map(
      node =>
        node.opticalExposureStopsFromReference
    )).toEqual([-2, 0, 2]);
  });

  it("rejects unordered stops and duplicate node IDs", () => {
    expect(() =>
      parseExposureProgramLineProfile({
        ...programLine(),
        nodes: [
          {
            nodeId: "a",
            opticalExposureStopsFromReference:
              0,
            aperture: 4,
            shutterSeconds: 1 / 125
          },
          {
            nodeId: "b",
            opticalExposureStopsFromReference:
              -1,
            aperture: 5.6,
            shutterSeconds: 1 / 125
          }
        ]
      })
    ).toThrow(
      "must be strictly increasing"
    );

    expect(() =>
      parseExposureProgramLineProfile({
        ...programLine(),
        nodes: [
          {
            nodeId: "same",
            opticalExposureStopsFromReference:
              -1,
            aperture: 5.656854249,
            shutterSeconds: 1 / 125
          },
          {
            nodeId: "same",
            opticalExposureStopsFromReference:
              0,
            aperture: 4,
            shutterSeconds: 1 / 125
          }
        ]
      })
    ).toThrow(
      "nodeId must not contain duplicates"
    );
  });
});

describe("Program Auto", () => {
  it("interpolates aperture/shutter in log2 space for manual ISO", () => {
    const result =
      resolveProgramAutoExposureMode({
        target: targetForScale(2),
        capabilities: capabilities(),
        referenceExposure,
        programLine: programLine(),
        isoControl: {
          kind: "manual",
          iso: 100
        }
      });

    expect(result.status)
      .toBe("resolved");
    if (
      result.status !== "resolved" ||
      result.isoControl !== "manual"
    ) {
      throw new Error(
        "Expected resolved Program manual ISO."
      );
    }
    expect(
      result.programLineSelection.position
    ).toBe("within-line");
    expect(
      result.programLineSelection
        .interpolationPhase
    ).toBeCloseTo(0.5, 12);
    expect(
      result.resolvedSettings.aperture
    ).toBeCloseTo(4, 12);
    expect(
      result.resolvedSettings
        .shutterSeconds
    ).toBeCloseTo(2 / 125, 12);
    expect(
      result.targetResidual.state
    ).toBe("matched");
  });

  it("clamps to the program-line endpoint and reports manual-ISO residual", () => {
    const result =
      resolveProgramAutoExposureMode({
        target: targetForScale(16),
        capabilities: capabilities(),
        referenceExposure,
        programLine: programLine(),
        isoControl: {
          kind: "manual",
          iso: 100
        }
      });

    expect(result.status)
      .toBe("resolved");
    if (
      result.status !== "resolved" ||
      result.isoControl !== "manual"
    ) {
      throw new Error(
        "Expected resolved Program manual ISO."
      );
    }
    expect(
      result.programLineSelection.position
    ).toBe("above-line");
    expect(
      result.resolvedSettings
        .shutterSeconds
    ).toBeCloseTo(4 / 125, 12);
    expect(
      result.targetResidual.state
    ).toBe("under-target");
    expect(
      result.targetResidual
        .residualStops
    ).toBeCloseTo(2, 12);
  });

  // foundation-07 (#699): a manual-ISO target beyond either end of the line names the line's end as the limit.
  it("reports the program line's end as the limiting constraint with a manual ISO", async () => {
    for (const [scale, position, constraint] of [[16, "above-line", "program-line-maximum"], [1 / 4096, "below-line", "program-line-minimum"]] as const) {
      const result = resolveProgramAutoExposureMode({ target: targetForScale(scale), capabilities: capabilities(), referenceExposure, programLine: programLine(),
        isoControl: { kind: "manual", iso: 100 } });
      if (result.status !== "resolved") throw new Error("Expected resolved Program manual ISO.");
      expect(result.programLineSelection.position).toBe(position);
      expect(result.targetResidual.limitingConstraint).toBe(constraint);
    }
    const capture = await simulateCapture({ scene: { preset: "uniform" }, exposure: { mode: "program", iso: 100 }, illuminanceLux: 0.5, output: { width: 8, height: 8 } });
    expect(capture.exposure.settings).toEqual({ fNumber: 4, shutterSeconds: 1.024, iso: 100 });
    expect((capture.exposure.resolution as { targetResidual?: unknown } | undefined)?.targetResidual).toMatchObject({ state: "under-target", limitingConstraint: "program-line-maximum" });
  });

  // foundation-08 (#699): a target whose scale and stops disagree, or whose copied fields are not valid, is refused.
  it("refuses an inconsistent or malformed meter target", () => {
    const resolve = (target: unknown): unknown => resolveProgramAutoExposureMode({ target: target as ExposureMeterTarget, capabilities: capabilities(), referenceExposure,
      programLine: programLine(), isoControl: { kind: "automatic", isoBaseline: "minimum-selectable", isoQuantizationPolicy: "nearest-log2-lower-on-tie" } });
    const base = targetForScale(4);
    expect(() => resolve(base)).not.toThrow();
    expect(() => resolve({ ...base, exposureOffsetStopsToTarget: 0 })).toThrow("target.requiredExposureScaleToTarget is inconsistent with target.exposureOffsetStopsToTarget.");
    expect(() => resolve({ ...base, exposureOffsetStopsToTarget: 0 })).toThrow(InvalidScientificInputError);
    expect(() => resolve({ ...base, sourceMeterSnapshot: { ...base.sourceMeterSnapshot, measurementId: 5 } })).toThrow(InvalidConfigurationError);
    expect(() => resolve({ ...base, sourceMeterSnapshot: { ...base.sourceMeterSnapshot, sourceKind: "made-up" } })).toThrow(InvalidConfigurationError);
    for (const [field, value] of [["baseTargetRelativeSignal", Number.NaN], ["meteredRelativeSignal", "1"], ["exposureCompensationStops", Number.POSITIVE_INFINITY],
      ["baseTargetRelativeSignal", [1]]] as const) {
      expect(() => resolve({ ...base, [field]: value }), field).toThrow(InvalidScientificInputError);
    }
  });

  it("uses Auto ISO to fill exposure beyond the program-line endpoint", () => {
    const result =
      resolveProgramAutoExposureMode({
        target: targetForScale(16),
        capabilities: capabilities(),
        referenceExposure,
        programLine: programLine(),
        isoControl: {
          kind: "automatic",
          isoBaseline:
            "minimum-selectable",
          isoQuantizationPolicy:
            "nearest-log2-lower-on-tie"
        }
      });

    expect(result.status)
      .toBe("resolved");
    if (
      result.status !== "resolved" ||
      result.isoControl !== "automatic"
    ) {
      throw new Error(
        "Expected resolved Program Auto ISO."
      );
    }
    expect(
      result.programLineSelection.position
    ).toBe("above-line");
    expect(
      result.resolvedSettings
    ).toEqual({
      aperture: 4,
      shutterSeconds: 4 / 125,
      iso: 400
    });
    expect(
      result.targetResidual.state
    ).toBe("matched");
  });

  it("keeps minimum ISO and reports over-target residual below the program line", () => {
    const result =
      resolveProgramAutoExposureMode({
        target: targetForScale(0.125),
        capabilities: capabilities(),
        referenceExposure,
        programLine: programLine(),
        isoControl: {
          kind: "automatic",
          isoBaseline:
            "minimum-selectable",
          isoQuantizationPolicy:
            "nearest-log2-lower-on-tie"
        }
      });

    expect(result.status)
      .toBe("resolved");
    if (
      result.status !== "resolved" ||
      result.isoControl !== "automatic"
    ) {
      throw new Error(
        "Expected resolved Program Auto ISO."
      );
    }
    expect(
      result.programLineSelection.position
    ).toBe("below-line");
    expect(
      result.resolvedSettings.iso
    ).toBe(100);
    expect(
      result.isoResolution.clamped
    ).toBe("minimum");
    expect(
      result.targetResidual.state
    ).toBe("over-target");
  });

  it("quantizes program-line aperture/shutter before Auto ISO fills the residual", () => {
    const result =
      resolveProgramAutoExposureMode({
        target: targetForScale(2),
        capabilities: capabilities({
          shutterGrid: [
            1 / 125,
            1 / 60,
            1 / 30
          ],
          apertureGrid: [
            1.8,
            2.8,
            4,
            5.6,
            8,
            11,
            16
          ]
        }),
        referenceExposure,
        programLine: programLine(),
        isoControl: {
          kind: "automatic",
          isoBaseline:
            "minimum-selectable",
          isoQuantizationPolicy:
            "nearest-log2-lower-on-tie"
        }
      });

    expect(result.status)
      .toBe("resolved");
    if (
      result.status !== "resolved" ||
      result.isoControl !== "automatic"
    ) {
      throw new Error(
        "Expected resolved Program Auto ISO."
      );
    }
    expect(
      result.programLineSelection
        .shutterQuantized
    ).toBe(true);
    expect(
      result.resolvedSettings
        .shutterSeconds
    ).toBeCloseTo(1 / 60, 12);
  });

  it("blocks no-signal and unavailable Auto ISO", () => {
    const dark =
      resolveProgramAutoExposureMode({
        target: darkTarget(),
        capabilities: capabilities(),
        referenceExposure,
        programLine: programLine(),
        isoControl: {
          kind: "manual",
          iso: 100
        }
      });
    expect(dark).toMatchObject({
      status: "blocked",
      blocker: "target-no-signal"
    });

    const unavailable =
      resolveProgramAutoExposureMode({
        target: targetForScale(1),
        capabilities: capabilities({
          autoIso: "unknown"
        }),
        referenceExposure,
        programLine: programLine(),
        isoControl: {
          kind: "automatic",
          isoBaseline:
            "minimum-selectable",
          isoQuantizationPolicy:
            "nearest-log2-lower-on-tie"
        }
      });
    expect(unavailable).toMatchObject({
      status: "blocked",
      blocker: "auto-iso-unknown"
    });
  });

  it("rejects a program node whose declared stops disagree with its physical pair", () => {
    const line = programLine();
    expect(() =>
      resolveProgramAutoExposureMode({
        target: targetForScale(1),
        capabilities: capabilities(),
        referenceExposure,
        programLine: {
          ...line,
          nodes: line.nodes.map(
            (node, index) =>
              index === 1
                ? {
                    ...node,
                    opticalExposureStopsFromReference:
                      0.25
                  }
                : node
          )
        },
        isoControl: {
          kind: "manual",
          iso: 100
        }
      })
    ).toThrow(
      "is inconsistent with its aperture/shutter pair"
    );
  });
});

describe("Full Auto exposure", () => {
  const policy = (): FullAutoExposurePolicy => ({
    kind:
      "generic-program-line-minimum-iso" as const,
    programLine: programLine(),
    isoBaseline:
      "minimum-selectable" as const,
    isoQuantizationPolicy:
      "nearest-log2-lower-on-tie" as const
  });

  it("resolves all three exposure axes through the same program-line mechanics", () => {
    const result =
      resolveFullAutoExposureMode({
        target: targetForScale(16),
        capabilities: capabilities(),
        referenceExposure,
        policy: policy()
      });
    expect(result.status)
      .toBe("resolved");
    if (result.status !== "resolved") {
      throw new Error(
        "Expected resolved Full Auto exposure."
      );
    }
    expect(result.resolvedSettings)
      .toEqual({
        aperture: 4,
        shutterSeconds: 4 / 125,
        iso: 400
      });
    expect(result.axisOwnership)
      .toEqual({
        aperture: "automatic",
        shutter: "automatic",
        iso: "automatic"
      });
    expect(result.autofocusResolved)
      .toBe(false);
    expect(result.whiteBalanceResolved)
      .toBe(false);
    expect(result.flashResolved)
      .toBe(false);
    expect(result.driveResolved)
      .toBe(false);
    expect(
      result.sceneRecognitionResolved
    ).toBe(false);
    expect(
      result.stabilizationPolicyResolved
    ).toBe(false);
  });

  it("matches Program Auto physical settings under the same line and Auto ISO policy", () => {
    const target = targetForScale(16);
    const program =
      resolveProgramAutoExposureMode({
        target,
        capabilities: capabilities(),
        referenceExposure,
        programLine: programLine(),
        isoControl: {
          kind: "automatic",
          isoBaseline:
            "minimum-selectable",
          isoQuantizationPolicy:
            "nearest-log2-lower-on-tie"
        }
      });
    const full =
      resolveFullAutoExposureMode({
        target,
        capabilities: capabilities(),
        referenceExposure,
        policy: policy()
      });

    if (
      program.status !== "resolved" ||
      program.isoControl !==
        "automatic" ||
      full.status !== "resolved"
    ) {
      throw new Error(
        "Expected resolved automatic modes."
      );
    }
    expect(full.resolvedSettings)
      .toEqual(
        program.resolvedSettings
      );
  });

  it("blocks no-signal and unsupported Auto ISO", () => {
    const dark =
      resolveFullAutoExposureMode({
        target: darkTarget(),
        capabilities: capabilities(),
        referenceExposure,
        policy: policy()
      });
    expect(dark).toMatchObject({
      status: "blocked",
      blocker: "target-no-signal"
    });

    const unsupported =
      resolveFullAutoExposureMode({
        target: targetForScale(1),
        capabilities: capabilities({
          autoIso: "unsupported"
        }),
        referenceExposure,
        policy: policy()
      });
    expect(unsupported).toMatchObject({
      status: "blocked",
      blocker:
        "auto-iso-unsupported"
    });
  });

  it("rejects invalid Full Auto policy metadata", () => {
    expect(() =>
      resolveFullAutoExposureMode({
        target: targetForScale(1),
        capabilities: capabilities(),
        referenceExposure,
        policy: {
          ...policy(),
          kind: "magic"
        } as never
      })
    ).toThrow(
      "Full Auto exposure policy is invalid"
    );
  });
});

describe("program-line fail-closed schema coverage", () => {
  it("rejects invalid schema metadata and insufficient nodes", () => {
    const base = programLine();

    expect(() =>
      parseExposureProgramLineProfile({
        ...base,
        schemaVersion: "9.9.9"
      })
    ).toThrow("schemaVersion must be");

    expect(() =>
      parseExposureProgramLineProfile({
        ...base,
        scientificStatus: "calibrated"
      })
    ).toThrow(
      'scientificStatus must be "approximation"'
    );

    expect(() =>
      parseExposureProgramLineProfile({
        ...base,
        policyKind: "manufacturer-program"
      })
    ).toThrow(
      'policyKind must be "generic-program-line"'
    );

    expect(() =>
      parseExposureProgramLineProfile({
        ...base,
        interpolation: "linear-aperture"
      })
    ).toThrow(
      'interpolation must be "log2-aperture-shutter"'
    );

    expect(() =>
      parseExposureProgramLineProfile({
        ...base,
        nodes: [base.nodes[0]]
      })
    ).toThrow(
      "must contain at least two nodes"
    );
  });

  it("rejects malformed node numbers, IDs, and limitations", () => {
    const base = programLine();

    expect(() =>
      parseExposureProgramLineProfile({
        ...base,
        nodes: [
          {
            ...base.nodes[0],
            nodeId: " "
          },
          base.nodes[1]
        ]
      })
    ).toThrow(
      "nodeId must be a non-empty string"
    );

    expect(() =>
      parseExposureProgramLineProfile({
        ...base,
        nodes: [
          {
            ...base.nodes[0],
            opticalExposureStopsFromReference:
              Number.NaN
          },
          base.nodes[1]
        ]
      })
    ).toThrow(
      "opticalExposureStopsFromReference must be finite"
    );

    expect(() =>
      parseExposureProgramLineProfile({
        ...base,
        nodes: [
          {
            ...base.nodes[0],
            aperture: 0
          },
          base.nodes[1]
        ]
      })
    ).toThrow(
      "aperture must be greater than zero"
    );

    expect(() =>
      parseExposureProgramLineProfile({
        ...base,
        nodes: [
          {
            ...base.nodes[0],
            shutterSeconds: 0
          },
          base.nodes[1]
        ]
      })
    ).toThrow(
      "shutterSeconds must be greater than zero"
    );

    expect(() =>
      parseExposureProgramLineProfile({
        ...base,
        limitations: [
          "same",
          "same"
        ]
      })
    ).toThrow(
      "limitations must not contain duplicates"
    );
  });
});

describe("Program Auto fail-closed control coverage", () => {
  it("rejects invalid ISO-control and Auto ISO policy metadata", () => {
    expect(() =>
      resolveProgramAutoExposureMode({
        target: targetForScale(1),
        capabilities: capabilities(),
        referenceExposure,
        programLine: programLine(),
        isoControl: {
          kind: "magic"
        } as never
      })
    ).toThrow(
      "isoControl.kind is invalid for Program Auto"
    );

    expect(() =>
      resolveProgramAutoExposureMode({
        target: targetForScale(1),
        capabilities: capabilities(),
        referenceExposure,
        programLine: programLine(),
        isoControl: {
          kind: "automatic",
          isoBaseline:
            "reference",
          isoQuantizationPolicy:
            "nearest-log2-lower-on-tie"
        } as never
      })
    ).toThrow(
      "Program Auto ISO policy is invalid"
    );
  });

  it("rejects program nodes outside current aperture/shutter capability", () => {
    const base = programLine();

    expect(() =>
      resolveProgramAutoExposureMode({
        target: targetForScale(1),
        capabilities: capabilities(),
        referenceExposure,
        programLine: {
          ...base,
          nodes: base.nodes.map(
            (node, index) =>
              index === 0
                ? {
                    ...node,
                    aperture: 32
                  }
                : node
          )
        },
        isoControl: {
          kind: "manual",
          iso: 100
        }
      })
    ).toThrow(
      "Program-line aperture lies outside"
    );

    expect(() =>
      resolveProgramAutoExposureMode({
        target: targetForScale(1),
        capabilities: capabilities(),
        referenceExposure,
        programLine: {
          ...base,
          nodes: base.nodes.map(
            (node, index) =>
              index === 2
                ? {
                    ...node,
                    shutterSeconds: 60
                  }
                : node
          )
        },
        isoControl: {
          kind: "manual",
          iso: 100
        }
      })
    ).toThrow(
      "Program-line shutter duration lies outside"
    );
  });
});


describe("Program Auto and Full Auto reject a missing, null or non-object sub-object with a domain error (2.0.0 pre-release review)", () => {
  it("probes every nested object of a valid request", async () => {
    const cases: [string, (input: unknown) => unknown, object][] = [
      ["resolveProgramAutoExposureMode", (input): unknown => resolveProgramAutoExposureMode(input as never), { target: targetForScale(16), capabilities: capabilities(),
        referenceExposure, programLine: programLine(), isoControl: { kind: "automatic", isoBaseline: "minimum-selectable", isoQuantizationPolicy: "nearest-log2-lower-on-tie" } }],
      ["resolveFullAutoExposureMode", (input): unknown => resolveFullAutoExposureMode(input as never), { target: targetForScale(16), capabilities: capabilities(),
        referenceExposure, policy: { kind: "generic-program-line-minimum-iso", programLine: programLine(), isoBaseline: "minimum-selectable",
          isoQuantizationPolicy: "nearest-log2-lower-on-tie" } }]
    ];
    for (const [name, call, input] of cases) {
      expect(() => call(input), name).not.toThrow();
      const { probedPaths, escaped } = await probeSubObjects(call, input, { maximumDepth: 4 });
      expect(probedPaths, name).toBeGreaterThan(5);
      expect(escaped, name).toEqual([]);
    }
  });
});
