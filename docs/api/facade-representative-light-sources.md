# facade/representative-light-sources.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## createRepresentativeLightSourceIlluminant

A capture illuminant for a source: `{ kind: "spectrum", spectrum, label }` with the spectrum of
{@link createRepresentativeLightSourceSpectrum} and the label "<name> (representative, not a named product)".

```ts
export function createRepresentativeLightSourceIlluminant(input: { sourceId: RepresentativeLightSourceId }): Extract<CaptureIlluminant, { kind: "spectrum" }>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## createRepresentativeLightSourceSpectrum

A source's relative spectral power distribution S(λ) = b + Σ aₖ·exp(−½((λ − μₖ)/σₖ)²) as a function spectrum on
360–830 nm (relative units; values memoized per wavelength). Pass it to a capture as
`illuminant: { kind: "spectrum", spectrum }`; for color work use `sensor.spectralStepNanometers: 5` or finer
(docs/LIGHT_SOURCES.md, "Quadrature"). Throws `InvalidScientificInputError` outside 360–830 nm.

```ts
export function createRepresentativeLightSourceSpectrum(input: { sourceId: RepresentativeLightSourceId }): ColorimetricSpectrum;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## getRepresentativeLightSourceSet

The built-in representative light sources: Photivra's own parametric spectra of a tri-phosphor fluorescent tube and
three white LEDs (low and high color rendering at 4000 K, warm at 2700 K). A static, deeply frozen engine contract.
Each is "representative, not a named product"; docs/LIGHT_SOURCES.md gives every formula and the reasons for it.

```ts
export function getRepresentativeLightSourceSet(): RepresentativeLightSourceSet;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## REPRESENTATIVE_LIGHT_SOURCE_IDS

The source ids, in set order.

```ts
REPRESENTATIVE_LIGHT_SOURCE_IDS = Object.freeze([
  "tri-phosphor-fluorescent-4000k", "white-led-low-rendering-4000k", "white-led-high-rendering-4000k", "warm-white-led-2700k"
] as const)
```

## REPRESENTATIVE_LIGHT_SOURCE_SET_ID

Identity of the built-in light-source set.

```ts
REPRESENTATIVE_LIGHT_SOURCE_SET_ID = "photivra-representative-light-sources"
```

## REPRESENTATIVE_LIGHT_SOURCE_SET_VERSION

Version of the set's spectra; a change to any spectrum changes it.

```ts
REPRESENTATIVE_LIGHT_SOURCE_SET_VERSION = "1.0.0"
```

## REPRESENTATIVE_LIGHT_SOURCE_WAVELENGTH_RANGE_NANOMETERS

Domain of every spectrum, nm (the CIE 1931 observer's domain; the capture facade uses 380–780 nm of it).

```ts
REPRESENTATIVE_LIGHT_SOURCE_WAVELENGTH_RANGE_NANOMETERS = Object.freeze({ minimum: 360, maximum: 830 })
```

## RepresentativeLightSource

One built-in source: its id, name, design reason and spectrum definition.

```ts
export interface RepresentativeLightSource {
  sourceId: RepresentativeLightSourceId;
  /** Photivra's descriptive name, for example "White LED, high color rendering, 4000 K". */
  name: string;
  family: "fluorescent" | "led";
  /** The CCT the spectrum was designed for, K (its computed CCT is within 1 K of it, Duv within 0.0001; docs/LIGHT_SOURCES.md). */
  nominalCorrelatedColorTemperatureKelvin: number;
  /** Always "representative, not a named product". */
  label: "representative, not a named product";
  /** One sentence: what the source represents and why it is built this way. */
  reason: string;
  /** The constant b (a low continuum), relative units. */
  base: number;
  bands: readonly RepresentativeLightSourceBand[];
}
```

## RepresentativeLightSourceBand

One Gaussian band a·exp(−½((λ − μ)/σ)²) of a source spectrum.

```ts
export interface RepresentativeLightSourceBand {
  kind: "gaussian";
  /** What the band represents, for example "blue pump" or "green phosphor line". */
  role: string;
  amplitude: number;
  centerNanometers: number;
  standardDeviationNanometers: number;
}
```

## RepresentativeLightSourceId

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type RepresentativeLightSourceId = (typeof REPRESENTATIVE_LIGHT_SOURCE_IDS)[number];
```

## RepresentativeLightSourceSet

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface RepresentativeLightSourceSet {
  setId: typeof REPRESENTATIVE_LIGHT_SOURCE_SET_ID;
  setVersion: typeof REPRESENTATIVE_LIGHT_SOURCE_SET_VERSION;
  wavelengthRangeNanometers: { readonly minimum: number; readonly maximum: number };
  sources: readonly RepresentativeLightSource[];
}
```
