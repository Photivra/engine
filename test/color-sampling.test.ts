// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  parseSensorColorSamplingProfile,
  resolveColorSamplingSite,
  type SensorColorSamplingProfile
} from "../src/index.js";

type OwnedEvidence = readonly [
  {
    sourceOrigin: "photivra";
    sourceReference: string;
    reuseStatus: "photivra-owned";
  }
];

const evidence = (
  sourceReference: string
): OwnedEvidence =>
  [
    {
      sourceOrigin: "photivra" as const,
      sourceReference,
      reuseStatus: "photivra-owned" as const
    }
  ] as const;

function periodicProfile(
  siteChannelIds: readonly string[] = [
    "red",
    "green",
    "green",
    "blue"
  ]
): SensorColorSamplingProfile {
  return {
    schemaVersion: "0.1.0",
    profileId: "test-periodic",
    evidence: evidence("test:periodic"),
    coordinateSystem:
      "native-sensor-color-sampling-site-index",
    layout: {
      kind: "periodic-mosaic",
      repeatWidthSites: 2,
      repeatHeightSites: 2,
      siteChannelIds,
      anchor: "native-sensor-top-left-site"
    }
  };
}

describe("sensor color sampling topology", () => {
  it("resolves a generic repeating 2x2 mosaic from absolute native site indices", () => {
    const profile = parseSensorColorSamplingProfile(
      periodicProfile()
    );

    const expected = [
      { x: 0, y: 0, channelId: "red" },
      { x: 1, y: 0, channelId: "green" },
      { x: 0, y: 1, channelId: "green" },
      { x: 1, y: 1, channelId: "blue" },
      { x: 2, y: 0, channelId: "red" },
      { x: 3, y: 1, channelId: "blue" }
    ];

    for (const item of expected) {
      const resolved = resolveColorSamplingSite({
        profile,
        site: {
          x: item.x,
          y: item.y
        }
      });

      expect(resolved.mapping.kind).toBe(
        "periodic-mosaic"
      );
      expect(resolved.mapping.channelId).toBe(
        item.channelId
      );
    }
  });

  it("preserves sensor-anchored phase instead of resetting at a crop-local origin", () => {
    const profile = periodicProfile();

    const absoluteSite = resolveColorSamplingSite({
      profile,
      site: { x: 3, y: 2 }
    });
    const wronglyResetCropLocalSite =
      resolveColorSamplingSite({
        profile,
        site: { x: 0, y: 0 }
      });

    expect(absoluteSite.mapping.kind).toBe(
      "periodic-mosaic"
    );
    expect(
      absoluteSite.mapping.kind === "periodic-mosaic"
        ? absoluteSite.mapping.repeatCoordinate
        : undefined
    ).toEqual({ x: 1, y: 0 });
    expect(absoluteSite.mapping.channelId).toBe(
      "green"
    );
    expect(
      wronglyResetCropLocalSite.mapping.channelId
    ).toBe("red");
  });

  it("supports larger generic periodic mosaics without a manufacturer-specific enum", () => {
    const channels = [
      "r", "r", "g1", "g1",
      "r", "r", "g1", "g1",
      "g2", "g2", "b", "b",
      "g2", "g2", "b", "b"
    ];

    const profile = parseSensorColorSamplingProfile({
      schemaVersion: "0.1.0",
      profileId: "generic-4x4",
      evidence: evidence("test:generic-4x4"),
      coordinateSystem:
        "native-sensor-color-sampling-site-index",
      layout: {
        kind: "periodic-mosaic",
        repeatWidthSites: 4,
        repeatHeightSites: 4,
        siteChannelIds: channels,
        anchor: "native-sensor-top-left-site"
      }
    });

    expect(
      resolveColorSamplingSite({
        profile,
        site: { x: 6, y: 5 }
      }).mapping.channelId
    ).toBe("g1");
    expect(
      resolveColorSamplingSite({
        profile,
        site: { x: 7, y: 7 }
      }).mapping.channelId
    ).toBe("b");
  });

  it("supports arbitrary semantic channel ids without claiming spectral response", () => {
    const profile = periodicProfile([
      "clear",
      "green-a",
      "green-b",
      "blue-like"
    ]);

    const resolved = resolveColorSamplingSite({
      profile,
      site: { x: 0, y: 0 }
    });

    expect(resolved.mapping.channelId).toBe("clear");
    expect(resolved.spectralResponseEstablished).toBe(
      false
    );
    expect(
      resolved.nativeImageRasterBindingEstablished
    ).toBe(false);
    expect(
      resolved.physicalPhotodiodeBindingEstablished
    ).toBe(false);
  });

  it("resolves monochrome structurally without inventing a wavelength response", () => {
    const profile = parseSensorColorSamplingProfile({
      schemaVersion: "0.1.0",
      profileId: "mono",
      evidence: evidence("test:mono"),
      coordinateSystem:
        "native-sensor-color-sampling-site-index",
      layout: {
        kind: "monochrome",
        channelId: "mono-signal"
      }
    });

    const resolved = resolveColorSamplingSite({
      profile,
      site: { x: 123, y: 456 }
    });

    expect(resolved.mapping).toEqual({
      kind: "monochrome",
      channelId: "mono-signal"
    });
    expect(resolved.spectralResponseEstablished).toBe(
      false
    );
  });

  it("represents layered color structurally without pretending equal per-layer site mapping", () => {
    const profile = parseSensorColorSamplingProfile({
      schemaVersion: "0.1.0",
      profileId: "layered",
      evidence: evidence("test:layered"),
      coordinateSystem:
        "native-sensor-layered-spatial-relationship-not-resolved",
      layout: {
        kind: "layered",
        layerChannelIds: [
          "layer-a",
          "layer-b",
          "layer-c"
        ],
        spatialSamplingRelationship: "not-resolved"
      }
    });

    expect(profile.layout).toEqual({
      kind: "layered",
      layerChannelIds: [
        "layer-a",
        "layer-b",
        "layer-c"
      ],
      spatialSamplingRelationship: "not-resolved"
    });

    expect(() =>
      resolveColorSamplingSite({
        profile,
        site: { x: 0, y: 0 }
      })
    ).toThrow("structural-only");
  });

  it("keeps the topology coordinate system native and orientation-free", () => {
    const resolved = resolveColorSamplingSite({
      profile: periodicProfile(),
      site: { x: 5, y: 8 }
    });

    expect(resolved.coordinateSystem).toBe(
      "native-sensor-color-sampling-site-index"
    );
    expect(resolved.site).toEqual({ x: 5, y: 8 });
    expect(
      "orientation" in
        (resolved as unknown as Record<string, unknown>)
    ).toBe(false);
  });

  it("fails closed when a repeating tile does not match its declared dimensions", () => {
    expect(() =>
      parseSensorColorSamplingProfile({
        schemaVersion: "0.1.0",
        profileId: "bad-tile",
        evidence: evidence("test:bad-tile"),
        coordinateSystem:
          "native-sensor-color-sampling-site-index",
        layout: {
          kind: "periodic-mosaic",
          repeatWidthSites: 2,
          repeatHeightSites: 2,
          siteChannelIds: [
            "red",
            "green",
            "blue"
          ],
          anchor: "native-sensor-top-left-site"
        }
      })
    ).toThrow("length must equal");
  });

  it("fails closed on invalid mosaic anchor and invalid site indices", () => {
    expect(() =>
      parseSensorColorSamplingProfile({
        schemaVersion: "0.1.0",
        profileId: "bad-anchor",
        evidence: evidence("test:bad-anchor"),
        coordinateSystem:
          "native-sensor-color-sampling-site-index",
        layout: {
          kind: "periodic-mosaic",
          repeatWidthSites: 1,
          repeatHeightSites: 1,
          siteChannelIds: ["c0"],
          anchor: "crop-top-left"
        }
      })
    ).toThrow("native-sensor-top-left-site");

    for (const site of [
      { x: -1, y: 0 },
      { x: 0.5, y: 0 },
      { x: 0, y: Number.NaN }
    ]) {
      expect(() =>
        resolveColorSamplingSite({
          profile: periodicProfile(),
          site
        })
      ).toThrow("native color-sampling-site index");
    }
  });

  it("fails closed on invalid schema, missing evidence, and duplicate layered ids", () => {
    expect(() =>
      parseSensorColorSamplingProfile({
        schemaVersion: "9.9.9",
        profileId: "bad-version",
        evidence: evidence("test:version"),
        coordinateSystem:
          "native-sensor-color-sampling-site-index",
        layout: {
          kind: "monochrome",
          channelId: "mono"
        }
      })
    ).toThrow("schemaVersion");

    expect(() =>
      parseSensorColorSamplingProfile({
        schemaVersion: "0.1.0",
        profileId: "no-evidence",
        evidence: [],
        coordinateSystem:
          "native-sensor-color-sampling-site-index",
        layout: {
          kind: "monochrome",
          channelId: "mono"
        }
      })
    ).toThrow("non-empty array");

    expect(() =>
      parseSensorColorSamplingProfile({
        schemaVersion: "0.1.0",
        profileId: "duplicate-layers",
        evidence: evidence("test:layers"),
        coordinateSystem:
          "native-sensor-layered-spatial-relationship-not-resolved",
        layout: {
          kind: "layered",
          layerChannelIds: [
            "same",
            "same"
          ],
          spatialSamplingRelationship:
            "not-resolved"
        }
      })
    ).toThrow("duplicate channel IDs");
  });

  it("does not accept layered per-site semantics before per-layer spatial sampling exists", () => {
    expect(() =>
      parseSensorColorSamplingProfile({
        schemaVersion: "0.1.0",
        profileId: "premature-layer-grid",
        evidence: evidence("test:layer-grid"),
        coordinateSystem:
          "native-sensor-layered-spatial-relationship-not-resolved",
        layout: {
          kind: "layered",
          layerChannelIds: ["a", "b", "c"],
          spatialSamplingRelationship:
            "shared-equal-grid"
        }
      })
    ).toThrow("not-resolved");
  });
});

describe("sparse arrays (sensor-12, #701)", () => {
  it("refuses site channel IDs with holes", () => {
    expect(() => parseSensorColorSamplingProfile(periodicProfile(new Array(4)))).toThrow(expect.objectContaining({ name: "InvalidConfigurationError" }));
  });
});
