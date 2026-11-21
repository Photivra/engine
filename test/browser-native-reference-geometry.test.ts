// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  BROWSER_NATIVE_REFERENCE_GEOMETRY_VERSION,
  intersectBrowserNativeReferenceGeometry,
  prepareBrowserNativeReferenceGeometry,
  type BrowserNativeReferencePrimitive
} from "../src/capture/browser-native-reference-geometry.js";

const rectangle = (
  primitiveId = "rect",
  z = 5
): BrowserNativeReferencePrimitive => ({
  kind: "axis-aligned-rectangle",
  primitiveId,
  minimumM: { x: -1, y: -1, z },
  maximumM: { x: 1, y: 1, z }
});

const box = (
  primitiveId = "box",
  minimumZ = 4,
  maximumZ = 6
): BrowserNativeReferencePrimitive => ({
  kind: "axis-aligned-box",
  primitiveId,
  minimumM: { x: -1, y: -1, z: minimumZ },
  maximumM: { x: 1, y: 1, z: maximumZ }
});

const prepare = (
  primitives: readonly BrowserNativeReferencePrimitive[]
): ReturnType<typeof prepareBrowserNativeReferenceGeometry> =>
  prepareBrowserNativeReferenceGeometry({
    schemaVersion: BROWSER_NATIVE_REFERENCE_GEOMETRY_VERSION,
    sourceStateId: "owned-reference-scene",
    providerSceneId: "room",
    sourceRevision: "fixture-v1",
    primitives
  });

describe("repository-internal browser native reference geometry", () => {
  it("hits and misses a bounded rectangle with closed edge semantics", () => {
    const prepared = prepare([rectangle()]);

    expect(
      intersectBrowserNativeReferenceGeometry(prepared, {
        originM: { x: 0, y: 0, z: 0 },
        directionUnitVector: { x: 0, y: 0, z: 1 }
      })
    ).toEqual({
      kind: "hit",
      primitiveId: "rect",
      rayParameter: 5,
      distanceM: 5,
      pointM: { x: 0, y: 0, z: 5 }
    });

    expect(
      intersectBrowserNativeReferenceGeometry(prepared, {
        originM: { x: 2, y: 0, z: 0 },
        directionUnitVector: { x: 0, y: 0, z: 1 }
      })
    ).toEqual({ kind: "miss" });

    expect(
      intersectBrowserNativeReferenceGeometry(prepared, {
        originM: { x: 1, y: 1, z: 0 },
        directionUnitVector: { x: 0, y: 0, z: 1 }
      })
    ).toEqual({
      kind: "hit",
      primitiveId: "rect",
      rayParameter: 5,
      distanceM: 5,
      pointM: { x: 1, y: 1, z: 5 }
    });
  });

  it("reports physical distance without renormalizing the supplied direction", () => {
    expect(
      intersectBrowserNativeReferenceGeometry(prepare([rectangle()]), {
        originM: { x: 0, y: 0, z: 0 },
        directionUnitVector: { x: 0, y: 0, z: 2 }
      })
    ).toEqual({
      kind: "hit",
      primitiveId: "rect",
      rayParameter: 2.5,
      distanceM: 5,
      pointM: { x: 0, y: 0, z: 5 }
    });
  });

  it("hits box faces and preserves same-primitive edge/corner crossings", () => {
    const prepared = prepare([box()]);

    expect(
      intersectBrowserNativeReferenceGeometry(prepared, {
        originM: { x: 0, y: 0, z: 0 },
        directionUnitVector: { x: 0, y: 0, z: 1 }
      })
    ).toEqual({
      kind: "hit",
      primitiveId: "box",
      rayParameter: 4,
      distanceM: 4,
      pointM: { x: 0, y: 0, z: 4 }
    });

    const corner = intersectBrowserNativeReferenceGeometry(prepared, {
      originM: { x: -2, y: -2, z: 3 },
      directionUnitVector: { x: 1, y: 1, z: 1 }
    });
    expect(corner.kind).toBe("hit");
    if (corner.kind === "hit") {
      expect(corner.primitiveId).toBe("box");
      expect(corner.rayParameter).toBe(1);
      expect(corner.distanceM).toBe(Math.sqrt(3));
      expect(corner.pointM).toEqual({ x: -1, y: -1, z: 4 });
    }
  });

  it("uses the declared forward exit when the ray origin is strictly inside a box", () => {
    expect(
      intersectBrowserNativeReferenceGeometry(prepare([box()]), {
        originM: { x: 0, y: 0, z: 5 },
        directionUnitVector: { x: 0, y: 0, z: 1 }
      })
    ).toEqual({
      kind: "hit",
      primitiveId: "box",
      rayParameter: 1,
      distanceM: 1,
      pointM: { x: 0, y: 0, z: 6 }
    });
  });

  it("selects the first primitive independently of caller array order", () => {
    const near = rectangle("near", 3);
    const far = rectangle("far", 5);
    const ray = {
      originM: { x: 0, y: 0, z: 0 },
      directionUnitVector: { x: 0, y: 0, z: 1 }
    };

    for (const primitives of [
      [far, near],
      [near, far]
    ] as const) {
      expect(
        intersectBrowserNativeReferenceGeometry(prepare(primitives), ray)
      ).toEqual({
        kind: "hit",
        primitiveId: "near",
        rayParameter: 3,
        distanceM: 3,
        pointM: { x: 0, y: 0, z: 3 }
      });
    }
  });

  it("applies rigid translation while preserving physical distance", () => {
    const translated = {
      ...rectangle("translated", 0),
      worldFromLocal: {
        translationM: { x: 0, y: 0, z: 5 },
        rotationQuaternion: { x: 0, y: 0, z: 0, w: 1 }
      }
    };
    expect(
      intersectBrowserNativeReferenceGeometry(prepare([translated]), {
        originM: { x: 0, y: 0, z: 0 },
        directionUnitVector: { x: 0, y: 0, z: 2 }
      })
    ).toEqual({
      kind: "hit",
      primitiveId: "translated",
      rayParameter: 2.5,
      distanceM: 5,
      pointM: { x: 0, y: 0, z: 5 }
    });
  });

  it("intersects a rectangle after a rigid 90-degree rotation", () => {
    const rotated = {
      ...rectangle("rotated", 0),
      worldFromLocal: {
        translationM: { x: 5, y: 0, z: 0 },
        rotationQuaternion: {
          x: 0,
          y: Math.SQRT1_2,
          z: 0,
          w: Math.SQRT1_2
        }
      }
    };
    const result = intersectBrowserNativeReferenceGeometry(prepare([rotated]), {
      originM: { x: 0, y: 0, z: 0 },
      directionUnitVector: { x: 1, y: 0, z: 0 }
    });
    expect(result.kind).toBe("hit");
    if (result.kind === "hit") {
      expect(result.primitiveId).toBe("rotated");
      expect(result.rayParameter).toBeCloseTo(5, 14);
      expect(result.distanceM).toBeCloseTo(5, 14);
      expect(result.pointM.x).toBeCloseTo(5, 14);
      expect(result.pointM.y).toBeCloseTo(0, 14);
      expect(result.pointM.z).toBeCloseTo(0, 14);
    }
  });

  it("normalizes and sign-canonicalizes equivalent rigid quaternions", () => {
    const positive = prepare([
      {
        ...rectangle("same", 0),
        worldFromLocal: {
          translationM: { x: 1, y: 2, z: 3 },
          rotationQuaternion: {
            x: 0,
            y: 2 * Math.SQRT1_2,
            z: 0,
            w: 2 * Math.SQRT1_2
          }
        }
      }
    ]);
    const negative = prepare([
      {
        ...rectangle("same", 0),
        worldFromLocal: {
          translationM: { x: 1, y: 2, z: 3 },
          rotationQuaternion: {
            x: -0,
            y: -4 * Math.SQRT1_2,
            z: -0,
            w: -4 * Math.SQRT1_2
          }
        }
      }
    ]);

    expect(positive.primitives[0]!.worldFromLocal).toEqual(
      negative.primitives[0]!.worldFromLocal
    );
    expect(
      Object.is(
        negative.primitives[0]!.worldFromLocal!.rotationQuaternion.x,
        -0
      )
    ).toBe(false);
  });

  it("fails closed for exact distinct first-hit ties", () => {
    const prepared = prepare([
      rectangle("a", 5),
      {
        ...rectangle("b", 5),
        minimumM: { x: -2, y: -2, z: 5 },
        maximumM: { x: 2, y: 2, z: 5 }
      }
    ]);

    expect(
      intersectBrowserNativeReferenceGeometry(prepared, {
        originM: { x: 0, y: 0, z: 0 },
        directionUnitVector: { x: 0, y: 0, z: 1 }
      })
    ).toEqual({
      kind: "unsupported",
      reason: "coincident-distinct-first-hit"
    });
  });

  it("fails closed for coplanar rays and origins on primitive boundaries", () => {
    expect(
      intersectBrowserNativeReferenceGeometry(prepare([rectangle()]), {
        originM: { x: 0, y: 0, z: 5 },
        directionUnitVector: { x: 1, y: 0, z: 0 }
      })
    ).toEqual({
      kind: "unsupported",
      reason: "coplanar-rectangle-ray"
    });

    expect(
      intersectBrowserNativeReferenceGeometry(prepare([box()]), {
        originM: { x: 0, y: 0, z: 4 },
        directionUnitVector: { x: 0, y: 0, z: 1 }
      })
    ).toEqual({
      kind: "unsupported",
      reason: "ray-origin-on-primitive-boundary"
    });
  });

  it.each([
    {
      label: "micrometre-scale plane distance",
      primitive: rectangle("small", 1e-6),
      expected: 1e-6
    },
    {
      label: "large metric plane distance",
      primitive: rectangle("large", 1e6),
      expected: 1e6
    }
  ])("keeps simple analytical results across $label", ({ primitive, expected }) => {
    const result = intersectBrowserNativeReferenceGeometry(prepare([primitive]), {
      originM: { x: 0, y: 0, z: 0 },
      directionUnitVector: { x: 0, y: 0, z: 1 }
    });
    expect(result.kind).toBe("hit");
    if (result.kind === "hit") {
      expect(result.rayParameter).toBe(expected);
      expect(result.distanceM).toBe(expected);
    }
  });

  it("owns, sorts, and freezes geometry independently of caller mutation", () => {
    const owned = {
      ...rectangle("z", 5),
      worldFromLocal: {
        translationM: { x: 1, y: 2, z: 3 },
        rotationQuaternion: { x: 0, y: 0, z: 0, w: 2 }
      }
    };
    const input = {
      schemaVersion: BROWSER_NATIVE_REFERENCE_GEOMETRY_VERSION,
      sourceStateId: "owned-source",
      providerSceneId: "room",
      sourceRevision: "fixture-v1",
      primitives: [owned, rectangle("a", 6)]
    };
    const prepared = prepareBrowserNativeReferenceGeometry(input);
    input.primitives[0]!.minimumM.x = -99;
    input.primitives[0]!.worldFromLocal!.translationM.x = 99;
    input.primitives[0]!.worldFromLocal!.rotationQuaternion.w = -7;

    expect(prepared.primitives.map((primitive) => primitive.primitiveId)).toEqual([
      "a",
      "z"
    ]);
    const preparedOwned = prepared.primitives.find(
      (primitive) => primitive.primitiveId === "z"
    )!;
    expect(preparedOwned.minimumM.x).toBe(-1);
    expect(preparedOwned.worldFromLocal!.translationM.x).toBe(1);
    expect(preparedOwned.worldFromLocal!.rotationQuaternion.w).toBe(1);
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.primitives)).toBe(true);
    expect(Object.isFrozen(preparedOwned.minimumM)).toBe(true);
    expect(Object.isFrozen(preparedOwned.worldFromLocal)).toBe(true);
  });

  it("canonicalizes signed zero in prepared metric and quaternion state", () => {
    const prepared = prepareBrowserNativeReferenceGeometry({
      schemaVersion: BROWSER_NATIVE_REFERENCE_GEOMETRY_VERSION,
      sourceStateId: "signed-zero-scene",
      providerSceneId: "room",
      sourceRevision: "fixture-v1",
      primitives: [
        {
          kind: "axis-aligned-rectangle",
          primitiveId: "zero",
          minimumM: { x: -0, y: -1, z: 5 },
          maximumM: { x: -0, y: 1, z: 6 },
          worldFromLocal: {
            translationM: { x: -0, y: 0, z: 0 },
            rotationQuaternion: { x: -0, y: 0, z: 0, w: 1 }
          }
        }
      ]
    });
    const primitive = prepared.primitives[0]!;
    expect(Object.is(primitive.minimumM.x, -0)).toBe(false);
    expect(Object.is(primitive.worldFromLocal!.translationM.x, -0)).toBe(false);
    expect(
      Object.is(primitive.worldFromLocal!.rotationQuaternion.x, -0)
    ).toBe(false);
  });

  it("rejects malformed geometry and invalid rays without inventing an epsilon", () => {
    expect(() => prepare([rectangle("same"), rectangle("same", 6)])).toThrow(
      "unique"
    );
    expect(() =>
      prepare([
        {
          kind: "axis-aligned-box",
          primitiveId: "flat-box",
          minimumM: { x: 0, y: 0, z: 0 },
          maximumM: { x: 1, y: 1, z: 0 }
        }
      ])
    ).toThrow("positive extents");
    expect(() =>
      prepare([
        {
          kind: "axis-aligned-rectangle",
          primitiveId: "line-not-rectangle",
          minimumM: { x: 0, y: 0, z: 0 },
          maximumM: { x: 0, y: 1, z: 0 }
        }
      ])
    ).toThrow("one zero-thickness axis");
    expect(() =>
      prepare([
        {
          ...rectangle("nan"),
          maximumM: { x: Number.NaN, y: 1, z: 5 }
        }
      ])
    ).toThrow("finite");
    expect(() =>
      prepareBrowserNativeReferenceGeometry({
        schemaVersion: BROWSER_NATIVE_REFERENCE_GEOMETRY_VERSION,
        sourceStateId: "scene",
        providerSceneId: "room",
        sourceRevision: " ",
        primitives: [rectangle()]
      })
    ).toThrow("revision");

    expect(() =>
      prepare([
        {
          ...rectangle("zero-quaternion"),
          worldFromLocal: {
            translationM: { x: 0, y: 0, z: 0 },
            rotationQuaternion: { x: 0, y: 0, z: 0, w: 0 }
          }
        }
      ])
    ).toThrow("nonzero");
    expect(() =>
      prepare([
        {
          ...rectangle("bad-translation"),
          worldFromLocal: {
            translationM: { x: Number.POSITIVE_INFINITY, y: 0, z: 0 },
            rotationQuaternion: { x: 0, y: 0, z: 0, w: 1 }
          }
        }
      ])
    ).toThrow("finite");

    const prepared = prepare([rectangle()]);
    expect(() =>
      intersectBrowserNativeReferenceGeometry(prepared, {
        originM: { x: 0, y: 0, z: 0 },
        directionUnitVector: { x: 0, y: 0, z: 0 }
      })
    ).toThrow("nonzero");
  });

  it("returns miss for parallel/off-plane and behind-ray cases", () => {
    const prepared = prepare([rectangle()]);
    expect(
      intersectBrowserNativeReferenceGeometry(prepared, {
        originM: { x: 0, y: 0, z: 0 },
        directionUnitVector: { x: 1, y: 0, z: 0 }
      })
    ).toEqual({ kind: "miss" });
    expect(
      intersectBrowserNativeReferenceGeometry(prepared, {
        originM: { x: 0, y: 0, z: 10 },
        directionUnitVector: { x: 0, y: 0, z: 1 }
      })
    ).toEqual({ kind: "miss" });
  });
});

describe("first hit independent of primitive ID order (capture-33, #698)", () => {
  it("a nearer primitive supersedes a tie between two farther ones, whatever the IDs", () => {
    const ray = { originM: { x: 0, y: 0, z: 0 }, directionUnitVector: { x: 0, y: 0, z: 1 } };
    for (const near of ["a-near", "z-near"]) {
      const result = intersectBrowserNativeReferenceGeometry(prepare([rectangle("b-far", 5), rectangle("c-far", 5), rectangle(near, 3)]), ray);
      expect(result, near).toMatchObject({ kind: "hit", primitiveId: near, distanceM: 3 });
    }
    expect(intersectBrowserNativeReferenceGeometry(prepare([rectangle("b", 5), rectangle("c", 5)]), ray))
      .toEqual({ kind: "unsupported", reason: "coincident-distinct-first-hit" });
  });
});
