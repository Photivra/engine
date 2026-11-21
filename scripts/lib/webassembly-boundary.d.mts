// SPDX-License-Identifier: Apache-2.0
/** Types of scripts/lib/webassembly-boundary.mjs (#659). */
export const WEBASSEMBLY_MENTION_ALLOWLIST: string[];
export function mentionsWebAssembly(text: string): boolean;
export function findWebAssemblyUse(text: string, options?: { allowNodeBuiltins?: boolean }): string[];
