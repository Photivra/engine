# Physics Foundation

> **Release context.** This page was written for package 1.2.0 (root API 1.2.0) and has not been re-reviewed for later releases. The [changelog](../CHANGELOG.md) describes the current release. Model and subsystem version numbers on this page, and any dated records, are separate from the package version. See also the [developer guide](DEVELOPERS.md) and the [1.2.0 release contract](RELEASE_1_2_0.md).

This page describes the geometry and optics models in Photivra. Each one is an analytical model: it can be tested independently, and its assumptions are stated explicitly.

## Implemented models

### Rectilinear field of view

A rectilinear (straight-line-preserving) lens gives this field of view (FOV):

`FOV = 2 atan(d / (2v))`

- `d` is the relevant sensor dimension.
- `v` is the projection distance (the lens-to-image-plane distance).

Which `v` is used depends on whether you supply a focus distance:

- **No focus distance:** `v = f` (the focal length). This is the infinity-focus, or pinhole, approximation.
- **Focus distance supplied:** `v` is the ideal Gaussian thin-lens image distance.

The symmetric formula above is enough for a sensor area centred on the optical axis. For an off-centre area, Photivra uses signed sensor-plane bounds measured from the optical axis:

`FOV = atan(x_max / v) - atan(x_min / v)`

This keeps the true left/right (or top/bottom) angular limits. It does not pretend that every active crop is centred.

### Non-rectilinear lens projections (2.0)

Two functions convert between a direction and an image point for an ideal lens mapping:

- `calculateLensProjectionImagePoint()` maps a camera-frame direction to an image-plane point.
- `calculateLensProjectionDirection()` maps an image-plane point back to a direction.

Coordinates: the camera frame is +X right, +Y up, +Z toward the scene. The image plane is +X right, +Y up and not inverted.

For field angle `θ` (measured from the optical axis) and image radius `r`:

| `projectionModel` | Mapping | Domain |
| --- | --- | --- |
| `rectilinear` (default) | `r = f tan θ` | `θ < 90°` |
| `fisheye-equidistant` | `r = f θ` | `θ < 180°` |
| `fisheye-equisolid-angle` | `r = 2f sin(θ/2)` | `θ < 180°` (`r < 2f`) |
| `fisheye-stereographic` | `r = 2f tan(θ/2)` | `θ < 180°` |
| `fisheye-orthographic` | `r = f sin θ` | `θ ≤ 90°` (`r ≤ f`) |
| `equirectangular` | `x = f·longitude`, `y = f·latitude` | `|longitude| ≤ π`, `|latitude| ≤ π/2`, poles excluded |

The radial models keep the image azimuth equal to the scene azimuth, so they are rotationally symmetric. The equirectangular model turns yaw into a horizontal shift.

- `calculateLensProjectionFieldOfView()` returns `2θ(d/2)` (or `d/f` for equirectangular). It rejects a sensor dimension larger than a fisheye's image circle, or wider than 360°.
- `calculateLensProjectionFieldOfViewBounds()` handles off-centre crops with signed bounds.

`calculateFieldOfView()` and `calculateFieldOfViewBounds()` take an optional `projectionModel`. If you omit it, or pass `"rectilinear"`, you get exactly the previous result and model id. A non-rectilinear model uses the focal length as its mapping scale. It rejects `focusDistanceM`, because the scale of a fisheye focused at a finite distance is not modelled.

These are ideal mapping functions (Kannala & Brandt 2006, *IEEE TPAMI* 28:1335, eqs. 1–5, [free author copy](https://users.aalto.fi/~kannalj1/calibration/Kannala_Brandt_calibration.pdf); Snyder, *Map Projections — A Working Manual*, USGS PP 1395, 1987, free; Miyamoto 1964, *JOSA* 54:1060. Also see: Kingslake, *A History of the Photographic Lens*, 1989; Ray, *Applied Photographic Optics*, 3rd ed., 2002). Real fisheye lenses deviate from them. Modelling a real lens would need a calibrated polynomial (for example Kannala–Brandt) with defensible provenance.

### Sensor geometry, sampling, capture, and crop

Photivra keeps the physical geometry of image formation separate from digital sampling.

- `SensorImagingArea` is the physical light-sensitive area used to form the image. It is not the size of the sensor package or die.
- `NativeImageRaster` is the sensor's effective native sampling grid. One image sample does not have to correspond to one physical photodiode.
- `RasterDimensions` describes generic active and output rasters.

Sample pitch is computed separately on each axis:

- `pitchX = imagingWidth / nativePixelWidth`;
- `pitchY = imagingHeight / nativePixelHeight`.

These pitches are only the geometric spacing between samples. They are not the fill factor, the effective collection area or the photon-collection area.

The capture pipeline runs in stages:

```text
physical imaging area + native raster
              ↓
native active-capture rectangle
              ↓
physical camera orientation
              ↓
oriented active capture
              ↓
digital/output crop
              ↓
output raster
```

**Coordinates.** Native raster coordinates have their origin at the top left, with +X right and +Y down. Integer rectangles are half-open (they include their start edge but not their end edge). Rotating the camera does not change the native coordinate system. Instead, Photivra explicitly transforms points, vectors and rectangles between native and oriented coordinates.

**Active area.** The generic sensor model assumes the native sampling grid covers the declared physical imaging area uniformly. From that it derives the active physical dimensions and the offset from the optical axis. This assumption is recorded because a future calibrated camera profile may need to supply the physical active area directly.

**Off-centre active areas.** Moving the active rectangle off-centre changes both its physical size and its angle relative to the optical axis. It therefore needs asymmetric angular bounds, not the centred FOV formula. For an off-centre rectangle, the two corner-to-corner diagonal spans can differ. `calculateActiveCaptureFieldOfView()` reports both, and uses the larger one for its summary `diagonalDegrees` value.

**Output crop.** Cropping and resampling the output is digital geometry. It does not change the physical sensor or the active-capture geometry. The output raster's aspect ratio must match the selected output crop; Photivra rejects any implicit stretching.

**Centred crop by crop factor.** The shorter axis is `floor(dimension / cropFactor)`. The longer axis is the integer closest to the source aspect ratio, capped at `floor(dimension / cropFactor)`. This keeps the aspect ratio as close as whole pixels allow.

**Subject-height framing crop.** This computes the extra same-aspect crop needed so a subject fills a requested fraction of the image height. It assumes the crop can be positioned around the subject; it does not check whether the subject is near an image edge. The crop height is the largest whole-pixel height within the requested crop height, but never fewer pixels than the subject needs. The width is the integer closest to the source aspect ratio.

### Crop factor and 35 mm-equivalent focal length

Crop factor is measured on the diagonal, relative to a 36 × 24 mm reference frame:

`cropFactor = diagonal_35mm / activeCaptureDiagonal`

The usual 35 mm-equivalent focal length is:

`equivalentFocalLength = actualFocalLength × cropFactor`

The actual focal length stays the optical focal length. The equivalent focal length is only a framing convention. It never replaces the physical focal length in projection or depth-of-field calculations.

Photivra bases equivalence on the active physical capture area, not on any later digital crop. Rotating the camera leaves the active diagonal unchanged, so it does not change the equivalent focal length. Two formats with the same diagonal-equivalent number can still have different horizontal and vertical FOV if their aspect ratios differ.

### Sensor equivalence: f-number, area and blur share

`calculateSensorEquivalence()` (model `sensor-equivalence` 1.0.0) compares a lens of focal length `f` at f-number `N` on a sensor with a reference format (36 × 24 mm by default). With the diagonal crop factor `k = referenceDiagonal / sensorDiagonal`:

| Quantity | Formula | Exact or approximated |
| --- | --- | --- |
| Crop factor | `k` | Exact (diagonal convention). |
| Equivalent focal length | `k·f` | Exact: same diagonal angle of view, ideal rectilinear lens at infinity focus. Horizontal and vertical angles match only when aspect ratios match. |
| Equivalent f-number (depth of field, blur, total light) | `k·N` | Approximation, see below. |
| Exposure f-number | `N` | Exact: image illuminance is proportional to `1/N²` and does not depend on sensor size (Greivenkamp, [OPTI-502 course notes, sec. 11](https://wp.optics.arizona.edu/jgreivenkamp/wp-content/uploads/sites/11/2019/08/502-11-Radiative-Transfer.pdf), free). Transmission, vignetting and close-focus bellows factor are excluded. |
| Entrance-pupil diameter | `D = f/N` | Exact by definition of the f-number. The equivalent lens `k·f` at `k·N` has the same `D`. |
| Area ratio | `(w·h)/(w_ref·h_ref)` | Exact. |
| Total-light difference | `log2(areaRatio)` stops | Exact at the same f-number, shutter and scene, for uniform image illuminance. |
| Angles of view | `2·atan(dimension / 2f)` | Exact for an ideal rectilinear lens at infinity focus. |

**Why `k·N` is an approximation.** Take the thin-lens defocus-circle diameter `c = f²|s − d|/(N d (s − f))` (see [Thin-lens focus and depth of field](#thin-lens-focus-and-depth-of-field); Greivenkamp sec. 12). Express the blur as a share of the frame diagonal and compare focal length `f` on the sensor with `k·f` on the reference, at the same focus distance `s` and subject distance `d`. The shares are equal when the reference f-number is `k·N·(s − f)/(s − k·f)`. This factor does not depend on `d`, and it tends to `k·N` when `s ≫ f`. Same framing, same subject distance and the same output size are assumed. The equivalent f-number concerns depth of field and blur (and total light through the same entrance pupil); it is never an exposure setting.

`calculateBlurShareOfFrame()` (model `blur-share-of-frame` 1.0.0) divides a blur-circle diameter by the frame diagonal, width and height. With a print size it enlarges the whole frame to fit inside the print, long side to long side, and reports the blur on the print. These are exact ratios. Equal shares of the diagonal look the same at the same output size, which is the convention behind the diagonal-scaled circle of confusion. Whether a blur is visible depends on viewing distance and acuity, which neither function judges.

### Aperture (entrance-pupil) diameter

`calculateApertureDiameter()` (model `aperture-diameter` 1.0.0, #577) gives the entrance-pupil diameter `D = f/N` in millimetres from the focal length `f` and the f-number `N`; 50 mm at f/2 gives 25 mm. It is exact by the definition of the f-number, `N = f/D` for an object at infinity (Greivenkamp, [OPTI-502 course notes, sec. 12](https://wp.optics.arizona.edu/jgreivenkamp/wp-content/uploads/sites/11/2019/08/502-12-Objectives.pdf), free). `D` is the diameter of the entrance pupil, the aperture stop as seen from the front of the lens, not of the diaphragm's physical opening. One stop (a factor √2 in `N`) halves the pupil's area.

Not modelled: at close focus the f-number that sets exposure and diffraction is the working f-number `N·(1 + m/P)`, with magnification `m` and pupil magnification `P` (exit-pupil over entrance-pupil diameter; also see Ray, *Applied Photographic Optics*, 3rd ed.); the engine's irradiance bridge uses `N·(1 + m)`, unit pupil magnification. A lens that focuses by changing its focal length changes `f`, and so `D` at the same marked `N`.

### Crop to match a longer focal length

`calculateCropToMatchFocalLength()` (model `crop-to-match-focal-length` 1.0.0, #579) gives the centred crop that makes an image taken at focal length `f` match the framing of a longer focal length `F` from the same camera position, and the pixels that crop leaves. An ideal rectilinear lens focused at infinity images a scene point at field angle `θ` at height `f·tan θ` (Greivenkamp, sec. 12), so the image at `F` is the image at `f` scaled by `F/f`: the crop factor is `F/f`, exact at infinity focus, with the same perspective because the camera has not moved. The crop is `calculateCenteredCrop()`'s, which keeps the aspect ratio to whole pixels. A 24 MP (6000 × 4000) image at 50 mm cropped to match 100 mm: factor 2, 3000 × 2000, 6 MP.

Not modelled: at close focus the thin-lens magnification is `m = f/(d − f)` at object distance `d` from the lens, so at the same `d` the matching factor is `F·(d − f)/(f·(d − F))`, larger than `F/f` and tending to it when `d ≫ F` (at `d` = 1 m, 50 → 100 mm needs 2.11 instead of 2). Distortion and focus breathing are not modelled either. The crop has the longer lens's framing but only the pixels of the cropped region, so it records no more detail than that part of the shorter lens's image.

### Projection, focus extension, object size, and motion

Four calculations support two projection modes: field of view, projected size of a flat object facing the camera, projected subject motion (of one representative point), and projected camera shake.

- **Pinhole / infinity-focus mode** (no focus distance supplied): the nominal focal length is the projection distance.
- **Focus-aware thin-lens mode** (focus distance supplied): the projection distance comes from the Gaussian thin-lens equation `1/f = 1/s + 1/v`.

There is no hidden distance threshold and no sudden switch between the modes. You choose the model by supplying or omitting the focus distance.

How much does it matter? At a focus distance of 100 focal lengths or more, the thin-lens projection scale differs from the infinity-focus approximation by no more than about 1.011%. For example, a 200 mm lens focused at 22 m (110 focal lengths) changes the projected scale by about 0.92%.

The focus-aware model is more consistent with the thin-lens depth-of-field and defocus calculations. It is still an ideal paraxial (small-angle) model. It does not model real-lens focus breathing, pupil magnification, principal-plane movement, distortion, aberrations or lens-specific macro behaviour.

Projected subject motion is still a single-point model with constant linear velocity in the world. A separate model, described next, handles extended objects. It projects several metric points under the same rigid translation. Motion toward or away from the camera can then produce different trajectories across the object, and a validated planar magnification where that applies.

### Extended-object projection under rigid translation

One point cannot describe an extended object moving along the optical axis. With rectilinear projection, a point on the axis can stay still while off-axis points move outward or inward as the object's depth changes.

So the extended-object model projects every supplied point independently over time. For a rigid object and a translating camera:

```text
relative velocity = object translation - camera translation
position_i(t) = position_i(0) + relative velocity * t
projected_i(t) = v * (x_i(t)/z_i(t), y_i(t)/z_i(t))
```

Here `v` is the selected projection distance (nominal or focus-aware).

This first model is rigid and translation-only on purpose. It does not model rotation, articulation, deformation or acceleration of the object.

A single magnification value is only valid for a constrained geometry. Photivra reports a planar scale only when the caller declares a flat patch facing the camera, and every supplied point checks out at the same reference depth. Under shared rigid translation that scale is:

`reference depth / current depth`

This special case does not mean that arbitrary 3D geometry has one scale or one homography (a single planar image transform).

When the model is bound to a capture-mode timing profile (see the next section), each object point is evaluated on its own local exposure clock. This preserves rolling-shutter timing without treating sensor readout time as exposure time.

The geometry result does not decide what is visible. Motion along or across the axis can reveal or hide surfaces, and can move geometry across the frame edge; a renderer must evaluate those states itself. Depth changes during the exposure can also change defocus and the PSF (point-spread function, the image of a point source), so a single static blur or PSF is not automatically valid.

### Mode-bound exposure/readout timing and temporal translation

Photivra keeps two clocks apart:

1. **Local exposure-window timing.** Measured from the first opening edge of the exposure.
2. **Sensor data-readout timing.** Measured from the sensor's own native readout start.

A capture-mode timing profile ties both sets of facts to one exact capture mode and profile. It does not claim the two clocks are synchronised. A global readout removes the spatial skew of reading out row by row; it does not remove motion during a finite exposure.

The supported exposure and readout schedules are simultaneous, or a uniform linear scan across the native sensor. More complex non-uniform schedules are rejected until an explicit model represents them.

**Rotation versus translation.** Pure camera rotation can be evaluated without knowing scene depth. Camera translation cannot. Under constant translation, a stationary scene point at metric position `(x,y,z)` is evaluated from its camera-relative position over time. Its image displacement therefore depends on its depth through rectilinear projection. As a result, arbitrary 3D translation has no single image-plane homography that is valid everywhere.

Optional subject velocity stays separate from camera translation, and the two combine as relative motion. Subject motion is never reinterpreted as sensor or readout behaviour.

**Integrating radiance over time.** Temporal radiance integration uses fixed midpoint sample times inside each local exposure interval. Scene-radiance providers must be evaluated at those physical capture times; sensor readout time is never substituted for exposure time. Each sample keeps its own uncertainty and evidence. The total uncertainty stays unquantified unless the caller supplies justified correlation assumptions.

### Manual flash timing and scene-light boundary

The first flash model is not a special image effect. It combines two existing models:

1. spatial and temporal scene illumination; and
2. exposure-edge timing.

A short manual-flash pulse is a one-off (aperiodic) relative illumination waveform attached to an explicit light source in the scene. The source geometry therefore stays available to the scene-radiance transport layer, which handles distance, surface angle, visibility and shadows, and indirect light.

**Ordinary flash sync.** Normal full-frame flash sync needs a non-empty time interval during which every point of the active capture is exposed at once. For the supported simultaneous or uniform-linear schedules:

- the latest opening time is zero for a simultaneous opening; otherwise it is the declared opening travel time;
- the earliest closing time is the nominal closing reference;
- ordinary one-pulse sync is valid only if the whole pulse fits inside that interval.

This rule comes from the exposure edges, not from sensor readout.

Front-curtain and rear-curtain modes differ only in where the same pulse sits inside that valid interval. Their different look with moving subjects or ambient trails must come from integrating the time-varying scene radiance, not from drawing a synthetic trail.

Flash duration and shutter duration are independent. A longer shutter collects more ambient light; it does not make a fixed short flash pulse proportionally stronger.

**High-speed sync (HSS).** Ordinary sync never covers HSS. If a moving-slit exposure has no moment when the whole frame is open, relabelling a single pulse as HSS does not make it compatible. HSS is the separate quasi-continuous burst model in `resolveHighSpeedFlashSync()` (sync profile schema 0.2.0); see [Flash: guide number, TTL and high-speed sync](SCENE_SENSOR_TEMPORAL_EXPOSURE.md#flash-guide-number-ttl-and-high-speed-sync).

**TTL and exclusions.** Manual flash has no TTL (through-the-lens automatic flash metering). Generic pre-flash TTL power is solved separately by `resolveTtlFlashExposure()` and then applied to the manual profile. Not modelled: recycle and thermal behaviour, flash exposure lock, red-eye, modelling-light and AF-assist emissions, and brand-specific protocols. Camera white balance is a later interpretation step; it never changes the emitted flash spectrum.

### Generic illumination vignetting

The engine provides a generic, rotationally symmetric model of **relative linear illumination** across the field:

```text
T(rho) = 1 + r2*rho² + r4*rho⁴ + r6*rho⁶
```

`rho` is the ideal image-plane field radius divided by a physical normalisation radius that the caller declares. The optical axis is normalised so that `T(0) = 1`.

The declared `maximumNormalizedRadius` is the range over which the model is valid. Photivra evaluates the polynomial at both ends and at every real interior extremum over that range. It rejects a profile that:

- produces zero or negative throughput; or
- exceeds the centre value of 1.

The result is a multiplicative attenuation in linear light, plus the equivalent loss in stops (a positive number).

This model is **not mechanical or pupil vignetting**. It does not clip the pupil and does not change the bokeh or PSF shape. It does not claim calibrated radiometry or the behaviour of any named lens.

In 2.0 the interior extrema are the real roots of `dT/ds = r2 + 2 r4 s + 3 r6 s²` (with `s = rho²`). They are solved with the same scaled quadratic formula, free of cancellation error, that the radial-distortion validator uses. A test covers an `r6 ≠ 0` profile whose throughput is positive at both ends but dips below zero mid-field, and confirms it is rejected.

### Physical natural and mechanical vignetting (2.0)

`calculateNaturalVignetting()` offers two models of relative illumination for an aberration-free lens, based on pupil geometry:

- `cosine-fourth`: `E/E0 = cos⁴θ`, with `tan θ = h / z` for image height `h` and exit-pupil distance `z` (Greivenkamp, [OPTI-502 course notes, sec. 11](https://wp.optics.arizona.edu/jgreivenkamp/wp-content/uploads/sites/11/2019/08/502-11-Radiative-Transfer.pdf), University of Arizona, free. Also see: Slater, *Photographic Systems for Engineers*, 1980; Kingslake & Johnson, *Lens Design Fundamentals*, 2nd ed., sec. 6.5).
- `finite-lambertian-pupil`: the exact irradiance on a parallel plane from a uniform Lambertian (equally bright in all directions) disk of radius `a` (Foote 1915, *Bull. Bureau of Standards* 12:583):
  `E = (πL/2)[1 − (z² + h² − a²)/√((z² + h² + a²)² − 4a²h²)]`,
  normalised by its on-axis value `πL a²/(z² + a²)`. It approaches `cos⁴θ` for a small pupil. It is evaluated in a form free of cancellation error.

`calculateMechanicalVignetting()` models mechanical (optical) vignetting and the cat's-eye pupil shape it produces.

- Each clipping aperture is a circle referred to the entrance-pupil plane. It is shifted by `shiftPerTanFieldMm · tan θ` along the field azimuth.
- The open pupil is where the entrance pupil overlaps every shifted circle. Off axis, the ray bundle stays circular and centred on the chief ray, and each aperture passes only the part it covers (Greivenkamp, [OPTI-502 course notes, sec. 10](https://wp.optics.arizona.edu/jgreivenkamp/wp-content/uploads/sites/11/2019/08/502-10-Vignetting.pdf), free. Also see: Kingslake & Johnson sec. 6.4; Smith, *Modern Optical Engineering*, 4th ed., sec. 6.3).
- With one aperture, the overlap area is computed exactly from the circle–circle lens formula. With any number of apertures, the exact convex boundary is returned as a sampled polygon (pupil-plane mm, +X right, +Y up), with its area and centroid.
- `combinedRelativeIllumination = cos⁴θ × open-area ratio`. This assumes an object at infinity and no pupil aberration.

You can pass the polygon to `calculatePolygonPupilFraunhoferPsf()`, or use it as the `apertureMaskVerticesMm` of `createWavefrontPupilGrid()` (see [PSF foundation](PSF_FOUNDATION.md#cats-eye-pupil-and-arbitrary-polygon-diffraction-20)).

Apply at most one field-throughput model to a signal. These results replace a `calculateIlluminationVignetting()` profile or a supplied field-throughput result; they are not extra factors on top of them.

### Generic lateral chromatic aberration

Lateral chromatic aberration (CA) is the colour fringing caused by different colours being imaged at slightly different sizes. This standalone model uses the green channel as the reference mapping.

A shared base radial-distortion profile defines the lens's common geometric mapping. Red and blue offsets are added to the base coefficients before each channel is mapped:

```text
green coefficients = base
red coefficients   = base + red offset
blue coefficients  = base + blue offset
```

This keeps ordinary distortion and colour separation distinct, while letting a renderer apply the combined per-channel mapping in one pass.

The model does **not** represent CA as RGB blur on a finished image.

- Forward mapping reports each channel's field coordinates and the vector separation between channels.
- Inverse mapping reports, for one distorted destination pixel, the ideal source coordinate each channel needs.

All combined channel profiles share one physical normalisation radius and valid range, and each must stay invertible on its own.

The red, green and blue labels are just representative renderer channels. The model does not define wavelengths, sensor colour-filter responses, longitudinal CA, wavelength-dependent PSFs or calibrated real-lens colour behaviour.

### Generic radial distortion

The engine includes a standalone, rotationally symmetric approximation of radial distortion:

```text
p_distorted = p_ideal × (1 + k1 r² + k2 r⁴ + k3 r⁶)
```

`r` is the image-plane radius divided by a physical normalisation radius declared by the caller.

The declared `maximumNormalizedRadius` is part of the contract. Photivra checks the slope of the radial mapping over that range and rejects any profile that is not strictly one-to-one. This guarantees that sampling backwards, from each destination pixel to its source, is well defined and deterministic.

The model is centred on the optical axis and has no tangential (decentering) terms; for those, see Brown–Conrady below. The coefficients are generic inputs, not calibration data for a real lens.

Tests cover the validator's degenerate double-root branch. A former `q === 0` branch could never be reached and was removed; this did not change any output.

### Brown–Conrady tangential distortion (2.0)

`calculateBrownConradyDistortionMapping()` adds decentering terms `p1, p2` to the radial polynomial. It works on normalised coordinates `(x, y)` with `r² = x² + y²`:

```text
x_d = x (1 + k1 r² + k2 r⁴ + k3 r⁶) + 2 p1 x y + p2 (r² + 2x²)
y_d = y (1 + k1 r² + k2 r⁴ + k3 r⁶) + p1 (r² + 2y²) + 2 p2 x y
```

(Conrady 1919, *MNRAS* 79:384; Brown 1966, *Photogrammetric Engineering* 32:444; Brown 1971, *Photogramm. Eng.* 37:855.) The tangential part equals `r² P + 2 (P·u) u` with `P = (p2, p1)`, so `(p2, p1)` rotates with the image.

**Validity.** A profile is accepted only if all of these hold:

- the radial part is strictly monotonic over the valid range (the existing validator);
- the Jacobian determinant is positive at every point of a 64-ring × 256-azimuth polar sample of that range;
- the mapped boundary of the range is strictly star-shaped about the axis.

A smooth, locally invertible map of a closed disk that is one-to-one on its boundary is one-to-one everywhere, so the inverse has a single value. Note that these conditions are checked at the sample points, not proven between them.

`calculateInverseBrownConradyDistortionMapping()` uses damped Newton iteration, starting from the radial inverse. It requires a normalised residual of `1e-12` inside the valid range. Thin-prism and anamorphic terms are not modelled.

### Declared-scale focus breathing

Focus breathing is the change in framing as a lens focuses. The root engine offers a generic approximation of it. For one focus state:

```text
effective projection distance
  = ideal thin-lens image distance × caller-declared breathing projection scale
```

A scale of `1` reproduces the thin-lens projection exactly.

The model never infers a breathing curve. It represents focus-dependent framing only when the caller supplies the scale for that focus state. The physical focal length does not change.

This simple scale does not model principal-plane movement, pupil magnification, distortion, aberrations or any named commercial lens. Those need separate models and, for calibrated profiles, defensible provenance.

### Geometric focus breathing (2.0)

`calculateGeometricFocusBreathing()` derives breathing from a declared ideal focusing geometry, instead of from a declared scale. The photographic focus distance `L` is measured from subject to sensor. `T = L − hiatus`, where the hiatus is the separation between the principal planes (default 0).

- `unit-focus`: the whole lens moves and its focal length stays constant. `u + v = T` and `1/u + 1/v = 1/f`, so `v = 2fT / (T + √(T² − 4fT))` for `T ≥ 4f`. The field narrows as `v` grows. With zero hiatus this reproduces the focus-aware thin-lens field of view exactly.
- `fixed-image-distance-internal-focus`: an idealised internal-focus lens keeps `v = f∞` and shortens its focal length to `f' = uv/(u + v)`. The angular field does not change, and magnification is `f∞/u`.

Both models are paraxial, with the nodal points at the principal planes (Greivenkamp, OPTI-502 course notes, [sec. 3](https://wp.optics.arizona.edu/jgreivenkamp/wp-content/uploads/sites/11/2019/08/502-03-Imaging-with-a-Thin-Lens.pdf) and [sec. 5](https://wp.optics.arizona.edu/jgreivenkamp/wp-content/uploads/sites/11/2019/08/502-05-Gaussian-Imagery.pdf), free. Also see: Kingslake & Johnson, *Lens Design Fundamentals*, 2nd ed., ch. 3; Ray, *Applied Photographic Optics*, 3rd ed., ch. 9 and 14).

You can pass `equivalentBreathingProjectionScale` (exactly 1 for unit focus) to the declared-scale model, with `focusDistanceM = objectDistanceMm / 1000`. Real internal-focus lenses also move their pupils and principal planes, so real breathing still needs a calibrated profile. The declared-scale model still never infers its scale.

### Lens geometry wiring contract review (2.0)

The domain rules require an explicit contract review before a distortion or projection model is used in composed (end-to-end) science. Brown–Conrady distortion and the non-rectilinear projections are wired into two places. This section is that review.

1. **Ownership and single application.** Each path applies geometry once:
   - digital correction and warping through `prepareGeometricMapping()` (kinds `brown-conrady` and `projection-remap`, mapping schema 0.2.0);
   - physical capture through the environment `lensFieldMapping` (a scene-ray query).

   Neither adds a second distortion stage anywhere else. The POC (proof-of-concept simulation API) is unchanged.
2. **Defaults and identity.** If the options are omitted you get the previous rectilinear, radial-only behaviour, with unchanged model ids, versions and output bytes. The existing hash locks (`native-environment-bit-identity`, `poc-projection-reuse`, production plan replay) still pass. New tests show that identity mappings reproduce photo signals and RAW frames exactly.
3. **Coordinates.** Sensor points are physical (distorted) coordinates, +X right and +Y up, after the explicit native Y flip. Distortion profiles keep their declared normalisation radius and valid range. Projection scales are declared, never inferred from the lens identity.
4. **Radiometry.** Distortion changes the area of each image patch. The environment path owns that change as `1/det(d distorted/d ideal)`, applies it exactly once and reports it for each query. The scene-to-sensor bridge still adds no cos⁴ term. Field throughput is still supplied by the caller: a fisheye's natural falloff must be provided there, not inferred.
5. **Invertibility and validity.** Radial profiles keep the monotonic validator. Brown–Conrady profiles keep the sampled Jacobian and boundary validator. Projection domains (image circle, horizon, poles) fail closed, meaning out-of-domain input is rejected.
6. **Focus.** Non-rectilinear projections use the focus-aware projection distance as their mapping scale. This extends the rectilinear focus-aware projection; it is an approximation, not a calibrated model of a fisheye at finite focus.
7. **Unsupported combinations fail closed.** Ideal pupil rays and browser-native prepared sites reject a mapping. The production plan blocks a requested distortion that has no mapping, and an active distortion that was not requested.
8. **Versions.** Geometric mapping schema and model 0.2.0 are used only when a new kind is present. The environment photo-signal model is 0.4.0 only when a mapping is used. The new query model id is `lens-mapped-sensor-environment-radiance-query`. The production plan stays at 0.7.0, with a new blocker code `missing-lens-field-mapping`.

### Thin-lens focus and depth of field

The depth-of-field (DOF) model uses the exact thin-lens near and far limits, with an acceptable circle of confusion `c` supplied by the caller. With focal length `f`, f-number `N`, focus distance `s`, and hyperfocal distance `H = f²/(Nc) + f`:

- near limit `= s(H − f)/(H + s − 2f)`;
- far limit `= s(H − f)/(H − s)`. It is infinite (`null`) when `s ≥ H`.

These limits solve `f²|s − d|/(N d (s − f)) = c`. That expression is the thin-lens defocus-circle diameter used by `calculateDefocusCircle()`, so the defocus circle at either limit equals `c` exactly (thin-lens depth-of-field limits from the image-plane blur criterion: Greivenkamp, [OPTI-502 course notes, sec. 12](https://wp.optics.arizona.edu/jgreivenkamp/wp-content/uploads/sites/11/2019/08/502-12-Objectives.pdf), free. Also see: Ray, *Applied Photographic Optics*). Model `thin-lens-depth-of-field` 1.1.0 replaced the earlier approximation `Hs/(H ± (s − f))`. The old formula slightly misplaced both limits, and returned a finite far limit when focused at `H`.

The near limit is beyond the focal length only when `H − f > f`, that is, when `c < f/N` (the aperture diameter). From package 2.0.0, a circle of confusion at or above `f/N` is rejected as a domain error. Previously it returned a near limit inside the focal length.

`calculateDefocusCircle()` (model `thin-lens-defocus-circle` 1.1.0, package 2.0.0) evaluates that closed form directly, grouped as `(f/N)·(|s − d|/d)·(f/(s − f))`. The earlier evaluation, `D·|v_d − v_s|/v_d`, subtracted two nearly equal image distances. It lost relative accuracy when both planes were far away or close together. For example, with focus at 1000 km and the subject 1 m farther, its relative error was about 2e-3 compared with an exact rational evaluation. The closed form is accurate to a few ulps (units in the last place) there, and cannot overflow for finite inputs within its domain.

**The circle of confusion is a viewing choice.** It describes what blur is acceptable to a viewer; it is not a physical sensor threshold. The optional equivalent-viewing helper scales a reference criterion from the caller by the ratio of sensor diagonals. It is explicitly labelled an approximation.

In composed POC capture mode, the equivalent-viewing helper uses the final physical image region that will be enlarged to the assumed viewing size. Active capture, digital output crop and centred subject framing can therefore change the criterion; output pixel resolution alone cannot. This changes only the viewing convention, not the physical optical blur. An explicit `circleOfConfusionMm` from the caller is never rescaled.

The model is not a macro calibration model. Its DOF criterion does not include diffraction, pupil magnification, aberrations, focus breathing or lens-specific principal-plane behaviour.

### Focus-control state versus optical focus

Focus control is a camera-control state machine, not a blur algorithm.

The focus-control layer turns a target or control event into a `FocusPlane`. Downstream thin-lens, defocus and PSF calculations depend only on the resulting optical focus state (finite or infinity). They do not care whether that state came from manual focus (MF), single autofocus (AF-S), continuous autofocus (AF-C) or focus lock.

**Distance convention.** A finite autofocus target distance uses the same longitudinal (along-the-axis) camera-space distance as `FocusPlane`. Off-axis points on one flat plane facing the camera therefore resolve to the same ideal focus distance. A renderer's ray length is not an autofocus distance.

**Ideal actuator.** The first autofocus actuator is an explicitly ideal, instantaneous approximation. It gives deterministic state behaviour. It does not model motor dynamics, AF sensor error, hunting, subject-recognition quality, low-light behaviour or the performance of any branded camera.

**Modes.**

- Single AF acquires focus once and holds it.
- Continuous AF can follow time-ordered observations of one stable target.
- If the target is lost, focus holds at its last position and needs an explicit reacquisition event. The engine never silently jumps to another subject.

Focus lock freezes the optical state independently of auto exposure (AE), metering and white balance. The release-priority policy is evaluated by a separate gate and cannot change the optical focus calculation.

### Defocus circle

Defocus is computed geometrically. The model compares the sensor plane chosen for the focus distance with the ideal image plane for the subject distance. It then projects an ideal circular cone of light from the entrance pupil onto the sensor.

### Longitudinal chromatic aberration (2.0)

Longitudinal chromatic aberration is when different wavelengths come to focus at different distances. `calculateLongitudinalChromaticFocus()` returns the focal length at a given wavelength, and the signed image-plane defocus for a sensor focused on `focusDistanceM` at a reference wavelength. Two models are available:

- `thin-singlet-abbe`: an ideal thin single-element lens.
  - Dispersion uses the two-term Cauchy formula `n(λ) = A + B/λ²`, fitted exactly to `n_d` and the Abbe number `V_d = (n_d − 1)/(n_F − n_C)` (Cauchy form: Oh 2023, [arXiv:2309.09375](https://arxiv.org/abs/2309.09375), sec. 2.3.1(b); Abbe number: Greivenkamp, [OPTI-502 course notes, sec. 17](https://wp.optics.arizona.edu/jgreivenkamp/wp-content/uploads/sites/11/2019/08/502-17-Materials.pdf); f_C − f_F ≈ f_d/V_d: [sec. 20](https://wp.optics.arizona.edu/jgreivenkamp/wp-content/uploads/sites/11/2019/08/502-20-Chromatic-Effects.pdf); all free. Also see: Hecht, *Optics*, 5th ed., sec. 3.5 and 6.3; Born & Wolf sec. 2.3).
  - Focal length scales by the lensmaker relation `f(λ) = f_ref (n_ref − 1)/(n(λ) − 1)`, which gives the classical `f_C − f_F ≈ f/V`.
  - Valid as an approximation over 360–830 nm. The d, F and C wavelengths (587.5618, 486.1327, 656.2725 nm) are standard spectral-line constants (ISO 7944).
- `declared-focal-shift`: a focal-shift table declared by the caller (for example an achromat's secondary spectrum). It is linearly interpolated, re-referenced to the reference wavelength, and never extrapolated.

Defocus is the sensor distance minus the image distance. The geometric blur diameter `D|dz|/v(λ)` has the same thin-lens form as `calculateDefocusCircle()`. The result also carries the defocus wavefront `W020 = dz/(8N_w²)` and its Zernike Z4 coefficient, so a complex-pupil PSF can be evaluated per wavelength. Lateral chromatic magnification is still handled by the separate lateral-CA model.

### Polarizing front-of-lens filter (2.0)

Front-of-lens filter schema `0.2.0` adds `kind: "linear-polarizer"`. It has a principal transmittance `k1`, an extinction ratio `k1/k2` and a transmission-axis angle. `polarizationModeled` is `true` for this kind only.

Light is described by linear Stokes parameters. Filters combine in light-path order through linear-diattenuator Mueller matrices (Gil, [arXiv:2002.04105](https://arxiv.org/abs/2002.04105), eqs. 134–135; Malus's law: [OpenStax *University Physics* Vol. 3, sec. 1.7](https://openstax.org/books/university-physics-volume-3/pages/1-7-polarization); both free. Also see: Chipman, *Handbook of Optics* vol. I ch. 22, 3rd ed.; Goldstein, *Polarized Light*, 3rd ed.; Born & Wolf sec. 1.4.2):

```text
T = (k1 + k2)/2 + (k1 − k2)/2 · P · cos 2(ψ − θ)
```

Here `P` is the incident degree of linear polarization, `ψ` its angle and `θ` the filter axis. For `P = 1` this is Malus's law, `k1 cos²(ψ − θ) + k2 sin²(ψ − θ)`. For unpolarized light it is `(k1 + k2)/2`.

- Callers may declare a partially polarized `incidentPolarization`; results report the transmitted state.
- Schema `0.1.0` profiles, and compositions without a polarizer, are unchanged (same factors and composition model).
- The scene-to-sensor bridge treats scene light as unpolarized.
- Not modelled: circular polarization, retardance (the quarter-wave plate in a circular polarizer), dependence on angle of incidence, and depolarization.

### Exposure time with an ND filter

`calculateFilteredExposureTime()` (model `filtered-exposure-time` 1.0.0, #578) gives the shutter time that keeps the same exposure after front-of-lens filters are added, at the same f-number and ISO.

Focal-plane exposure is the time integral of image-plane irradiance, `H = E·t` (EMVA Standard 1288 Release 4.0 Linear, §2, free), or `H = 0.65·L·t/N²` for a scene of luminance `L` ([CIPA DC-004-2020](https://www.cipa.jp/e/std/std-sec.html) §5.5 (4), free). A filter of intensity transmittance `T` in front of the lens scales `E` by `T`, so the same `H` needs:

```text
t_filtered = t / T = t · 2^stops,   stops = −log2 T = OD / log10 2
```

| Quantity | Exact or approximated |
| --- | --- |
| `t / T` for a given `T` | Exact under the linear sensor model: collected charge is proportional to `H` (EMVA 1288 linear model). Film reciprocity failure is not modelled. |
| `T` | As good as the filter profile, from `composeFrontOfLensFilterTransmission()`. Nominal ratings are approximate: a "10-stop" filter means `T = 2^-10` (1/125 s → 1024/125 ≈ 8.19 s), an ND1000 means OD 3.0, 9.97 stops (1/125 s → 8 s). The result envelope is an approximation whenever any profile is. |
| Nearest dial value | Exact selection: the dial value nearest in stops, the shorter on a tie (the policy `nearest-log2-shorter-on-tie` of the exposure-mode resolver). Its `exposureErrorStops = log2(dial / t_filtered)`. Outside the dial the nearest end is reported with `clamped`. |

**Generic presets.** `GENERIC_ND_FILTER_PROFILES` holds idealized 3-, 6- and 10-stop filters. By definition (owner decision 2026-11-09) an N-stop filter transmits exactly `T = 2^-N`: 1/8, 1/64 and 1/1024, so 1/125 s with the 10-stop preset gives exactly 8.192 s (8 s on the third-stop dial). They are spectrally flat (`neutral-linear-transmission`) over 380–780 nm in air, unbranded, and marked `scientificStatus: "approximation"` with unquantified uncertainty, because real filters deviate from their rating and are not perfectly flat.

Filters are resolved at 550 nm unless the caller gives a wavelength; neutral filters do not depend on it. Not modelled: inter-filter reflections, flare, and light leaking around the filter or in through the viewfinder.

### Atmospheric haze (2.0)

`calculateAtmosphericHaze()` changes scene radiance along one uniform line of sight using Koschmieder's model (Koschmieder 1924; Middleton, *Vision Through the Atmosphere*, 1952; McCartney, *Optics of the Atmosphere*, 1976):

```text
L = L0 · t + L_air · (1 − t),   t = exp(−β(λ) d)
β(λ) = β_R,ref (λ/λ_ref)^−4 + β_A,ref (λ/λ_ref)^−α
```

- `L0` is the original radiance, `L_air` the airlight radiance, `t` the transmittance over distance `d`, and `β` the extinction coefficient.
- The Rayleigh (molecular scattering) term has exponent 4 by default; 3.5–4.5 is accepted (Bucholtz 1995, *Appl. Opt.* 34:2765).
- The Ångström term models aerosols (Ångström 1929, *Geogr. Ann.* 11:156).
- Reference coefficients and the airlight radiance are inputs from the caller; none are built in.

`calculateExtinctionFromVisibility()` uses `β = −ln ε / V`, with ε = 0.02 (Koschmieder) or 0.05 (WMO meteorological optical range).

Not modelled: sky gradients, the angular structure of multiple scattering, absorption bands and slanted paths.

### Real-lens sampled PSF and complex-pupil propagation

This framework adds explicit representations of the combined PSF of the main optics. It does not redefine the existing geometric-defocus or circular-Airy diagnostics.

**Sampled PSF.** A sampled PSF is a full 2D intensity distribution with unit total energy, in metric image-plane coordinates. It can be interpolated on a regular grid across focal length, focus state, aperture, field X/Y, wavelength and signed image-plane defocus. The engine never extrapolates outside the profile's declared support.

Field curvature and longitudinal chromatic focus are represented as best-focus image-plane offsets that depend on field position and wavelength. They do not change the distortion or lateral-CA coordinates.

**Complex pupil.** A complex pupil stores relative amplitude plus optical path difference (OPD). The reference evaluator uses scalar Fraunhofer propagation:

`PSF ∝ |FT{ A(x,y) exp(i 2π OPD(x,y)/λ) }|²`

The sampled intensity is then normalised to unit energy. Diffraction and aberration are therefore evaluated together in this path, instead of being applied as two unrelated blur kernels.

**Throughput is separate.** Mechanical pupil clipping can appear in the pupil amplitude and the PSF shape. Relative pupil throughput, however, is always a separate explicit factor. This stops the normalised PSF from absorbing throughput that a later throughput stage would apply again.

**MTF is diagnostic only.** MTF (modulation transfer function) magnitude cannot determine a unique PSF, because it carries no phase. Photivra accepts MTF magnitude as diagnostic or validation data, but never reconstructs a PSF from it.

The lens PSF comes before the sensor's optical stack, sensor sampling and reconstruction. Stray light is also separate: ghosts and veiling glare are not ordinary primary-image PSF blur.

### PSF/pupil foundation

The PSF/pupil foundation evaluates the existing geometric-defocus and circular-diffraction diagnostics in one explicit context, while keeping their numbers separate.

The context declares:

- the physical field position on the image plane;
- a field normalisation radius, used only for comparison;
- focus distance and subject depth;
- a single wavelength;
- an ideal circular pupil sized from the f-number.

This foundation does **not** compute a combined PSF or MTF. The defocus-circle diameter and the Airy first-zero diameter are never added together or merged into one sharpness value.

The dedicated ideal-polygon API evaluates on-axis diffraction for non-circular apertures. The real-lens framework owns explicitly profiled pupil clipping, field curvature, aberration and bokeh. The legacy diagnostic calculator never silently combines any of these. See [PSF and Pupil Foundation](PSF_FOUNDATION.md).

Illumination vignetting is not in the PSF contribution list, because it is currently modelled as throughput only.

### Diffraction

For an ideal circular aperture, the diameter of the Airy disk to its first dark ring is:

`d = 2.44 λ N`

where `λ` is the wavelength and `N` is the f-number. The factor is 2·j₁,₁/π, where j₁,₁ = 3.8317 is the first zero of J₁ (Wyant & Creath, *Applied Optics and Optical Engineering* XI, ch. 1, 1992, §II, [free author copy](https://wp.optics.arizona.edu/jcwyant/wp-content/uploads/sites/13/2016/08/03-BasicAberrations_and_Optical_Testing.pdf); Born & Wolf, *Principles of Optics*, 7th ed., 1999, §8.5.2).

This is a diagnostic for one wavelength and an ideal circular pupil.

It is kept apart from the regular-polygon aperture geometry used for bokeh and sunstars. Supplying a blade count does not turn the circular Airy result into a polygon-aperture diffraction PSF. For the ideal on-axis polygon model, use `calculateIdealPolygonDiffractionPsf()` with an explicit physical equal-area pupil, propagation distance and wavelength. Arbitrary real diaphragms are outside that model.

### Ideal diaphragm geometry and sunstar symmetry

For a regular diaphragm with straight blades, the engine computes the normalised polygon vertices. It also computes the ideal directions of the sunstar spikes, which run perpendicular to the blade edges.

- **Even blade count:** opposite edges are parallel, so their spikes overlap. You get as many spike directions as blades.
- **Odd blade count:** no edges are parallel, so you get twice as many spike directions as blades.

This is a geometry and orientation model only. It does not compute diffraction intensity, wavelength-dependent spike length, blade curvature, coatings, internal reflections, lens aberrations, sensor blooming or a complete PSF.

### Controlled camera shake

Yaw and pitch angular velocities are integrated over the shutter duration. The angular displacement is projected onto the image plane using the selected projection distance d:

- Δx = +d·tan(yaw·t)
- Δy = −d·tan(pitch·t)

Signs follow the right-hand rule about camera +Y and +X: positive yaw turns the camera left, and positive pitch tilts it up. This is the same convention as `calculateCameraRotationImageMapping()`.

This model returns one global image-plane vector. It does not compute the spatially varying optical flow that real camera rotation produces away from the optical axis.

Equivalent stabilisation stops reduce the angular displacement by a factor of `2^-stops`. This is explicitly an educational approximation, not a real model of in-body (IBIS) or optical (OIS) stabilisation, or of CIPA test performance.

### Sensor stochastic readout and RAW boundary

The sensor model keeps three things separate: deterministic expected values, random (stochastic) realisations, and digital encoding.

**Expected values.** Expected photo charge, dark charge and additional stored charge stay upstream scientific quantities. A seeded realisation can sample Poisson statistics for photo and dark charge, plus explicitly declared statistics for additional components. It never modifies the expectation APIs.

**Read noise.** Electronic read noise is a later, input-referred random contribution. It stays separate from photon and dark shot noise. Several declared RMS read-noise components are sampled independently. Their metadata is not merged into a claim about which physical circuit causes them, unless evidence supports that.

**Three saturation limits.** The electronic chain keeps these separate:

1. the physical charge-storage capacity;
2. saturation in electron-equivalent units before the ADC (analog-to-digital converter);
3. saturation of the ADC's digital codes.

Clamping at the physical capacity is not a blooming model. Blooming needs spatial charge transfer between neighbours, and anti-blooming behaviour.

**Conversion gain** is expressed in electrons per digital code, for one explicitly selected operating regime. The engine does not infer that regime from ISO, the CMOS/CCD family, capture-mode labels or product tier.

**RAW coordinates.** RAW codes keep absolute native sensor and CFA (colour filter array) coordinates. Capture orientation and final output rotation do not rotate the sensor mosaic or change its phase.

**Reconstruction.** The first reconstruction model is an explicit linear transform over native neighbourhoods. It is tied to an exact capture mode and CFA identity. It does not claim that a CFA name determines a demosaic algorithm. It also does not claim to model moiré or aliasing, unless an adequate model of optical and scene spatial frequencies before sampling exists.

### ISO/exposure-index and sensor-readout boundary

ISO (exposure index) is a camera control and reporting setting. It is not a source of photons.

With fixed scene radiance, aperture, shutter duration, optical transmission and sensor collection geometry, changing ISO does not change how many photons arrived during the exposure. So the ISO layer never changes the expected photon or photoelectron counts, or photon shot-noise statistics, just because a different ISO was selected.

The ISO capability contract distinguishes:

- standard exposure-index settings;
- expanded low and high reported settings;
- Auto ISO eligibility and ranges;
- optional restrictions by capture mode.

It does not infer physical gain, conversion gain, read noise or saturation from those numbers.

When generic high-ISO behaviour is needed, the ISO layer maps an explicit ISO and capture-mode state to an explicit sensor readout regime. The selected regime, not the ISO number, holds the declared conversion gain, electronic read noise and downstream saturation and ADC behaviour. This keeps piecewise and dual- or multi-gain behaviour representable, instead of smoothing it into one universal ISO-to-noise curve.

Good/Better/Best labels are convenience names for complete signal-chain profiles. They are not sensor equations, and they do not rank real cameras. Sensor size and resolution, photon shot noise, denoising and sharpening of the processed image, and technology-family labels such as CMOS/CCD are all separate domains.

### Radiometry readiness boundary

Absolute scene luminance, or relative exposure, is not enough on its own to derive a defensible photon count.

Before a composed photon simulation, Photivra requires an explicit package of prerequisites covering:

- scene spectral radiance, or a documented spectral approximation;
- optical transmission;
- pupil and vignetting behaviour;
- what the photosite collection area means;
- exposure integration;
- sensor spectral response / quantum efficiency (QE);
- evidence, uncertainty and limitation metadata for each component.

`assessRadiometryReadiness()` classifies a declared package as `not-ready`, `approximate-only` or `calibrated-ready`. It checks the structure of the declared models and evidence. It does not prove the calibration is scientifically correct, and it does not calculate photons.

Geometric sample pitch is deliberately not accepted as a collection-area model. A profile must provide either an effective collection area, or a geometric cell area plus an explicit fill factor.

Approximate inputs stay approximate even when every category is present. A `calibrated-ready` result needs calibrated components with quantified uncertainty.

The composed POC still produces no photon, photoelectron or SNR output from scene settings. The low-level `calculatePhotoelectrons()` is a separate primitive for callers who already have a defensible incident-photon count and QE.

## Image-formation domain boundary

Future optical and sensor models must follow `getImageFormationContract()`.

The contract deliberately does not describe image formation as a chain of independent post-processing steps. Some quantities are coupled:

- focus-dependent projection and lens mapping;
- wavelength-dependent field mapping and PSF basis;
- pupil clipping, throughput, and bokeh/PSF shape;
- time-varying scene and camera mapping, and the sensor readout schedule;
- native sensor sampling and reconstruction.

The existing analytical primitives stay valid and keep their names. Adding a broader stage must not silently reinterpret existing focal length, defocus, diffraction, motion, crop or sensor-sampling outputs.

The static ordering contract keeps broad foundation and reserved metadata. Those labels alone do not mean a stage runs. Production plan 0.7.0 separately records which bounded environment-route stages actually run: sampling, photons, charge, ADC and reconstruction. Broader unsupported models stay blocked.

## Source provenance

These implementations were written independently from established mathematical and physical relations. These scientific modules contain no third-party source code, calibration datasets, tables or model weights.

Public technical references may be used to understand or validate concepts. Their code, protected prose, tables, figures and restricted measurement data are not copied unless separately licensed for that use. See [Scientific and Source Provenance](PROVENANCE.md).

## Scope

These models produce numerical indicators, not a universal "sharpness score". Sampling, defocus, diffraction, subject motion and camera shake are different physical effects. Do not add them together without a justified image-formation model.

Rendering and analysis clients should use the validated numerical outputs, rather than quietly introducing their own conflicting camera science.
