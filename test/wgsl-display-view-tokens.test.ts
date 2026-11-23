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
import { CHART_RADIANCE_WGSL } from "../src/gpu/wgsl-chart-kernel.js";
import { CHART_COMPOSITE_PROBE_WGSL, chartCompositeWgsl } from "../src/gpu/wgsl-chart-composite-kernel.js";
import { chartPresetMaterialWgsl } from "../src/gpu/display-view-chart-material-module.js";
import { chartCompositeMaterialWgsl, displayViewModuleCommonWgsl } from "../src/gpu/display-view-composite-material-module.js";
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
      "quality-pixels+coupled+neighbors": assembleDisplayViewQualityPixelsWgsl(displayViewCoupledWgsl(true)),
      "chart-radiance": CHART_RADIANCE_WGSL,
      "chart-preset-material": chartPresetMaterialWgsl(),
      "chart-composite-dekker": chartCompositeWgsl("dekker"),
      "chart-composite-fma": chartCompositeWgsl("fma"),
      "chart-composite-probe": CHART_COMPOSITE_PROBE_WGSL,
      "composite-material-dekker": chartCompositeMaterialWgsl("dekker"),
      "composite-material-fma": chartCompositeMaterialWgsl("fma"),
      "module-common-dekker": displayViewModuleCommonWgsl("dekker")
    };
    expect(Object.fromEntries(Object.entries(shaders).map(([name, code]) => [name, hash(code)]))).toEqual(PINNED);
  });
});

/**
 * WGSL lexer tokens (`wgslTokens`, 2.29.0): recorded on e229-int at 783f38f (2.28.0's shaders) with the minifier of 2.28.0
 * (comments and indentation only), and the same on the source text (PHOTIVRA_WGSL_MINIFY=0). 2.28.0's pins split on blankspace
 * only; those split tokens equal the lexer's wherever blankspace separates every token, so they could not see a space the
 * minifier removed between two tokens. The chart and composite shaders are pinned too, since #658's seams assemble them from parts.
 */
const PINNED: Record<string, string> = {
  "speed": "ff6148ba41d46d80:6801",
  "speed+coupled": "b7732515fc13660b:13906",
  "speed+coupled+neighbors": "4c7b3472c8b8c6c5:14589",
  "quality-lattice": "e79c95f4e82f9303:3065",
  "quality-sites": "db9bdf9059641bfe:4151",
  "quality-sites-blocked": "94f3f6388e0d60a6:4269",
  "quality-pixels": "0f4d932727ddc6a4:10628",
  "quality-pixels+coupled": "7b1f0f1a71aa2d37:17733",
  "quality-pixels+coupled+neighbors": "bffeb37b3daeb106:18416",
  "chart-radiance": "cda195dc53f7e613:1935",
  "chart-preset-material": "d3fec8b2e2b1afd4:1638",
  "chart-composite-dekker": "08acd1d4c997e906:7137",
  "chart-composite-fma": "00954844da7f5a5e:7137",
  "chart-composite-probe": "1992964c729c4eaa:1840",
  "composite-material-dekker": "2488a90a93bf71b8:7274",
  "composite-material-fma": "44e168af6a3ff5c0:7274",
  "module-common-dekker": "9c89f165dc54ea90:1516"
};
