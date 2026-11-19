// SPDX-License-Identifier: Apache-2.0
/**
 * The equivalence test of the 2.27.0 plan (rule 4, owner decision 3): two methods that form the same sum in another order are one
 * path when every site's expected electrons agree within 1e-9 relative and the 8-bit samples within one code, and a region of a
 * view equals the same pixels of the whole view bit for bit (rule 5). The tolerance is the one
 * `test/display-view-defocus-regrouped.test.ts` uses for #612 and #642.
 *
 * Three comparisons, each returning its figures (for a test's message or a chunk's report) and each with an `expect…` form:
 *
 * - `compareSiteElectrons`: two site sources (`DisplayViewExpectedSignal`s, or anything with `site(x, y)`) over a rectangle of
 *   native sites.
 * - `compareViews`: two renders of the same view (the display pixels' expected values and the samples); with
 *   `simulateDisplayViewWithInternals` results, the expected values are `internals.expected`.
 * - `compareRegionWithWhole`: a region render against the same pixels of a larger render of the same prepared view.
 */
import { expect } from "vitest";

/** Rule 4's tolerance: relative difference of expected electrons (and expected values), and sample codes. */
export const VIEW_EQUIVALENCE = Object.freeze({ relative: 1e-9, codes: 1 });

export interface SiteSource { site(x: number, y: number): number }
/** Native sites [x0, x1) × [y0, y1). */
export interface SiteRectangle { x0: number; y0: number; x1: number; y1: number }
/** A display-view region: its origin in the view and its size in display pixels. */
export interface ViewRegion { x: number; y: number; width: number; height: number }

export interface RelativeComparison {
  /** Values compared. */
  count: number;
  /** Values whose bits differ. */
  differing: number;
  /** Largest |a − b| / max(|a|, |b|) (0 where both are 0). */
  worstRelative: number;
  /** Where the largest difference is: a site (x, y) for sites, an index for arrays; undefined when none differ. */
  worstAt: { x: number; y: number } | number | undefined;
}
export interface CodeComparison { count: number; differing: number; worstCodes: number; worstAt: number | undefined }

/** |a − b| / max(|a|, |b|); 0 when they are equal (both 0 included), Infinity when either is not finite and they differ. */
export function relativeDifference(a: number, b: number): number {
  if (a === b || (Number.isNaN(a) && Number.isNaN(b))) return 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));
}

/** Every native site of `rect` read from both sources (in row order, the same order for both). */
export function compareSiteElectrons(a: SiteSource, b: SiteSource, rect: SiteRectangle): RelativeComparison {
  let count = 0, differing = 0, worstRelative = 0, worstAt: { x: number; y: number } | undefined;
  for (let y = rect.y0; y < rect.y1; y++) for (let x = rect.x0; x < rect.x1; x++) {
    const d = relativeDifference(a.site(x, y), b.site(x, y));
    count++;
    if (d !== 0) differing++;
    if (d > worstRelative || (d !== 0 && worstAt === undefined)) { worstRelative = d; worstAt = { x, y }; }
  }
  return { count, differing, worstRelative, worstAt };
}

/** Two arrays of the same length, value by value. */
export function compareRelative(a: ArrayLike<number>, b: ArrayLike<number>): RelativeComparison {
  if (a.length !== b.length) throw new Error(`compareRelative: lengths differ (${a.length} and ${b.length}).`);
  let differing = 0, worstRelative = 0, worstAt: number | undefined;
  for (let i = 0; i < a.length; i++) {
    const d = relativeDifference(a[i]!, b[i]!);
    if (d !== 0) differing++;
    if (d > worstRelative || (d !== 0 && worstAt === undefined)) { worstRelative = d; worstAt = i; }
  }
  return { count: a.length, differing, worstRelative, worstAt };
}

/** Two sample arrays of the same length, in codes. */
export function compareCodes(a: ArrayLike<number>, b: ArrayLike<number>): CodeComparison {
  if (a.length !== b.length) throw new Error(`compareCodes: lengths differ (${a.length} and ${b.length}).`);
  let differing = 0, worstCodes = 0, worstAt: number | undefined;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i]! - b[i]!);
    if (d !== 0) differing++;
    if (d > worstCodes) { worstCodes = d; worstAt = i; }
  }
  return { count: a.length, differing, worstCodes, worstAt };
}

/** A render's samples and, when known, its display pixels' expected values (`internals.expected`). */
export interface ViewOutput { samples: ArrayLike<number>; expected?: ArrayLike<number> | undefined }
export interface ViewComparison { samples: CodeComparison; expected: RelativeComparison | undefined }

/** Two renders of the same view: samples in codes and, when both carry them, expected values relative. */
export function compareViews(a: ViewOutput, b: ViewOutput): ViewComparison {
  return { samples: compareCodes(a.samples, b.samples), expected: a.expected && b.expected ? compareRelative(a.expected, b.expected) : undefined };
}

/**
 * The pixels of `part` (rendered at `partRegion`) against the same pixels of `whole` (rendered at `wholeRegion`, which must
 * contain it), `components` values per pixel. Returns the pixels whose values differ (any bit) and the first of them.
 */
export function compareRegionWithWhole(whole: ArrayLike<number>, wholeRegion: ViewRegion, part: ArrayLike<number>, partRegion: ViewRegion, components = 3):
  { pixels: number; differing: number; first: { x: number; y: number } | undefined } {
  const dx = partRegion.x - wholeRegion.x, dy = partRegion.y - wholeRegion.y;
  if (dx < 0 || dy < 0 || dx + partRegion.width > wholeRegion.width || dy + partRegion.height > wholeRegion.height) {
    throw new Error("compareRegionWithWhole: the part's region must lie inside the whole's.");
  }
  if (whole.length !== wholeRegion.width * wholeRegion.height * components || part.length !== partRegion.width * partRegion.height * components) {
    throw new Error("compareRegionWithWhole: an array's length does not match its region.");
  }
  let differing = 0, first: { x: number; y: number } | undefined;
  for (let y = 0; y < partRegion.height; y++) for (let x = 0; x < partRegion.width; x++) {
    const p = (y * partRegion.width + x) * components, w = ((y + dy) * wholeRegion.width + x + dx) * components;
    let same = true;
    for (let c = 0; c < components; c++) if (!Object.is(part[p + c], whole[w + c])) same = false;
    if (!same) { differing++; first ??= { x: partRegion.x + x, y: partRegion.y + y }; }
  }
  return { pixels: partRegion.width * partRegion.height, differing, first };
}

export function expectSiteElectronsEquivalent(a: SiteSource, b: SiteSource, rect: SiteRectangle, relative = VIEW_EQUIVALENCE.relative): RelativeComparison {
  const r = compareSiteElectrons(a, b, rect);
  expect(r.worstRelative, `worst site ${JSON.stringify(r.worstAt)}, ${r.differing} of ${r.count} sites differ`).toBeLessThanOrEqual(relative);
  return r;
}

export function expectViewsEquivalent(a: ViewOutput, b: ViewOutput, tolerance: { relative?: number; codes?: number } = {}): ViewComparison {
  const r = compareViews(a, b), relative = tolerance.relative ?? VIEW_EQUIVALENCE.relative, codes = tolerance.codes ?? VIEW_EQUIVALENCE.codes;
  expect(r.samples.worstCodes, `worst sample ${r.samples.worstAt}, ${r.samples.differing} of ${r.samples.count} differ`).toBeLessThanOrEqual(codes);
  if (r.expected) expect(r.expected.worstRelative, `worst expected value ${String(r.expected.worstAt)}, ${r.expected.differing} of ${r.expected.count} differ`).toBeLessThanOrEqual(relative);
  return r;
}

export function expectRegionEqualsWhole(whole: ArrayLike<number>, wholeRegion: ViewRegion, part: ArrayLike<number>, partRegion: ViewRegion, components = 3): void {
  const r = compareRegionWithWhole(whole, wholeRegion, part, partRegion, components);
  expect(r.differing, `${r.differing} of ${r.pixels} pixels differ, first at ${JSON.stringify(r.first)}`).toBe(0);
}
