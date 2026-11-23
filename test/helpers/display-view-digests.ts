// SPDX-License-Identifier: Apache-2.0
/**
 * #697 (2.28.0): the display-view hash locks as two digests per case, so that "samples unchanged" is a tested statement.
 *
 * - `samples`: SHA-256 of the image bytes only, the output a caller sees.
 * - `internals`: SHA-256 of the float64 internals (expected values, noise standard deviations, ...) and the diagnostics text.
 * The single digest the locks used before 2.28.0, over both in the same order, was kept beside them for 2.28.0 only and is
 * removed in 2.29.0 (#742).
 *
 * A change that claims "samples unchanged" leaves every `samples` lock untouched; only `internals` locks may be re-recorded with
 * it (docs/NUMERICAL_CORRECTNESS.md, "Test hash locks and platforms").
 */
import { createHash, type Hash } from "node:crypto";

export interface DisplayViewDigests { samples: string; internals: string }

function update(hash: Hash, array: ArrayBufferView): void {
  hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
}

/** The two digests of one rendered case: its samples, its internal arrays in order, then the text of its diagnostics. */
export function displayViewDigests(samples: ArrayBufferView, internals: readonly ArrayBufferView[], text: string): DisplayViewDigests {
  const s = createHash("sha256"), i = createHash("sha256");
  update(s, samples);
  for (const array of internals) update(i, array);
  i.update(text);
  return { samples: s.digest("hex"), internals: i.digest("hex") };
}
