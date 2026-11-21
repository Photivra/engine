# Camera Shake and Stabilization

> **Release context.** This page was written for package 1.2.0 (root API 1.2.0) and has not been re-reviewed for later releases. The [changelog](../CHANGELOG.md) describes the current release. Model and subsystem version numbers on this page, and any dated records, are separate from the package version. See also the [developer guide](DEVELOPERS.md) and the [1.2.0 release contract](RELEASE_1_2_0.md).

Photivra has two separate things here:

- exact, deterministic geometry for projecting camera shake onto the image; and
- a deliberately simplified, educational model of image stabilisation.

There is also a separate time-based model of physical stabilisation (IBIS/OIS), described below.

## Controlled camera shake

`estimateCameraShakeBlur()` takes a constant camera angular velocity about two axes:

- yaw, in radians per second;
- pitch, in radians per second.

For a shutter-open time `t`, each angular displacement is:

`theta = angularVelocity * t`

Its component on the image plane is:

`d = v * tan(theta)`

where `v` is the projection distance in millimetres. There are two projection modes:

- **Without `focusDistanceM`:** `v` is the nominal focal length (the infinity-focus approximation, kept for compatibility).
- **With `focusDistanceM`:** `v` is the ideal Gaussian thin-lens image distance for the chosen focus plane.

If you supply pixel pitch, the same displacement is also reported in sensor pixels.

**Coordinates.** The returned X/Y components are in the function's own sensor/image-plane axes. `estimateCameraShakeBlur()` does not accept `CaptureOrientation`, and does not rotate its vector into portrait or other oriented output coordinates. If you combine it with the capture-orientation layer, transform the vector explicitly with the orientation helpers.

The shake profile you supply is synthetic input. The model makes no empirical claim about how much any particular photographer shakes.

`estimateAutoIsoSlowestShutter()` (#504) solves this model backwards: the exposure time at which the stabilized blur equals a blur budget, for Auto ISO's automatic slowest shutter. Its generic hand-shake default, `GENERIC_HANDHELD_ANGULAR_VELOCITY_RAD_PER_SEC`, is a cited, labelled value (4.39 °/s for a 100 g phone held in two hands, Xiao et al., Proc. SPIE 7250, 2009), not a claim about any particular photographer. See [Automatic slowest shutter](USAGE.md#automatic-slowest-shutter-504).

### Spatial limitation and the separate rotation primitive

`estimateCameraShakeBlur()` deliberately stays as one global yaw/pitch vector on the image plane. This keeps it backwards compatible with the existing stabilisation-stops teaching model.

The engine separately provides `calculateCameraRotationImageMapping()`. It models **pure camera rotation** (yaw, pitch and roll) at any physical time from the start of exposure, and its result depends on field position.

**Shared sign convention (from 2.0.0).** Both APIs use the physical right-hand rule for pitch/yaw/roll about camera +X/+Y/+Z (a left-handed basis).

- Positive yaw turns the camera left and moves image content toward +X.
- Positive pitch tilts the camera up and moves image content toward −Y.
- For a single axis, at the optical axis, `estimateCameraShakeBlur()` returns the rotation mapping's `deltaMm`, equal within floating-point rounding. (The two evaluate the same tangent with different operation orders.)
- `estimateCameraShakeBlur()` rejects a rotation on any axis of a quarter turn (π/2 rad) or more during the exposure, where the tangent would change sign. The rotation mapping rejects only a field point whose rotated ray lands on or behind the camera plane (z ≤ 0): it accepts a larger angle for a point that stays in front, and a full turn plus a small angle gives the small angle's mapping, which is right for an instantaneous mapping.

See [Motion and signal](MOTION_AND_SIGNAL.md#spatial-camera-rotation).

**Where they differ.** Away from the optical axis, and for combined axes, the results differ. The shake estimator is one global vector with separate tangents per axis. The spatial primitive maps each field point through one axis-angle rotation. Do not substitute one result for the other without an explicit migration.

The spatial primitive does not apply stabilisation stops. The separate time-domain system below provides generic synthetic rotational correction for in-body (IBIS), optical (OIS) and coordinated stabilisation. Translation and parallax, and ray-geometry effects specific to a mechanism, are separate.

## Time-domain physical stabilization system

This is a separate, versioned model of physical stabilisation for rotational disturbance that changes over time (issue #97).

It does **not** replace or reinterpret the legacy `estimateCameraShakeBlur()` API.

### Disturbance trajectory

`parseStabilizationDisturbanceTrajectory()` describes how the camera rotates over time. It uses the same capture reference clock as the exposure-window model:

`first-opening-boundary-phase`

The first schema requires:

- a sample with zero displacement at `t = 0`;
- sample times in strictly increasing order;
- explicit pitch/yaw/roll displacement in radians;
- no subject motion mixed in;
- no camera translation mixed in;
- no support or tripod state mixed in.

This keeps the design clean:

```text
physical disturbance -> stabilization response -> residual rotation -> exposure-time image formation
```

A stable support is simply an explicit zero disturbance trajectory. It does not automatically switch stabilisation on or off.

### Generic physical architectures

`parseStabilizationSystemProfile()` supports these generic synthetic architectures:

- `off`;
- `sensor-shift`;
- `lens-optical`;
- `coordinated-physical`.

Schema 0.1.0 deliberately makes no claim about any brand's camera or lens.

Each corrected axis can declare:

- a correction gain from 0 to 1;
- a response latency in seconds;
- a maximum angular correction, in radians, as an image-equivalent angle.

The first dynamic response is:

```text
requested correction(t)
  = gain × disturbance(t - latency)

applied correction
  = symmetric clamp(requested correction, angular limit)

residual
  = current disturbance(t) - applied correction
```

Until the latency has passed, the delayed measurement is zero.

This is an explicit generic approximation. It is not a conversion of CIPA stop ratings, an identification of a real control loop, or a calibration of a commercial IBIS/OIS system.

### Coordinated body + lens behavior

A `coordinated-physical` profile includes explicit body and lens allocation fractions that sum to one.

Those fractions split **one total correction** between body and lens. The engine does not apply a body correction and a lens correction independently and then add them. This stops coordinated stabilisation from counting the correction twice.

### Panning

The model never infers that you are panning.

A profile can explicitly use:

`declared-axis-bypass`

for one of the pitch/yaw/roll axes. Correction on that axis is then switched off, while the other declared axes keep the selected response.

### Correction limits

Angular travel (range) limits are explicit.

If the requested correction exceeds an axis's limit, the applied correction is clamped, and the result reports `correctionLimitReached: true`.

A high gain never produces unlimited correction.

### Capture-time sampling

`calculateStabilizedCaptureTemporalSamples()` evaluates stabilisation at fixed midpoint times inside each committed local exposure window.

This matters especially for rolling or local exposure timing: two positions on the sensor can evaluate the same disturbance and stabiliser at different capture times.

Sensor **data-readout timing is not used as exposure timing**.

At each time sample the result reports the disturbance, the applied correction and the residual rotation. It does not itself calculate:

- image-plane mapping;
- radiance;
- blur kernels;
- PSF (point-spread function);
- final pixels.

Those are later image-formation steps.

### Explicit boundaries

The first time-domain model does not include:

- correction of camera translation or parallax;
- where the shifted sensor sits within the lens's image circle;
- changes to ray geometry from moving an OIS lens group;
- spontaneous stabiliser drift;
- settling or recentring behaviour beyond the declared latency;
- inferred panning;
- automatic tripod or support detection;
- generation of shutter shock, wind or floor vibration;
- digital (electronic) stabilisation.

Digital stabilisation is later geometric warp, crop and resampling work. It must keep its field-of-view and crop consequences, rather than being represented as physical residual camera motion.

## Ideal stable support boundary

Photivra's **ideal stable support** is an explicit zero-disturbance boundary condition. It is not a separate blur equation, and it does not claim that real tripods are vibration-free.

To represent it, supply:

```ts
angularVelocityRadPerSec: {
  yaw: 0,
  pitch: 0
}
```

With this explicit input:

- unstabilised shake displacement is exactly zero;
- stabilised shake displacement is also exactly zero, for any `stabilizationStopsEquivalent`;
- focal length, shutter duration, finite-focus projection, infinity (pinhole) projection and pixel pitch create no motion from a zero-motion input;
- subject motion stays independent;
- physical orientation and output transforms keep the vector at zero.

Do **not** represent stable support with a huge stabilisation-stop value. Stabilisation reduces the camera motion you supply; it is not how you express a stable support.

This boundary also does not quietly remove disturbances that are not modelled yet, including shutter shock, the impulse from pressing the release button, wind, floor or ground vibration, flex or resonance in the support, or future tripod dynamics. Those effects must come in through their own explicit motion or support models.

Omitting the camera-shake input is different from supplying zero motion. Omitting it means the input was not supplied. Supplying zero motion explicitly states the modelled stable-support boundary.

Real-camera advice about whether to turn IBIS/OIS on when using a tripod depends on the equipment and mode, and is separate from this generic boundary.

## Equivalent stabilization stops

The model accepts `stabilizationStopsEquivalent`.

For educational exploration, the supplied angular displacement is reduced by:

`residualMotionFactor = 2 ^ (-stops)`

For example, 3 equivalent stops gives a residual factor of 1/8 for the controlled synthetic shake profile.

This reduction is an **approximation**. It is useful for showing what reducing camera motion does. It is not a model of any particular IBIS/OIS implementation, and it does not mean a real stabiliser reduces every motion path by exactly that factor.

Because the result combines this assumption with the geometric projection, the calculation record uses `provenance.kind = "approximation"`.

## CIPA reference

CIPA publishes **DC-011-2024** for measuring and describing image-stabilisation performance.

Photivra is not affiliated with, sponsored by, endorsed by or certified by CIPA, and does not claim to comply with its standard. The educational approximation does not implement the CIPA test method.

Reference:

- CIPA DC-011-2024 overview: https://www.cipa.jp/e/std/image-stabilization.html

Only the public standard identifier and high-level terminology are referenced here. CIPA logos and protected standard content are not included in this project.

## Not yet modeled

The legacy stabilisation-stops model deliberately stays limited to its original teaching purpose. The separate time-domain system adds, without changing legacy results:

- rotational correction over time, including roll;
- latency;
- per-axis limits;
- explicit panning-axis bypass;
- body/lens coordination;
- sampling within each local exposure window.

Still outside the current stabilisation models:

- correction of translational camera shake;
- calibration of frequency-domain control loops;
- empirical motion data for specific photographers;
- generation of shutter-button impulses;
- realistic tripod and support mechanics;
- focal-length-dependent calibration of real equipment;
- IBIS/OIS ray geometry specific to a mechanism;
- automatic pan detection;
- crop and warp behaviour of digital stabilisation.

These should stay as separate, documented models, rather than being quietly folded into either stabilisation API.
