# Sensor profiles (#554)

`simulateCapture({ sensor: { profile: <record> } })` (and `simulateDisplayView`) simulates a sensor profile: one of the
eight representative profiles in `SENSOR_PROFILES`, whose values come from published specifications, or a caller's
modified copy of one. The profiles are named by format, resolution, architecture
and era. They name no camera maker or product, and their market tag ("consumer", "professional") is a label only: a
profile's values decide how it behaves.

This catalogue is separate from the generic tier presets ([GENERIC_TIER_PRESETS.md](GENERIC_TIER_PRESETS.md)), whose
sensor numbers stay synthetic and unchanged. The owner approved the policy change for this catalogue only (2026-11-06):
values may come from manufacturer-published specifications, standards and openly published papers, with no
copyrighted or licence-restricted data. **The owner reviewed and approved the sources listed below on 2026-11-09**,
including the astronomy-camera manuals (for sensor values only) and the retailer copy of one maker specification.

```ts
import { simulateCapture, SENSOR_PROFILES, resolveSensorProfile } from "@photivra/engine";

const r = await simulateCapture({ scene: { preset: "uniform" }, sensor: { profile: resolveSensorProfile("full-frame-24mp-bsi-2020s") },
  exposure: { mode: "manual", iso: 3200, shutterSeconds: 1 / 4000 } });
r.sensor.dynamicRangeStops; r.sensor.midGrey.snr;
SENSOR_PROFILES.map((p) => p.name);
```

## What a profile sets

A profile replaces the camera body's sensor assets: the ISO range and settings, the readout regimes (full well, the
read noise of each conversion gain, the dual-gain switch ISO, the high gain's charge storage, the ADC bit depth and
black level), the readout time (the rolling-shutter skew with `motion.shutter: "rolling"`) and the fixed-pattern noise
used with `sensor.fixedPatternNoise: true`. It also sets the default pixel pitch and peak QE. The body's other
capabilities (shutter range, release, focus, stabilization, metering, white balance) and the lens are kept.

The sensor characteristics of #555 still override a profile one at a time ([quick start](QUICK_START.md#sensor-characteristics-555)):
for example `{ profile: resolveSensorProfile("aps-c-26mp-bsi-2020s"), readNoise: { lowGainElectrons: 2 } }`. A pitch other than the
profile's scales its full well with the pixel area, the rule the tiers use from 6 µm. The capture records the
profile's values in the assumption `sensor.profile`.

**The record, not an id** (owner, 2026-11-09). The capture takes the record itself and never imports the catalogue, so an
application's capture worker does not bundle the profile data: the application imports `SENSOR_PROFILES` where it needs
them (for example its main thread) and passes the chosen record. The capture checks the record strictly
(`SensorProfile`): every field present and no other, each number in range (for example QE 0.05–0.9, full well
100–1e10 e⁻, pitch 0.5–100 µm, readout 1 µs–1 s), base, maximum and switch ISO on the third-stop markings from ISO 32 to
102 400, base ISO no higher than the maximum, and a dual-gain switch above base ISO with a high-gain storage no larger
than the full well (without a switch, equal read noises and no storage). The engine's readout and fixed-pattern parsers
check the built body again. A modified copy keeps the ISO rule's report: its `sensitivityOffsetStops` is the distance
from its own S0. The parser and body builder are loaded on demand (a lazy chunk), and a request without `sensor.profile`
is byte-identical to one before #554.

Not modelled (owner, 2026-11-06): colour-response differences between sensors (one idealized response, scaled by the
peak QE, stays for every profile, so the QE curve's shape for BSI versus front-illuminated sensors is described, not
simulated), thermal behaviour, burst rate, video and autofocus. The phone profile is simulated as a single frame
(multi-frame stacking is not applied).

**The phone profile's lenses.** Its `fixedLenses` is `"phone"`: it takes only the catalogue's three phone lenses
(PV 13 2.2 Phone, PV 24 1.8 Phone, PV 77 2.8 Phone; [LENS_CATALOGUE.md](LENS_CATALOGUE.md#phone-lenses-554)), and they render
only on such a profile. The profile keeps accepting the body's default lens (owner, 2026-11-09).

## Catalogue lenses on a profile's sensor

With a sensor profile, a catalogue lens (`lens.catalogue`, the phone lenses included) is framed on the profile's real
sensor (owner, 2026-11-09), so it shows its real field of view: the lens is resolved on the whole sensor
(`sensorWidthMm × sensorHeightMm`), which gives its focal length (equivalent ÷ the sensor's diagonal crop factor) and the
half-diagonal its distortion, vignetting and lateral colour are normalised to. The capture is then a centred frame of it:

- **Default pitch:** the largest centred region of the sensor with the output's aspect, pitch = min(W/w, H/h) for a
  W × H mm sensor and a w × h output. The other axis is cropped, never stretched: a 16:9 output on a 3:2 sensor crops
  the height; a square one crops the width. The assumption `sensor.profileView` reports the frame, the pitch and
  `croppedSensorAxis` ("width", "height" or "none").
- **An explicit `sensor.pixelPitchMicrometers`** gives the centred crop it implies (for example the profile's own pitch, a
  100 % crop); a frame larger than the sensor is refused.
- **A downsized view.** At a pitch above the profile's, each site stands for N = (pitch / photosite pitch)² photosites: their
  charge adds (the full well scales with the area, as before) and their read noise adds in quadrature (×√N, also for explicit
  `readNoise` values, which are per photosite). Below one photosite the read noise is kept. Dark current and ADC
  quantization stay per site, an approximation, and `sensor.fixedPatternNoise` (a per-photosite pattern) is refused at a pitch
  other than the profile's. The same √N rule applies to a profile with an explicit pitch and no catalogue lens, reported in
  the same assumption.
- **The same in every path.** The exact and fast catalogue methods and the display view read the same frame, lens and
  readout. `lens.prime` and `lens.ideal` keep the simulated-frame rule (output × pitch); a capture without a profile is
  byte-identical.

## ISO rating

Each profile's base ISO is re-rated from its own full well FW, green peak QE η and pixel area A:

S0 = 100 · (η / 0.5) · (A / 36 µm²) · (60 000 e⁻ / FW), rounded to the nearest third-stop marking.

This is the engine's existing ISO 100 anchor, the Professional tier (60 000 e⁻ at the RAW white, 6 µm pixels, QE 0.5):
the RAW white at base ISO is the full well, and the same ISO reaches the white at the same focal-plane exposure on every
profile and tier with that anchor, so S = 10/H (CIPA DC-004-2020 §3.2) means the same on all of them. The rounding leaves
at most 1/6 stop, reported as `sensitivityOffsetStops` in the `sensor.profile` assumption (−0.12 to +0.06 stops). The
anchor agrees within 2 % with the saturation-based speed S = 78/H_sat of ISO 12232:2019: an 18 % grey patch at standard
exposure gives 7 842 e⁻ on the Professional tier ([quick start](QUICK_START.md#sensor-characteristics-555)), and
7 842 × 7.8 = 61 168 e⁻. The owner chose this re-rating over keeping a maker's published base ISO (2026-11-09). A profile whose range starts above ISO 100 defaults to its base ISO, and its exposure
reference takes the same N²/(t·S) at that ISO.

The high conversion gain's charge storage is the white charge at the switch ISO, FW × S0 / S_switch (a design value): the
engine's ISO gain builder refuses any regime that would need more, so a capture at or above the switch never exceeds it.

## The profiles

Kinds: **P** published (source key below), **D** derived from published values, **X** a design value inside the range the
sources support. Figures under "Calculated" are the engine's model figures (#555): the engineering dynamic range at base
ISO and at ISO 3200, and the mid-grey SNR at ISO 3200 with 1/32 of the default light (the Professional tier gives 14.7 and
10.7 stops and an SNR of 15.1).

| Profile id | Name | Tag | Pixels, pitch | Sensor, mm | QE | Full well, e⁻ | Read noise LCG / HCG, e⁻ (switch) | ADC | ISO | Readout | Calculated |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `full-frame-24mp-bsi-2020s` | Full frame 24 MP BSI, 2020s | consumer | 6072 × 4042 P, 5.94 µm P | 36.07 × 24.01 D | 0.80 P | 100 000 P | 6.4 / 1.1 P (ISO 500 D) | 14 P | 100 D – 51 200 X | 50 ms X | 13.9 / 11.5 stops, SNR 18.9 |
| `full-frame-45mp-stacked-2020s` | Full frame 45 MP stacked, 2020s | professional | 8256 × 5504 X, 4.36 µm D | 36 × 24 X | 0.80 X | 69 000 X | 3.5 / 1.5 X (ISO 250 X) | 14 X | 80 D – 25 600 X | 5 ms X | 14.2 / 10.2, SNR 13.8 |
| `full-frame-24mp-stacked-sports-2020s` | Full frame 24 MP stacked (sports), 2020s | professional | 6000 × 4000 X, 6.0 µm D | 36 × 24 X | 0.80 X | 80 000 X | 3.0 / 1.0 X (ISO 400 X) | 14 X | 125 D – 102 400 X | 2.5 ms X | 14.5 / 11.6, SNR 19.1 |
| `full-frame-24mp-fsi-2010s` | Full frame 24 MP front-illuminated, 2010s | professional | 6032 × 4032 P, 5.97 µm P | 36.01 × 24.07 D | 0.53 P | 76 000 P | 4.0 X, one gain | 14 P | 80 D – 25 600 X | 80 ms X | 14.1 / 8.9, SNR 15.0 |
| `aps-c-24mp-fsi-2020s` | APS-C 24 MP front-illuminated, 2020s | consumer | 6024 × 4024 P, 3.91 µm P | 23.55 × 15.73 D | 0.55 X | 36 000 P | 2.7 P, one gain | 14 P | 80 D – 25 600 X | 60 ms X | 13.7 / 8.4, SNR 10.0 |
| `aps-c-26mp-bsi-2020s` | APS-C 26 MP BSI, 2020s | professional | 6248 × 4176 P, 3.76 µm P | 23.49 × 15.70 D | 0.80 P | 50 000 P | 3.3 / 1.0 P (ISO 250 X) | 14 X | 80 D – 25 600 X | 25 ms X | 13.8 / 10.3, SNR 12.0 |
| `medium-format-100mp-bsi-16bit` | Medium format 100 MP BSI, 16-bit | professional | 11656 × 8750 P, 3.76 µm P | 43.856 × 32.9 P | 0.80 X | 50 300 P | 3.3 / 1.0 P (ISO 250 D) | 16 P | 80 D – 12 800 X | 250 ms X | 13.9 / 10.3, SNR 12.0 |
| `phone-50mp-stacked` | Phone, large, 50 MP stacked | consumer | 8192 × 6144 P, 1.197 µm P | 9.844 × 7.431 P | 0.75 X | 8 600 X | 3.0 X / 1.4 P (ISO 160 X) | 12 P | 40 D – 6 400 X | 33.3 ms D | 11.5 / 6.3, SNR 3.5 |

Each profile also records, in `provenance`, every value's kind and source key, and in `goodFor` and `description` what
it suits (landscape, sports, wildlife, portrait, studio, journalism and so on). Fixed-pattern magnitudes (PRNU, DSNU,
hot pixels, row and column offsets) are design values: the Professional tier's synthetic magnitudes for the BSI and
stacked profiles, the Prosumer tier's for the front-illuminated ones, and for the phone profile PRNU 0.8 % and row and
column offsets 0.2 e⁻ from S10. The analog gain reaches 64× base ISO (a design value); above it the gain is digital.

What the table shows: the modern consumer full-frame BSI sensor beats the older professional front-illuminated one at
high ISO (11.5 against 8.9 stops at ISO 3200), mostly through its higher QE and its low high-gain read noise; the APS-C BSI
profile reads out faster than the consumer full frame (25 against 50 ms); the medium-format 16-bit sensor's dynamic range
at base ISO is set by its full well and read noise, not by its bit depth; and the phone's small full well gives the least
dynamic range and the lowest SNR at the same exposure.

### Derivations

- **Gain setting to ISO** (the switch ISOs marked D). The makers' manuals give the high-conversion-gain switch as a gain
  setting in 0.1 dB above their lowest gain, at which the full well fills the ADC (S1: unity gain 158, so
  10^(15.8/20) = 6.17 e⁻ per code × 16 383 codes = 101 ke⁻, the published 100 ke⁻). Taking that lowest gain as base ISO,
  gain g is S0 · 10^(g/200): 140 → 5.01 × S0, 100 → 3.16 × S0, rounded to a third-stop marking. An approximation.
- **Dimensions** (D): pixels × pitch. Where the maker publishes an image area (the medium-format and phone profiles) it
  is used; the phone's published height is 1.0 % more than its active pixels × pitch.
- **Scaled full well** (X, from a source): FW_ref × (pitch / pitch_ref)², the rule #555 uses for its default.
- **Phone readout** (D): at most 1 / the full-resolution frame rate (30 fps, S9), used as the value. The astronomy
  cameras' frame rates are limited by their interfaces, so they are not used for readout; those readouts are design values.
- **QE** is the green channel's peak, part A's `peakQuantumEfficiency`; a maker's colour-camera "QE peak" is used for it.

## Sources

Every published value comes from one of these free documents. The documents (and so their titles and links) name
products; the engine's data, API and names do not, and this page is the only place the links appear (owner, 2026-11-09). Camera makers do not publish full
well or read noise; the photon-transfer databases and test websites that do are excluded by the sourcing rules and were
not used.

| Key | Source (kind) | Used for |
| --- | --- | --- |
| S1 | An astronomy-camera maker's manual (v1.2, Aug 2021) on a 36 × 24 mm 24 MP BSI sensor, §3 specification table p. 5 and §4 read noise p. 6: [PDF](https://i.zwoastro.com/zwo-website/manuals/ASI2400_Manual_EN_V1.2.pdf) | profile 1 |
| S2 | The same maker's manual (v1.4, Jul 2021) on a 36 × 24 mm 61 MP BSI sensor, §3 p. 5 and §4 p. 6: [PDF](https://i.zwoastro.com/zwo-website/manuals/ASI6200_Manual_EN_v1.4.pdf) | profile 2 (design basis) |
| S3 | The same maker's product announcement (2017-09-11, page 3) on a 36 × 24 mm 24 MP sensor of 2012: [page](https://www.zwoastro.com/2017/09/11/zwo-new-full-frame-cameras-asi094-pro-and-asi128-pro-released/3/) | profile 4 |
| S4 | A sensor maker's press release (2015-06-10) announcing the first back-illuminated 35 mm full-frame sensor: [release](https://sony.mediaroom.com/2015-06-10-Sonys-New-a7R-II-Camera-Delivers-Innovative-Imaging-Experience-with-Worlds-First-Back-Illuminated-35mm-Full-Frame-Sensor) | profile 4's architecture |
| S5 | A maker's specification table for an APS-C 24 MP front-illuminated sensor, as reproduced by a retailer (the maker's page is withdrawn): [page](https://cloudbreakoptics.com/products/247c) | profile 5 |
| S6 | An astronomy-camera maker's manual on an APS-C 26 MP BSI sensor, §3 p. 5: [PDF](https://i.zwoastro.com/zwo-website/manuals/ZWO_ASI2600_Manual_EN.pdf) | profile 6 |
| S7 | The same maker's manual (2026-03) on a 44 × 33 mm 100 MP BSI 16-bit sensor, §3.2 p. 5 and §3.3 p. 7: [PDF](https://i.zwoastro.com/wp-content/uploads/2026/03/9c73a6c478517fda5a90ef9985e661f1.pdf) | profile 7 |
| S8 | A second maker's product page for the same sensor: [page](https://www.qhyccd.com/qhy461ph/) | profile 7 (cross-check, architecture) |
| S9 | A sensor maker's product page for a 1/1.3-inch 50 MP stacked phone sensor: [page](https://www.ovt.com/products/ov50h) | profile 8 |
| S10 | Venezia et al., "1.0 µm pixel improvements with hybrid bond stacking technology", International Image Sensor Workshop 2017, paper R03, Table 1 (open proceedings): [PDF](https://imagesensors.org/Past%20Workshops/2017%20Workshop/2017%20Papers/R03.pdf) | profile 8 (full well basis, high-gain read noise, PRNU, offsets) |
| — | [CIPA DC-004-2020](https://www.cipa.jp/e/std/std-sec.html), *Sensitivity of digital cameras*, §3.2 (free); [EMVA Standard 1288 Release 4.0](https://www.emva.org/standards-technology/emva-1288/) (free); ISO 12232:2019 (**paywalled**; named only for the saturation-based check above) | the ISO anchor and the definitions |

The astronomy-camera manuals describe each sensor driven by that maker's own readout electronics, not by a photographic
camera: the sensor's values (pixels, pitch, full well, read noise, QE, ADC) are taken from them, its readout speed is not.
