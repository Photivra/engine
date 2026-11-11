// SPDX-License-Identifier: Apache-2.0
// This product includes DNG technology under license by Adobe.

/**
 * #598, #600: an imported DNG's linear stage image, as the DNG specification's processing model defines it (chapter "Mapping Raw
 * Values to Linear Reference Values" and "Opcode List Processing"): OpcodeList1 on the stored codes (stage 1); then linearization
 * (LinearizationTable), black subtraction (BlackLevel with its repeat pattern plus BlackLevelDeltaH/V, origin the ActiveArea's
 * top-left) and scaling by WhiteLevel − black, clipped to 0..1, over the ActiveArea (stage 2); then OpcodeList2. For LinearRaw data
 * stage 3 is stage 2 and OpcodeList3 follows; a CFA mosaic stops at stage 2, and the caller applies OpcodeList3 with
 * `applyDngOpcodes` after demosaicing.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { fastFormatDefault, resolveFast } from "../facade/fast-resolution.js";
import { applyDngOpcodes, type DngStageImage } from "./dng-opcodes.js";
import type { ImportedDngRaw } from "./dng-import.js";

export interface DevelopDngStageImageOptions {
  /** The output the development is for ("srgb-8" or "srgb-16" on screen; "dng", "jpeg" or "png" exports). Default "png" (full quality). */
  format?: "srgb-8" | "srgb-16" | "dng" | "jpeg" | "png";
  /** The speed-versus-accuracy choice (WarpRectilinear resampling); default from `format` (fast on screen, full for exports). */
  fast?: boolean;
  /** Apply the opcode lists (default true). */
  opcodes?: boolean;
}
export interface DngStageImageResult extends DngStageImage {
  /** 3 for LinearRaw (every opcode list applied), 2 for a CFA mosaic (OpcodeList3 left to the caller). */
  stage: 2 | 3;
  /** The resolved `fast` and where it came from. */
  fast: { requested: boolean; defaultedFrom: "request" | "format" };
  /** What was applied and what was not. */
  assumptions: string[];
}

function fail(message: string): never { throw new InvalidConfigurationError("developDngStageImage: " + message); }

/** Builds the stage-2 (CFA) or stage-3 (LinearRaw) image of an imported DNG, normalized 0..1, interleaved by sample. */
export function developDngStageImage(raw: ImportedDngRaw, options: DevelopDngStageImageOptions = {}): DngStageImageResult {
  if (raw === null || typeof raw !== "object" || !(raw.codes instanceof Uint16Array)) fail("raw must be an ImportedDngRaw.");
  if (options === null || typeof options !== "object") fail("options must be an object.");
  for (const key of Object.keys(options)) if (!["format", "fast", "opcodes"].includes(key)) fail("unknown option " + JSON.stringify(key) + ".");
  const format = options.format ?? "png";
  if (!["srgb-8", "srgb-16", "dng", "jpeg", "png"].includes(format)) fail("format must be srgb-8, srgb-16, dng, jpeg or png.");
  if (options.fast !== undefined && typeof options.fast !== "boolean") fail("fast must be a boolean.");
  const fast = resolveFast(options.fast, fastFormatDefault(format, "capture")), useOpcodes = options.opcodes ?? true;
  const { width, height, samplesPerPixel: spp, codes, activeArea, blackLevel, whiteLevel, linearizationTable } = raw, scale = raw.scale;
  const notes: string[] = [];
  let stage1 = codes;
  if (useOpcodes && raw.opcodeList1?.length) {
    const image: DngStageImage = { width, height, planes: spp, data: Float32Array.from(codes, (v) => v / 65535) };
    notes.push(...applyDngOpcodes(image, raw.opcodeList1, { stage: 1, fast, scale }));
    stage1 = Uint16Array.from(image.data, (v) => Math.round(Math.min(Math.max(v, 0), 1) * 65535));
  }
  // Stage 2 covers the ActiveArea (whole pixels; a half-size area is rounded outwards).
  const ax = Math.floor(activeArea.x), ay = Math.floor(activeArea.y), aw = Math.min(width - ax, Math.ceil(activeArea.width)), ah = Math.min(height - ay, Math.ceil(activeArea.height));
  const data = new Float32Array(aw * ah * spp), { repeatRows: rr, repeatColumns: rc, values, deltaH, deltaV } = blackLevel;
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) for (let s = 0; s < spp; s++) {
    let v = stage1[((ay + y) * width + ax + x) * spp + s]!;
    if (linearizationTable) v = linearizationTable[Math.min(v, linearizationTable.length - 1)]!;
    const black = values[((y % rr) * rc + (x % rc)) * spp + s]! + (deltaH?.[x] ?? 0) + (deltaV?.[y] ?? 0);
    const span = whiteLevel[s]! - black;
    data[(y * aw + x) * spp + s] = span > 0 ? Math.min(Math.max((v - black) / span, 0), 1) : 0;
  }
  const image: DngStageImage = { width: aw, height: ah, planes: spp, data };
  if (useOpcodes && raw.opcodeList2?.length) notes.push(...applyDngOpcodes(image, raw.opcodeList2, { stage: 2, fast, scale }));
  const linearRaw = raw.photometricInterpretation === "linear-raw";
  if (useOpcodes && raw.opcodeList3?.length) {
    if (linearRaw) notes.push(...applyDngOpcodes(image, raw.opcodeList3, { stage: 3, fast, scale }));
    else notes.push("OpcodeList3 not applied: it acts on the demosaiced image; call applyDngOpcodes(image, raw.opcodeList3, { stage: 3 }) after demosaicing.");
  }
  if (!useOpcodes && (raw.opcodeList1 || raw.opcodeList2 || raw.opcodeList3)) notes.push("Opcode lists not applied (opcodes: false).");
  return { ...image, stage: linearRaw ? 3 : 2, fast: { requested: fast, defaultedFrom: options.fast === undefined ? "format" : "request" }, assumptions: notes };
}
