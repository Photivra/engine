// SPDX-License-Identifier: Apache-2.0
/**
 * #658: the display view's assembled shaders as WGSL token streams, pinned. Candidate 1 of #658 writes the helper functions the
 * Speed and Quality kernels share once and interpolates them into both; the shader text then differs by blank lines only, and
 * every token, in order, is the same. A change that moves a token of these shaders changes a hash here and must say why.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assembleDisplayViewSpeedWgsl } from "../src/gpu/wgsl-display-view-speed-kernel.js";
import { assembleDisplayViewQualityLatticeWgsl, assembleDisplayViewQualityPixelsWgsl, DISPLAY_VIEW_QUALITY_SITES_BLOCKED_WGSL,
  DISPLAY_VIEW_QUALITY_SITES_WGSL } from "../src/gpu/wgsl-display-view-quality-kernel.js";
import { displayViewCoupledWgsl } from "../src/gpu/wgsl-display-view-coupled.js";
import { wgslTokens } from "../scripts/lib/wgsl-minify.mjs";

const MATERIAL = "fn material_at(p: vec2<f32>) -> u32 { return 0u; }";
const hash = (code: string): string => {
  const tokens = wgslTokens(code) as string[];
  return createHash("sha256").update(JSON.stringify(tokens)).digest("hex").slice(0, 16) + ":" + tokens.length;
};

describe("display-view shader tokens (#658)", () => {
  it("are unchanged for every assembled shader", () => {
    const shaders: Record<string, string> = {
      speed: assembleDisplayViewSpeedWgsl(MATERIAL),
      "speed+coupled": assembleDisplayViewSpeedWgsl(MATERIAL, displayViewCoupledWgsl(false)),
      "speed+coupled+neighbors": assembleDisplayViewSpeedWgsl(MATERIAL, displayViewCoupledWgsl(true)),
      "quality-lattice": assembleDisplayViewQualityLatticeWgsl(MATERIAL),
      "quality-sites": DISPLAY_VIEW_QUALITY_SITES_WGSL,
      "quality-sites-blocked": DISPLAY_VIEW_QUALITY_SITES_BLOCKED_WGSL,
      "quality-pixels": assembleDisplayViewQualityPixelsWgsl(),
      "quality-pixels+coupled": assembleDisplayViewQualityPixelsWgsl(displayViewCoupledWgsl(false)),
      "quality-pixels+coupled+neighbors": assembleDisplayViewQualityPixelsWgsl(displayViewCoupledWgsl(true))
    };
    expect(Object.fromEntries(Object.entries(shaders).map(([name, code]) => [name, hash(code)]))).toEqual(PINNED);
  });
});

/** Recorded on main at 7c07a5e (2.27.0's shaders), before #658; the Speed and Quality pixel hashes equal the review's (#658). */
const PINNED: Record<string, string> = {
  "speed": "58c3b93e8b659f41:3748",
  "speed+coupled": "748b826220919f49:7211",
  "speed+coupled+neighbors": "8cb8c764bce01642:7495",
  "quality-lattice": "196e02b4ec572898:1602",
  "quality-sites": "64962af53987d15c:2163",
  "quality-sites-blocked": "c5bad3f34c9ff339:2257",
  "quality-pixels": "610be4a34fcebc18:4946",
  "quality-pixels+coupled": "697b6b0c2126867d:8409",
  "quality-pixels+coupled+neighbors": "a6874e7c64f74603:8693"
};
