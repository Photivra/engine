# Deterministic linear capture encoding

> **Release context.** This page was written for package 1.2.0 (root API 1.2.0) and has not been re-reviewed for later releases. The [changelog](../CHANGELOG.md) describes the current release. Model and subsystem version numbers on this page, and any dated records, are separate from the package version. See also the [developer guide](DEVELOPERS.md) and the [1.2.0 release contract](RELEASE_1_2_0.md).

`calculateLinearCaptureEncoding()` turns one bounded inline `SimulatedCapture` plane into unsigned 16-bit linear codes, without tying them to any file format (issue #15C).

- The exact plane and image-state identity are required.
- The master plane is not changed.
- Colour, WB application, the source reference value and upstream capture-saturation history travel with the encoded data.
- It does not choose a file format, and does not invent a colour conversion.

## The mapping

Encoding schema `0.1.0` uses one uniform mapping for every channel. Let:

- B be `blackValue` and b be `blackCode`;
- R be the source plane's `referenceWhiteValue` and r be `referenceWhiteCode`.

Requirements: R must exceed B; codes must satisfy 0 ≤ b < r ≤ 65535; and all derived ranges and scales must be finite and representable.

- The continuous code is `b + (sample-B)/(R-B)*(r-b)`.
- The scale is `(r-b)/(R-B)` codes per relative source unit.

Using the same normalisation and scale on every channel keeps linear colour ratios, after the declared black baseline is subtracted.

| Contract | Meaning |
| --- | --- |
| blackValue / blackCode | Relative source baseline and its integer code; blackCode can reserve room for negative samples. |
| referenceWhiteValue / referenceWhiteCode | Source normalization and its code; reference white can be below the code maximum to preserve headroom. |
| representable limits | B − b/scale and B + (65535−b)/scale, the upper one never below R (code r ≤ 65535 always represents reference white, so r = 65535 encodes for any R); these are encoded range limits, not physical capture saturation. |
| headroomFactor | (65535−b)/(r−b), relative to the above-black reference-white interval. |
| negativeValues | Explicit reject of any sample < 0, or preserve-if-representable. The latter still obeys the independently declared out-of-range policy. |
| outOfRange | Explicit reject, or clip to 0/65535 with separate low/high source-sample counts. |
| rounding | Nearest code; exact binary64 half ties toward the larger code. No dither or hidden stochastic state. |

## Numerical behaviour

- Finite source values are compared with the representable limits before any arithmetic. So extreme finite samples can be clipped without overflowing the mapping.
- Exact black, reference and endpoint values return their declared codes.
- Other in-range mapped values round with `Math.round` (model `uniform-linear-capture-uint16` 0.2.0). The earlier `floor(code+0.5)` rounded 0.49999999999999994 up to 1.
- Only rounding error at the endpoints is pulled back into the code range.
- The ideal in-range rounding error is at most 0.5/scale source units. This bound excludes clipping and binary64 arithmetic error. Correctly rounded arbitrary-precision real arithmetic is not promised.
- NaN, Infinity, sparse source arrays, and invalid or numerically unrepresentable ranges fail.
- Identical validated inputs give identical codes on all supported JavaScript runtimes.

## What codes do and do not mean

- An encoded maximum, or a quantised sample at 65535, does not prove the sensor saturated.
- A sample rounded to an endpoint is not counted as source clipping.
- The source's `captureSaturation` stays upstream history in its original capture domain.
- `defaultRenderingExposureEv:null` means the encoder chooses no rendering exposure or display white.
- It applies no gain, WB or adaptation, gamma or transfer curve, tone, look or gamut mapping, or resampling. It does no RAW reconstruction, and does not recover losses from an upstream LDR (low dynamic range) step.

## Output

The output is serialisable numbers plus explicit metadata, in row-major order, with source channels interleaved.

- `captureMetadata` carries the cleaned source manifest without float planes. Geometry and settings, resolved WB intent, adopted white, noise and source identities, and model and evidence provenance stay available to serialisers.
- `sourcePlane` carries colour, WB, history, saturation, and raster and channel identity, without float storage.

**What serialisers own.** Byte packing, endianness, checksums, TIFF/DNG tags and any format-specific range restrictions belong to the file export step ([photographic export](PHOTOGRAPHIC_EXPORT.md)). A serialiser must respect the declared scientific meaning, and reject mappings it cannot represent.

- XYZ, virtual-camera channels and transformed RGB keep different identities, even though all of them can be quantised.
- Quantising unresolved channels does not create a usable sensor colour profile, and does not make a DNG ready for export.
- External float references stay as manifests. This synchronous bounded executor rejects them, rather than doing IO or trusting unverified bytes.

## Tests

The tests share the canonical camera and seed metadata (issue #130) with the colour tests. They check:

- invariants for reference white, headroom and clipping;
- exact half ties and their neighbours;
- negatives kept through an offset;
- independent rejection of negatives and of out-of-range values;
- clipping of extreme finite values;
- a non-unit source reference and black;
- that saturation history is kept;
- consistency between colour conversion and encoding;
- deterministic results;
- substitution of the wrong state;
- private or malformed policies;
- invalid samples and ranges.

The implementation and arithmetic fixtures were written independently, with no third-party code or data and no new runtime dependencies. Human review of science and provenance, and contributor DCO certification, are still required before inclusion.
