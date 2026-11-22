// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  calculateCaptureExposureWindows,
  transformNativeRasterVectorToOriented,
  type CaptureOrientation,
  type ExposureBoundarySchedule,
  type SourcedCaptureTimingSeconds
} from "../src/index.js";

type PhotivraOwnedEvidence = readonly [
  {
    sourceOrigin: "photivra";
    sourceReference: string;
    reuseStatus: "photivra-owned";
  }
];

const nativeRaster = { pixelWidth: 6000, pixelHeight: 4000 };

const evidence = (
  sourceReference: string
): PhotivraOwnedEvidence =>
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
): SourcedCaptureTimingSeconds => ({
  value,
  unit: "s",
  evidence: evidence(sourceReference)
});

const simultaneous = (): ExposureBoundarySchedule => ({
  kind: "simultaneous"
});

const scanned = (
  direction:
    | "top-to-bottom"
    | "bottom-to-top"
    | "left-to-right"
    | "right-to-left",
  traversalSeconds: number,
  sourceReference: string
): ExposureBoundarySchedule => ({
  kind: "uniform-linear-native-scan",
  directionNative: {
    value: direction,
    evidence: evidence(sourceReference + ":direction")
  },
  traversalDurationSeconds: secondsFact(
    traversalSeconds,
    sourceReference + ":duration"
  )
});

describe("capture exposure-window timing", () => {
  it("produces one simultaneous local exposure window everywhere", () => {
    const result = calculateCaptureExposureWindows({
      nativeRaster,
      shutterMechanism: "electronic",
      nominalExposureDurationSeconds: secondsFact(
        0.01,
        "test:nominal"
      ),
      opening: simultaneous(),
      closing: simultaneous(),
      samplePointsNative: [
        { x: 0, y: 0 },
        { x: 3000, y: 2000 },
        { x: 6000, y: 4000 }
      ]
    });

    expect(result.value.timeReference).toBe(
      "first-opening-boundary-phase"
    );
    expect(result.value.localExposureDurationRangeSeconds).toEqual({
      minimum: 0.01,
      maximum: 0.01
    });
    expect(
      result.value.samples.map(
        (sample) => sample.startOffsetSecondsFromOpeningReference
      )
    ).toEqual([0, 0, 0]);
    expect(
      result.value.samples.map(
        (sample) => sample.endOffsetSecondsFromOpeningReference
      )
    ).toEqual([0.01, 0.01, 0.01]);
  });

  it("keeps local exposure duration constant for matched moving boundaries", () => {
    const result = calculateCaptureExposureWindows({
      nativeRaster,
      shutterMechanism: "mechanical",
      nominalExposureDurationSeconds: secondsFact(
        0.005,
        "test:nominal"
      ),
      opening: scanned(
        "top-to-bottom",
        0.02,
        "test:opening"
      ),
      closing: scanned(
        "top-to-bottom",
        0.02,
        "test:closing"
      ),
      samplePointsNative: [
        { x: 3000, y: 0 },
        { x: 3000, y: 2000 },
        { x: 3000, y: 4000 }
      ]
    });

    expect(
      result.value.samples.map(
        (sample) => sample.startOffsetSecondsFromOpeningReference
      )
    ).toEqual([0, 0.01, 0.02]);
    expect(
      result.value.samples.map(
        (sample) => sample.endOffsetSecondsFromOpeningReference
      )
    ).toEqual([0.005, 0.015, 0.025]);
    for (const sample of result.value.samples) {
      expect(sample.localExposureDurationSeconds).toBeCloseTo(
        0.005,
        12
      );
    }
  });

  it("allows independent opening and closing schedules to vary local duration", () => {
    const result = calculateCaptureExposureWindows({
      nativeRaster,
      shutterMechanism: "electronic-first-curtain",
      nominalExposureDurationSeconds: secondsFact(
        0.02,
        "test:nominal"
      ),
      opening: scanned(
        "top-to-bottom",
        0.01,
        "test:opening"
      ),
      closing: scanned(
        "top-to-bottom",
        0.015,
        "test:closing"
      ),
      samplePointsNative: [
        { x: 3000, y: 0 },
        { x: 3000, y: 2000 },
        { x: 3000, y: 4000 }
      ]
    });

    expect(result.value.opening.actuator).toBe("electronic");
    expect(result.value.closing.actuator).toBe("mechanical");
    const expectedDurations = [0.02, 0.0225, 0.025];
    result.value.samples.forEach((sample, index) => {
      expect(sample.localExposureDurationSeconds).toBeCloseTo(
        expectedDurations[index] ?? 0,
        12
      );
    });
    expect(
      result.value.localExposureDurationRangeSeconds.minimum
    ).toBeCloseTo(0.02, 12);
    expect(
      result.value.localExposureDurationRangeSeconds.maximum
    ).toBeCloseTo(0.025, 12);
  });

  it("keeps shutter mechanism independent from declared boundary timing", () => {
    const common = {
      nativeRaster,
      nominalExposureDurationSeconds: secondsFact(
        0.02,
        "test:nominal"
      ),
      opening: scanned(
        "left-to-right",
        0.004,
        "test:opening"
      ),
      closing: scanned(
        "right-to-left",
        0.004,
        "test:closing"
      ),
      samplePointsNative: [{ x: 3000, y: 2000 }]
    } as const;

    const mechanical = calculateCaptureExposureWindows({
      ...common,
      shutterMechanism: "mechanical"
    }).value;
    const efcs = calculateCaptureExposureWindows({
      ...common,
      shutterMechanism: "electronic-first-curtain"
    }).value;
    const electronic = calculateCaptureExposureWindows({
      ...common,
      shutterMechanism: "electronic"
    }).value;

    expect(mechanical.samples).toEqual(efcs.samples);
    expect(efcs.samples).toEqual(electronic.samples);
    expect(mechanical.opening.actuator).toBe("mechanical");
    expect(mechanical.closing.actuator).toBe("mechanical");
    expect(efcs.opening.actuator).toBe("electronic");
    expect(efcs.closing.actuator).toBe("mechanical");
    expect(electronic.opening.actuator).toBe("electronic");
    expect(electronic.closing.actuator).toBe("electronic");
  });

  it("validates the full active rectangle even when invalid corners are unsampled", () => {
    expect(() =>
      calculateCaptureExposureWindows({
        nativeRaster,
        shutterMechanism: "electronic",
        nominalExposureDurationSeconds: secondsFact(
          0.005,
          "test:nominal"
        ),
        opening: scanned(
          "top-to-bottom",
          0.01,
          "test:opening"
        ),
        closing: simultaneous(),
        samplePointsNative: [{ x: 3000, y: 0 }]
      })
    ).toThrow("zero or negative local exposure duration");
  });

  it("uses the active rectangle as the scan envelope without inventing new timing", () => {
    const result = calculateCaptureExposureWindows({
      nativeRaster,
      activeCaptureRect: {
        x: 1000,
        y: 500,
        width: 3000,
        height: 2000
      },
      shutterMechanism: "electronic",
      nominalExposureDurationSeconds: secondsFact(
        0.01,
        "test:nominal"
      ),
      opening: scanned(
        "top-to-bottom",
        0.008,
        "test:opening"
      ),
      closing: scanned(
        "top-to-bottom",
        0.008,
        "test:closing"
      ),
      samplePointsNative: [
        { x: 2500, y: 500 },
        { x: 2500, y: 1500 },
        { x: 2500, y: 2500 }
      ]
    });

    expect(
      result.value.samples.map(
        (sample) => sample.openingNormalizedScanPosition
      )
    ).toEqual([0, 0.5, 1]);
    expect(
      result.value.opening.schedule.kind ===
        "uniform-linear-native-scan"
        ? result.value.opening.schedule.traversalDurationSeconds.value
        : null
    ).toBe(0.008);
  });

  it("keeps native boundary direction orientation-invariant", () => {
    const result = calculateCaptureExposureWindows({
      nativeRaster,
      shutterMechanism: "electronic",
      nominalExposureDurationSeconds: secondsFact(
        0.01,
        "test:nominal"
      ),
      opening: scanned(
        "top-to-bottom",
        0.008,
        "test:opening"
      ),
      closing: scanned(
        "top-to-bottom",
        0.008,
        "test:closing"
      )
    }).value;

    const openingSchedule = result.opening.schedule;
    if (
      openingSchedule.kind !==
      "uniform-linear-native-scan"
    ) {
      throw new Error("Expected scanned opening schedule.");
    }

    const orientations: readonly CaptureOrientation[] = [
      "landscape",
      "portrait-clockwise",
      "landscape-inverted",
      "portrait-counter-clockwise"
    ];

    const vectors = orientations.map((orientation) =>
      transformNativeRasterVectorToOriented({
        vector: openingSchedule.unitVectorNative,
        orientation
      })
    );

    const canonical = vectors.map((vector) => ({
      x: vector.x === 0 ? 0 : vector.x,
      y: vector.y === 0 ? 0 : vector.y
    }));

    expect(canonical).toEqual([
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
      { x: 1, y: 0 }
    ]);
  });

  it("preserves independent evidence for nominal, opening and closing timing", () => {
    const result = calculateCaptureExposureWindows({
      nativeRaster,
      shutterMechanism: "mechanical",
      nominalExposureDurationSeconds: secondsFact(
        0.01,
        "test:nominal"
      ),
      opening: scanned(
        "left-to-right",
        0.003,
        "test:opening"
      ),
      closing: scanned(
        "left-to-right",
        0.004,
        "test:closing"
      )
    }).value;

    expect(
      result.nominalExposureDurationSeconds.evidence[0]
        ?.sourceReference
    ).toBe("test:nominal");

    if (
      result.opening.schedule.kind !==
        "uniform-linear-native-scan" ||
      result.closing.schedule.kind !==
        "uniform-linear-native-scan"
    ) {
      throw new Error("Expected scanned schedules.");
    }

    expect(
      result.opening.schedule.directionNative.evidence[0]
        ?.sourceReference
    ).toBe("test:opening:direction");
    expect(
      result.closing.schedule.traversalDurationSeconds.evidence[0]
        ?.sourceReference
    ).toBe("test:closing:duration");
  });

  it("fails closed on malformed schedules, units, mechanisms and points", () => {
    expect(() =>
      calculateCaptureExposureWindows({
        nativeRaster,
        shutterMechanism: "leaf" as never,
        nominalExposureDurationSeconds: secondsFact(
          0.01,
          "test:nominal"
        ),
        opening: simultaneous(),
        closing: simultaneous()
      })
    ).toThrow("shutterMechanism");

    expect(() =>
      calculateCaptureExposureWindows({
        nativeRaster,
        shutterMechanism: "electronic",
        nominalExposureDurationSeconds: {
          value: 0.01,
          unit: "ms",
          evidence: evidence("test:wrong-unit")
        } as never,
        opening: simultaneous(),
        closing: simultaneous()
      })
    ).toThrow('.unit must be "s"');

    expect(() =>
      calculateCaptureExposureWindows({
        nativeRaster,
        shutterMechanism: "electronic",
        nominalExposureDurationSeconds: secondsFact(
          0.01,
          "test:nominal"
        ),
        opening: {
          kind: "simultaneous",
          traversalDurationSeconds: secondsFact(
            0.002,
            "test:invalid"
          )
        } as never,
        closing: simultaneous()
      })
    ).toThrow("must be omitted");

    expect(() =>
      calculateCaptureExposureWindows({
        nativeRaster,
        shutterMechanism: "electronic",
        nominalExposureDurationSeconds: secondsFact(
          0.01,
          "test:nominal"
        ),
        opening: {
          kind: "diagonal"
        } as never,
        closing: simultaneous()
      })
    ).toThrow("opening.kind");

    expect(() =>
      calculateCaptureExposureWindows({
        nativeRaster,
        activeCaptureRect: {
          x: 1000,
          y: 500,
          width: 3000,
          height: 2000
        },
        shutterMechanism: "electronic",
        nominalExposureDurationSeconds: secondsFact(
          0.01,
          "test:nominal"
        ),
        opening: simultaneous(),
        closing: simultaneous(),
        samplePointsNative: [{ x: 2500, y: 3000 }]
      })
    ).toThrow("activeCaptureRect edge-coordinate bounds");
  });

  it("requires evidence for every declared duration and scan direction", () => {
    expect(() =>
      calculateCaptureExposureWindows({
        nativeRaster,
        shutterMechanism: "electronic",
        nominalExposureDurationSeconds: {
          value: 0.01,
          unit: "s",
          evidence: []
        } as never,
        opening: simultaneous(),
        closing: simultaneous()
      })
    ).toThrow("must be a non-empty array");

    expect(() =>
      calculateCaptureExposureWindows({
        nativeRaster,
        shutterMechanism: "electronic",
        nominalExposureDurationSeconds: secondsFact(
          0.01,
          "test:nominal"
        ),
        opening: {
          kind: "uniform-linear-native-scan",
          directionNative: {
            value: "top-to-bottom",
            evidence: []
          },
          traversalDurationSeconds: secondsFact(
            0.005,
            "test:opening"
          )
        } as never,
        closing: simultaneous()
      })
    ).toThrow("must be a non-empty array");
  });

  it("labels the timing schedule as an approximation with separation assumptions", () => {
    const result = calculateCaptureExposureWindows({
      nativeRaster,
      shutterMechanism: "electronic-first-curtain",
      nominalExposureDurationSeconds: secondsFact(
        0.01,
        "test:nominal"
      ),
      opening: scanned(
        "top-to-bottom",
        0.004,
        "test:opening"
      ),
      closing: scanned(
        "top-to-bottom",
        0.004,
        "test:closing"
      )
    });

    expect(result.provenance.kind).toBe("approximation");
    expect(result.provenance.assumptions).toEqual(
      expect.arrayContaining([
        expect.stringContaining("first opening-boundary phase"),
        expect.stringContaining("independent declared quantities"),
        expect.stringContaining("Sensor readout timing remains a separate")
      ])
    );
  });
});

describe("nested input errors (sensor-11, #701)", () => {
  it("rejects a null sample point with a domain error", () => {
    expect(() => calculateCaptureExposureWindows({ nativeRaster, shutterMechanism: "electronic", nominalExposureDurationSeconds: secondsFact(0.01, "test:nominal"),
      opening: simultaneous(), closing: simultaneous(), samplePointsNative: [null as never] })).toThrow(expect.objectContaining({ name: "InvalidScientificInputError" }));
  });
});
