// SPDX-License-Identifier: Apache-2.0

/**
 * 2.26.0 (owner decision 2026-11-16, "Move export code out"): the encoded-output writers, one module that the capture loads on demand
 * (`exportKit`, src/facade/on-demand-kits.ts) when a request asks for `output.format` "jpeg" or "png" (with or without
 * `output.metadata`), so a bundler that splits dynamic imports keeps them off the default path. Only re-exports: the print JPEG
 * encoder (and the export JPEG coder it uses), the PNG encoder, and the JPEG and PNG text-metadata writers. Their results are the
 * same bytes as through a static import.
 */

export { createPrintJpegTask, PRINT_JPEG_LIMITS } from "../output/print-jpeg.js";
export { serializePngImage, PNG_ENCODER_LIMITS } from "../output/png-encoder.js";
export { addJpegTextMetadata, addPngTextMetadata } from "../output/text-metadata-writers.js";
