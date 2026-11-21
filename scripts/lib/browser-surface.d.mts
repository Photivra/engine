// SPDX-License-Identifier: Apache-2.0
/** Types of scripts/lib/browser-surface.mjs (#695). */
export function extractSpecifiers(source: string): string[];
export function isNodeBuiltin(specifier: string): boolean;
export function walkSourceGraph(entry: string, io: { sourceRoot: string; read(file: string): string }): { visited: Set<string>; violations: string[] };
export function isPublished(file: string, patterns: readonly string[]): boolean;
export function unvisitedPublished(files: readonly string[], visited: ReadonlySet<string>, patterns: readonly string[]): string[];
