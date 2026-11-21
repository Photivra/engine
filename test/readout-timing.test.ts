// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  calculateSensorReadoutTiming,
  resolveCaptureGeometry,
  transformNativeRasterVectorToOriented,
  type CaptureOrientation,
  type RollingSensorReadoutTimingDeclaration,
  type SensorReadoutTiming,
  type SourcedSensorTimingSeconds
} from "../src/index.js";

type PhotivraOwnedEvidence = readonly [
  {
    sourceOrigin: "photivra";
    sourceReference: string;
    reuseStatus: "photivra-owned";
  }
];

const nativeRaster = { pixelWidth: 6000, pixelHeight: 4000 };

const factEvidence = (sourceReference: string): PhotivraOwnedEvidence =>
  [
    {
      sourceOrigin: "photivra",
      sourceReference,
      reuseStatus: "photivra-owned"
    }
  ] as const;

const secondsFact = (
  value: number,
  sourceReference: string
): SourcedSensorTimingSeconds =>
  ({
    value,
    unit: "s" as const,
    evidence: factEvidence(sourceReference)
  });

const rollingReadout = (): RollingSensorReadoutTimingDeclaration =>
  ({
    readoutMode: "rolling" as const,
    captureReadoutDurationSeconds: secondsFact(
      0.024,
      "test:capture-readout-duration"
    ),
    scanDirectionNative: {
      value: "top-to-bottom" as const,
      evidence: factEvidence("test:scan-direction")
    },
    spatialSamplingSkewSeconds: secondsFact(
      0.02,
      "test:spatial-sampling-skew"
    )
  });

describe("sensor readout scan timing", () => {
  it("maps rolling spatial phase across an active capture in native coordinates", () => {
    const result = calculateSensorReadoutTiming({
      nativeRaster,
      activeCaptureRect: {
        x: 1000,
        y: 500,
        width: 3000,
        height: 2000
      },
      shutterMechanism: "electronic",
      readout: rollingReadout(),
      samplePointsNative: [
        { x: 2500, y: 500 },
        { x: 2500, y: 1500 },
        { x: 2500, y: 2500 }
      ]
    });

    expect(
      result.value.samples.map((sample) => sample.normalizedScanPosition)
    ).toEqual([0, 0.5, 1]);
    expect(
      result.value.samples.map((sample) => sample.readoutPhaseOffsetSeconds)
    ).toEqual([0, 0.01, 0.02]);
    expect(result.value.scan?.unitVectorNative).toEqual({ x: 0, y: 1 });
  });

  it("keeps total data-readout duration distinct from spatial sampling skew", () => {
    const result = calculateSensorReadoutTiming({
      nativeRaster,
      shutterMechanism: "electronic",
      readout: rollingReadout(),
      samplePointsNative: [
        { x: 3000, y: 0 },
        { x: 3000, y: 4000 }
      ]
    });

    expect(result.value.captureReadoutDurationSeconds.value).toBe(0.024);
    expect(result.value.captureReadoutDurationSeconds.unit).toBe("s");
    expect(result.value.maximumSpatialSamplingSkewSeconds).toBe(0.02);
    expect(result.value.samples[1]?.readoutPhaseOffsetSeconds).toBe(0.02);
  });

  it("gives global readout zero spatial phase skew even with non-zero data-readout duration", () => {
    const result = calculateSensorReadoutTiming({
      nativeRaster,
      shutterMechanism: "mechanical",
      readout: {
        readoutMode: "global",
        captureReadoutDurationSeconds: secondsFact(
          0.012,
          "test:global-data-readout-duration"
        )
      },
      samplePointsNative: [
        { x: 0, y: 0 },
        { x: 3000, y: 2000 },
        { x: 6000, y: 4000 }
      ]
    });

    expect(result.value.scan).toBeNull();
    expect(result.value.maximumSpatialSamplingSkewSeconds).toBe(0);
    expect(
      result.value.samples.map((sample) => sample.readoutPhaseOffsetSeconds)
    ).toEqual([0, 0, 0]);
    expect(
      result.value.samples.map((sample) => sample.normalizedScanPosition)
    ).toEqual([null, null, null]);
  });

  it("maps every supported single-axis native scan direction from first to last edge", () => {
    const cases = [
      {
        direction: "top-to-bottom" as const,
        points: [
          { x: 3000, y: 0 },
          { x: 3000, y: 4000 }
        ],
        vector: { x: 0, y: 1 }
      },
      {
        direction: "bottom-to-top" as const,
        points: [
          { x: 3000, y: 4000 },
          { x: 3000, y: 0 }
        ],
        vector: { x: 0, y: -1 }
      },
      {
        direction: "left-to-right" as const,
        points: [
          { x: 0, y: 2000 },
          { x: 6000, y: 2000 }
        ],
        vector: { x: 1, y: 0 }
      },
      {
        direction: "right-to-left" as const,
        points: [
          { x: 6000, y: 2000 },
          { x: 0, y: 2000 }
        ],
        vector: { x: -1, y: 0 }
      }
    ];

    for (const item of cases) {
      const value = calculateSensorReadoutTiming({
        nativeRaster,
        shutterMechanism: "electronic",
        readout: {
          ...rollingReadout(),
          scanDirectionNative: {
            value: item.direction,
            evidence: factEvidence("test:" + item.direction)
          }
        },
        samplePointsNative: item.points
      }).value;

      expect(value.scan?.unitVectorNative).toEqual(item.vector);
      expect(
        value.samples.map((sample) => sample.normalizedScanPosition)
      ).toEqual([0, 1]);
      expect(
        value.samples.map((sample) => sample.readoutPhaseOffsetSeconds)
      ).toEqual([0, 0.02]);
    }
  });

  it("keeps native scan timing invariant while existing orientation transforms rotate its direction", () => {
    const timing = calculateSensorReadoutTiming({
      nativeRaster,
      shutterMechanism: "electronic",
      readout: rollingReadout()
    }).value;

    const orientations: readonly CaptureOrientation[] = [
      "landscape",
      "portrait-clockwise",
      "landscape-inverted",
      "portrait-counter-clockwise"
    ];

    const vectors = orientations.map((orientation) =>
      transformNativeRasterVectorToOriented({
        vector: timing.scan?.unitVectorNative ?? { x: 0, y: 0 },
        orientation
      })
    );

    const canonicalVectors = vectors.map((vector) => ({
      x: vector.x === 0 ? 0 : vector.x,
      y: vector.y === 0 ? 0 : vector.y
    }));

    expect(canonicalVectors).toEqual([
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
      { x: 1, y: 0 }
    ]);
  });

  it("keeps shutter mechanism independent from the sensor scan schedule", () => {
    const mechanisms = [
      "mechanical",
      "electronic-first-curtain",
      "electronic"
    ] as const;

    const values = mechanisms.map((shutterMechanism) =>
      calculateSensorReadoutTiming({
        nativeRaster,
        shutterMechanism,
        readout: rollingReadout(),
        samplePointsNative: [{ x: 3000, y: 2000 }]
      }).value
    );

    expect(values.map((value) => value.shutterMechanism)).toEqual(mechanisms);
    expect(values[0]?.scan).toEqual(values[1]?.scan);
    expect(values[1]?.scan).toEqual(values[2]?.scan);
    expect(values[0]?.samples).toEqual(values[2]?.samples);
  });

  it("does not let output resolution alter the native timing schedule", () => {
    const full = resolveCaptureGeometry({
      imagingArea: { widthMm: 36, heightMm: 24 },
      nativeRaster,
      orientation: "landscape",
      outputRaster: { pixelWidth: 3000, pixelHeight: 2000 }
    }).value;

    const smaller = resolveCaptureGeometry({
      imagingArea: { widthMm: 36, heightMm: 24 },
      nativeRaster,
      orientation: "landscape",
      outputRaster: { pixelWidth: 1500, pixelHeight: 1000 }
    }).value;

    const calculate = (
      activeCaptureRect: typeof full.activeCapture.nativeRect
    ): SensorReadoutTiming =>
      calculateSensorReadoutTiming({
        nativeRaster,
        activeCaptureRect,
        shutterMechanism: "electronic",
        readout: rollingReadout(),
        samplePointsNative: [{ x: 3000, y: 2000 }]
      }).value;

    expect(calculate(full.activeCapture.nativeRect)).toEqual(
      calculate(smaller.activeCapture.nativeRect)
    );
  });

  it("preserves independent evidence for readout duration, direction and spatial skew", () => {
    const value = calculateSensorReadoutTiming({
      nativeRaster,
      shutterMechanism: "electronic",
      readout: rollingReadout()
    }).value;

    expect(
      value.captureReadoutDurationSeconds.evidence[0]?.sourceReference
    ).toBe("test:capture-readout-duration");
    expect(value.scan?.directionNative.evidence[0]?.sourceReference).toBe(
      "test:scan-direction"
    );
    expect(
      value.scan?.spatialSamplingSkewSeconds.evidence[0]?.sourceReference
    ).toBe("test:spatial-sampling-skew");
  });

  it("labels the uniform raster timing map as an approximation without physical-line claims", () => {
    const result = calculateSensorReadoutTiming({
      nativeRaster,
      shutterMechanism: "electronic",
      readout: rollingReadout()
    });

    expect(result.provenance.kind).toBe("approximation");
    expect(result.provenance.assumptions).toEqual(
      expect.arrayContaining([
        expect.stringContaining("uniform-linear"),
        expect.stringContaining("does not assert one raster row or column"),
        expect.stringContaining("independently declared facts")
      ])
    );
  });

  it("fails closed on malformed runtime declarations and invalid points", () => {
    expect(() =>
      calculateSensorReadoutTiming({
        nativeRaster,
        shutterMechanism: "electronic",
        readout: {
          ...rollingReadout(),
          readoutMode: "diagonal"
        } as never
      })
    ).toThrow("readout.readoutMode");

    expect(() =>
      calculateSensorReadoutTiming({
        nativeRaster,
        shutterMechanism: "electronic",
        readout: {
          ...rollingReadout(),
          scanDirectionNative: undefined
        } as never
      })
    ).toThrow("readout.scanDirectionNative");

    expect(() =>
      calculateSensorReadoutTiming({
        nativeRaster,
        shutterMechanism: "electronic",
        readout: {
          readoutMode: "global",
          captureReadoutDurationSeconds: secondsFact(
            0.01,
            "test:global"
          ),
          spatialSamplingSkewSeconds: secondsFact(0.01, "test:invalid-global")
        } as never
      })
    ).toThrow("must be omitted for global readout");

    expect(() =>
      calculateSensorReadoutTiming({
        nativeRaster,
        shutterMechanism: "leaf" as never,
        readout: rollingReadout()
      })
    ).toThrow("shutterMechanism");

    expect(() =>
      calculateSensorReadoutTiming({
        nativeRaster,
        shutterMechanism: "electronic",
        readout: {
          ...rollingReadout(),
          captureReadoutDurationSeconds: {
            value: 0.024,
            unit: "ms",
            evidence: factEvidence("test:wrong-unit")
          }
        } as never
      })
    ).toThrow('.unit must be "s"');

    expect(() =>
      calculateSensorReadoutTiming({
        nativeRaster,
        activeCaptureRect: {
          x: 1000,
          y: 500,
          width: 3000,
          height: 2000
        },
        shutterMechanism: "electronic",
        readout: rollingReadout(),
        samplePointsNative: [{ x: 2500, y: 3000 }]
      })
    ).toThrow("activeCaptureRect edge-coordinate bounds");
  });

  it("requires evidence for every declared timing/direction fact", () => {
    expect(() =>
      calculateSensorReadoutTiming({
        nativeRaster,
        shutterMechanism: "electronic",
        readout: {
          ...rollingReadout(),
          spatialSamplingSkewSeconds: {
            value: 0.02,
            unit: "s" as const,
            evidence: []
          }
        } as never
      })
    ).toThrow("must be a non-empty array");
  });
});

describe("nested input errors (sensor-11, #701)", () => {
  it("rejects an undefined sample point with a domain error", () => {
    expect(() => calculateSensorReadoutTiming({ nativeRaster, activeCaptureRect: { x: 1000, y: 500, width: 3000, height: 2000 }, shutterMechanism: "electronic",
      readout: rollingReadout(), samplePointsNative: [undefined as never] })).toThrow(expect.objectContaining({ name: "InvalidScientificInputError" }));
  });
});
