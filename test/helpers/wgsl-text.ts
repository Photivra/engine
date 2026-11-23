// SPDX-License-Identifier: Apache-2.0
/**
 * Shader-text checks that do not depend on blankspace (2.29.0, #658): the tests import the shipped WGSL, whose minifier removes
 * the blankspace inside a line that cannot separate two tokens, so a test compares WGSL tokens (`wgslTokens`), not characters.
 */
import { wgslTokens } from "../../scripts/lib/wgsl-minify.mjs";

/** How often the tokens of `snippet` appear in the tokens of `code`, contiguous and in order. */
export function wgslCount(code: string, snippet: string): number {
  const haystack = wgslTokens(code) as string[], needle = wgslTokens(snippet) as string[];
  let count = 0;
  for (let i = 0; i + needle.length <= haystack.length; i++) if (needle.every((token, k) => haystack[i + k] === token)) count++;
  return count;
}
/** Whether the tokens of `snippet` appear in the tokens of `code`, contiguous and in order. */
export const wgslIncludes = (code: string, snippet: string): boolean => wgslCount(code, snippet) > 0;
