# Native-only Print planning

Published in package/root API **1.1.0**, Print model **0.1.0**; kept in the **1.2.0** candidate.

This standalone, browser-safe API answers two questions:

- Does the captured native image have enough pixels for a given print size and viewing distance?
- What is the smallest compatible raster (pixel size) for the printer file?

It generates no pixels and no files. See [API conventions](API_STYLE.md), [staged geometry](PHYSICS_FOUNDATION.md), [processed output](PROCESSED_OUTPUT.md) and the [historical 1.1.0 release review](RELEASE_1_1_0.md).

## Authority and units

**Source.** `source.kind: "native-retained"` declares an authoritative native pixel grid and a public capture ID.

- The planner checks the geometry; it does not check whether that declaration is true. Callers must bind it to the retained capture, never to a resized preview or a processing enlargement.
- The existing `resolveCaptureGeometry()` owns orientation, the native active capture, an off-centre output crop, and the optical-axis conventions.
- The available pixels are its **output crop dimensions**, before any `outputRaster` resampling.
- Print planning changes nothing about the captured physics.

**Printed image.** `printedImage` is the flat physical image area. It excludes paper, borders and gallery wrap.

- Lengths are given explicitly in mm, cm, inches or metres. An inch is exactly 25.4 mm.
- PPI (pixels per inch) counts image samples per printed inch. Printer DPI, encoded file size, JPEG quality, paper and ICC colour management are separate matters.
- Actual delivery, resource limits and perceived quality or source detail stay `unassessed`.

## Angular convention and equation

**Why angles.** How fine a print needs to be depends on how big a pixel looks from where the viewer stands. That is an angle. Viewing distance is independent of image size.

**Equation.** Viewing a flat image straight on, a centred pixel of physical pitch `p` at distance `d` subtends:

`theta = 2 atan(p / (2d))`

In radians, the largest allowed pitch is `p_max = 2d tan(theta_max/2)`, and in millimetres `derived PPI = 25.4 / p_max`.

- No small-angle approximation is used.
- Any positive effective angle below 180 degrees is accepted mathematically. This broad geometric domain is not a model of visual acuity, and is not useful guidance at extreme angles.

**Choosing a convention.** You must pick one explicitly:

| Kind | Maximum effective pixel angle |
| --- | --- |
| `angular-pixel-pitch` | `maximumArcminutesPerPixel` |
| `angular-stroke` | `strokeWidthArcminutes / samplesPerStroke` |
| `angular-line-pair` | `periodArcminutes / samplesPerPeriod` |
| `manual-ppi` | No angular criterion; explicit independent density |

**How the stroke and line-pair options work.**

- They divide the declared angular budget by the sample count, by definition. They do not compute the exact physical subdivision of a finite test character (optotype) on a flat image; that difference matters for large angles. The exact centred-pixel equation is then applied to the resulting per-pixel budget.
- Stroke sampling needs a positive integer sample count.
- A line pair is one light and one dark stroke, and needs at least two samples.
- Examples: a two-arcminute line pair with two samples is one arcminute per pixel; a one-arcminute period with two samples is half that pitch.
- Two samples is a declared sampling minimum. It does not promise that contrast is preserved.

**No hidden assumptions.** The planner assumes no acuity value, no universal 300 PPI, no hidden safety factor, and no threshold at which pixels become invisible.

**Example.** At 24 inches, a declared one-arcminute pixel criterion gives approximately 143.239447773 PPI.

**Where one arcminute comes from.** One arcminute per pixel is a common choice and an approximate rule of thumb, not a visibility threshold. It is normal (20/20) visual acuity under optimal conditions: the minimum angle of resolution of an ideal eye is about 1 minute of arc, and 20/20 letters are built from elements that each subtend 1 arcmin (Z. Alomar, K. D. Bojikian, ["Visual Acuity Testing in Adults"](https://eyewiki.aao.org/Visual_Acuity_Testing_in_Adults), EyeWiki, American Academy of Ophthalmology, last edited June 16, 2026). Some viewers resolve finer detail and many resolve coarser, and lighting, contrast and the print itself change what is seen; the planner uses whatever criterion the caller declares.

**Provenance.** Angular guidance has `approximation` provenance, because using it as a perceptual criterion is uncalibrated. The geometry itself stays `calculated`. Manual PPI starts a new plan, and does not certify any earlier angular criterion.

## Integer policy, fit and sufficiency

**Exact aspect ratio.** The first policy keeps the **exact aspect ratio of the retained native raster**.

1. Reduce the native dimensions `(W,H)` by their greatest common divisor, to integers `(a,b)`.
2. For the continuous required counts `(Rx,Ry)`, choose `k = max(1, ceil(Rx/a), ceil(Ry/b))`.
3. The output is `(ka,kb)`.

This is the smallest sufficient integer raster **within the family of exact-ratio sizes**. It is not the pair you would get by rounding each axis independently.

Limitation: if the crop dimensions share no common factor, you may need to keep the whole native grid, even for a low-density request. This is stated explicitly. There is no search, and no hidden stretch.

**Fit check.** The physical printed-image ratio must agree with the confirmed crop, within the caller's `maximumRelativeAspectError`, in the range `[0,0.01]`.

- Relative error is `abs((imageWidth/imageHeight)/(W/H) - 1)`, and is returned.
- Zero demands exact equality, as represented in binary64.
- A nonzero tolerance explicitly accepts that small difference in physical pitch between the axes. Per-axis achieved PPI and angular pitch show it.
- Output resizing always uses one equal scale on both axes.
- An aspect mismatch returns `crop-confirmation-required`. Choose and confirm a different crop or physical image size, then plan again. The engine never silently crops or stretches.

**Contain fit (2.22.0).** To print on paper of another shape, pass `fit: { kind: "contain", paperOrientation }` and give the paper (or its printable area) as `printedImage`. The engine scales the native raster's aspect ratio to the largest image that fits inside the paper, centers it, and plans that image exactly as a `confirmed-native-aspect` plan of the same size.

- With paper `(P_w, P_h)` and native crop `(W, H)`, the scale is `min(P_w/W, P_h/H)`: the binding side equals the paper exactly, the other is `P_w·H/W` or `P_h·W/H`. This is the "contain" sizing of the W3C CSS Images Module Level 3, §5.5 ("Sizing Objects: the object-fit property"), used here only as the definition of the term. The geometry is exact up to binary64 rounding; `relativeAspectError` reports that rounding and no tolerance applies.
- `paperOrientation: "match-image"` turns the paper a quarter turn when it is portrait and the image landscape, or the other way round (a square image or paper is never turned). `"as-given"` keeps it.
- `printedImageMm` is the printed image. `plan.contain` gives `paperMm` (as placed), `paperRotated` and `bordersMm` (`left`, `right`, `top`, `bottom`; unprinted, equal on opposite sides, zero for paper of the image's shape). Borders are computed in the paper's unit and then converted, so whole-unit borders stay exact. Without a native raster, `printedImageMm` and `contain` are null.
- `calculatePrintSizeLimit()` uses the same layout: `maximumImageMm` keeps the fitted image's shape, and `maximumPaperMm` is the paper, scaled by the same factor, that holds it (null when the bound is not finite).
- Layout only: nothing is cropped, stretched or resampled, and the sampling criterion is unchanged. `contain` and `maximumPaperMm` are absent from `confirmed-native-aspect` results, which are byte-identical to 2.19.0.
- Example: a 6000 × 4000 raster on 8 × 10 in paper with `match-image` prints 10 × 6.667 in with 0.667 in borders on the long edges; on 6 × 4 in or 4 × 6 in paper the borders are zero.

**Sufficiency.** The same minimum raster is compared with the retained native pixels on **both axes**.

- `sufficient` only means the native pixels cover the declared criterion.
- A shortfall gives no recommendation.
- Upsampled pixels never count as capacity.
- A recommendation reports the integer raster, the achieved PPI and angle, and the equal native resampling scales, all in the same model/API result.
- Output may only downsample or keep native resolution.

## Lab constraints, alternatives and bounds

**Lab constraints.** Optional lab requirements limit delivery separately from angular guidance: a minimum or exact raster, and a minimum or exact PPI. All declared constraints are reconciled together.

- Exact density must give whole-number dimensions.
- An exact raster must keep the native ratio, meet the sampling and lab minimums, and not exceed either native axis.
- A contradiction, or a need to enlarge, returns `provider-conflict` and no recommendation, even when native angular sufficiency is `sufficient`.
- The caller supplies the real vendor requirements, and validates the file downstream. Omitting them means "unknown", not some universal lab default.
- Compatible lab minimums can raise the minimum recommendation.

**Alternatives.** The plan reports:

- the largest image size, keeping the aspect ratio, at the current distance; and
- for angular plans, the shortest viewing distance at the current image size.

These keep the criterion and the native pixels. They are **sampling alternatives**: lab constraints need a new full plan, and may still conflict. Manual density has no "view from farther away" solution.

Boundary alternatives are rounded outward to the adjacent binary64 value, and the integer policy is rechecked, for at most eight steps. Unsupported numerical cases return a blocker. This is rounding for representation, not loosened sampling or a safety factor.

**Size limit.** `calculatePrintSizeLimit()` takes a reference plan and an explicit distance policy.

- Fixed distance gives a finite sampling bound for that distance.
- Scaling both image axes and the distance together leaves the angular pixel pitch unchanged. So the bound is `unbounded` if the reference meets the criterion, and `no-positive-size` if it does not.
- Manual PPI gives its own finite bound.
- Size queries with lab constraints are explicitly `unsupported` in model 0.1.0; evaluate individual plans instead.
- No infinity value is serialised, and no finite printer or paper limit is invented.

**Errors and edge cases.**

- Malformed, unknown, zero, non-finite or invalid inputs throw the existing typed configuration or scientific errors.
- Missing native authority gives `cannot-assess`.
- Positive finite requests whose converted lengths, pitches, densities, diagnostics or output (as a safe integer) cannot be represented give `unsupported`.
- Calculations use binary64. Conservative rounding up can move an exact mathematical angular boundary by one ratio unit.
- Manual count calculations use directly supplied inches as they are, rather than converting through pitch and back.
- No global epsilon turns a failed sampling criterion into a pass.
- Results contain only finite numbers, and null where something is absent.

## Complete packed example

```ts
import { calculatePrintPlan, calculatePrintSizeLimit, type PrintPlanInput } from "@photivra/engine";
const input: PrintPlanInput = {
  source: { kind: "native-retained", captureId: "example-capture", geometry: {
    imagingArea: { widthMm: 32, heightMm: 18 },
    nativeRaster: { pixelWidth: 2560, pixelHeight: 1440 }, orientation: "landscape"
  } },
  printedImage: { width: 16, height: 9, unit: "inches" },
  viewingDistance: { value: 24, unit: "inches" },
  sampling: { kind: "angular-pixel-pitch", maximumArcminutesPerPixel: 1 },
  fit: { kind: "confirmed-native-aspect", maximumRelativeAspectError: 1e-12 }
};
const plan = calculatePrintPlan(input).value;
if (plan.status !== "ready" || plan.recommended?.raster.pixelWidth !== 2304 || plan.recommended.raster.pixelHeight !== 1296) throw new Error("Unexpected print raster");
const bound = calculatePrintSizeLimit({ plan: input, viewingDistancePolicy: "proportional-to-image-size" }).value;
if (bound.status !== "unbounded") throw new Error("Unexpected size bound");
console.log(plan.native?.pixelsPerInch, plan.recommended, bound.status);
```

For untrusted requests, use `parsePrintPlanInput()`. The calculation functions also parse and copy their inputs. No private assets, framework types, runtime dependencies, telemetry or reads of source pixels are needed.

When you build output metadata, keep the returned binding of capture, input, model and API. This API does not call the image exporter itself, and does not attach serialisation tags.

## References and evidence

- [NIST length units](https://www.nist.gov/pml/owm/si-units-length): unit conversion reference.
- [Adobe image resolution](https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/resize-adjust-resolution/printed-image-resolution.html): physical image dimensions versus pixel density.
- Z. Alomar, K. D. Bojikian, ["Visual Acuity Testing in Adults"](https://eyewiki.aao.org/Visual_Acuity_Testing_in_Adults), EyeWiki, American Academy of Ophthalmology, last edited June 16, 2026: for an ideal eye under optimal conditions the minimum angle of resolution is about 1 minute of arc, and 20/20 letters are built from 1-arcmin elements. The source for the one-arcminute rule of thumb; it describes clinical acuity testing, not print sampling.
- [University of Iowa acuity testing](https://webeye.ophth.uiowa.edu/eyeforum/video/Refraction/Visual-Acuity-Testing/index.htm): the critical stroke detail of a test character is different from the whole character. This is why conventions must be declared explicitly. It gives no universal guarantee about print sampling or quality.

The implementation, prose and tests are original. The references informed terminology and equations. No source tables, calibration, datasets or protected text were included.

**Tests.** Independent tests cover:

- the 160-PPI identity;
- a high-precision angular reference;
- all orientations and an off-centre crop;
- ignoring a preview enlargement;
- unit and one-pixel boundaries;
- the exact-ratio minimum search, with a fixed seed;
- lab conflicts and manual overrides;
- the meaning of the size bounds;
- invalid and extreme finite JSON.

Human review of science, sources and DCO is still required before release. Advanced assessment of captured detail and quality is separate (issue #196).

**1.2.0 acceptance audit.** The audit also exercised stamp, book, home, gallery, billboard and half-mile sizes and distances, with the same source and an explicit criterion, plus a heavy retained crop and recovery after invalid edits. These are geometric examples. They make no claim about eyesight, text readability, paper or readiness for file export.

The core contract (issue #195) was delivered in PR #210 and published in 1.1.0. Older references to an unpublished geometry candidate are superseded. Acceptance of the actual UI, tasks, devices and JPEG delivery belongs to the product that uses this API and to its exporter evidence, not to this pixel-free planning API.
