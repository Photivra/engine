// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InvalidConfigurationError, estimateCie1931ColorMatchingFunctions, evaluateBt709InverseOetf, parseDngRawImage, evaluateSrgbDecoding, resolveRgbColorSpace,
  simulateCapture, type LensSampledPsfProfile, type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";

function sha(data: ArrayBufferView | string): string {
  const hash = createHash("sha256");
  hash.update(typeof data === "string" ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  return hash.digest("hex");
}
/** Digest of every byte-level facade output: developed samples, packed RAW, JPEG and the executed request. */
function digest(r: SimulateCaptureResult): Record<string, string> {
  const nativeCount = r.plan.pixelCount, sites = [0, Math.floor(nativeCount / 2), nativeCount - 1].map((i) => r.request.siteInput(i));
  return {
    samples: sha(r.image.samples), codes: sha(r.raw.codes), blackLevels: sha(r.raw.blackLevels), flags: sha(r.raw.saturationFlags),
    jpeg: r.image.jpeg ? sha(r.image.jpeg) : "none",
    environmentRaw: sha(JSON.stringify(r.request.environmentRaw)), development: sha(JSON.stringify(r.request.development)),
    sites: sha(JSON.stringify(sites)), sourceSha256: r.scene.sourceSha256
  };
}
/**
 * The 1.0 facade's default illuminance, π·K·N²/(t·S·0.18) with the reflected-light meter constant K = 12.5 cd·s/m².
 * The default now comes from CIPA DC-004 (see simulate-capture.test.ts), so the baseline cases pass the old value
 * explicitly; everything else must still reproduce the 1.0 bytes.
 */
const FACADE_1_0_DEFAULT_ILLUMINANCE_LUX = Math.PI * 12.5 * 64 * 125 / (100 * 0.18);
const BASELINE_CASES: Record<string, SimulateCaptureOptions> = {
  uniform: { scene: { preset: "uniform" }, output: { width: 4, height: 4 }, illuminanceLux: FACADE_1_0_DEFAULT_ILLUMINANCE_LUX },
  edge16: { scene: { preset: "slanted-edge" }, output: { width: 6, height: 4, format: "srgb-16" }, illuminanceLux: FACADE_1_0_DEFAULT_ILLUMINANCE_LUX },
  // 2.20.0: the JPEG default step is 1; the 1.0 bytes need the old step 2, given explicitly.
  jpegAuto: { scene: { preset: "checkerboard" }, output: { width: 8, height: 8, format: "jpeg", whiteBalance: "auto", jpegQuantizationStep: 2 },
    illuminanceLux: FACADE_1_0_DEFAULT_ILLUMINANCE_LUX },
  pupil: { scene: { preset: "siemens-star" }, lens: { pupilSampling: { radialSamples: 1, angularSamples: 4 }, focusDistanceM: 3 }, output: { width: 4, height: 4 },
    illuminanceLux: FACADE_1_0_DEFAULT_ILLUMINANCE_LUX }
};
/** Digests of the `uniform` case at the CIPA DC-004 default illuminance, π·80 000/11.7 ≈ 21 480.98 lux (re-pinned for the 2.0.0 CMF fit). */
const DC004_DEFAULT_UNIFORM: Record<string, string> = {
  samples: "7023e9aa363f3dd8b99e1ddf7b503fe95d040290ba3cc4e097b166e8d721f51a",
  codes: "3ce7bb31576b1b7a77b86157bbc99cc152919691d5a7d89597462d39aebdc06b",
  blackLevels: "85d8c8cdf03881458c326e5ea9b9d1993a0a13a1eab0eafb4f3bf9aa60d25f6b",
  flags: "6db65fd59fd356f6729140571b5bcd6bb3b83492a16e1bf0a3884442fc3c8a0e",
  jpeg: "none",
  environmentRaw: "7d5305401f89fa9cd417a3a18f7e4e47230fabaab0a15f4354c276de67909504",
  development: "5eb9d20168ba577baf2523450c593d4f18edcd6b60f4cde1f68a07f88470b108",
  sites: "7cda3bcff3cb4f90f01b8804a2b76bc6f10750de55a3ec41a2a7c4986580fc93",
  sourceSha256: "02ea939bf5f2d449f69412d899629de5ed061b0e6ce8f5a2107ba778c3dfbdfb"
};

/**
 * Digests recorded from the 1.0 facade (origin/main 09e4262) before any 2.0 option existed, re-pinned in
 * 2.0.0 for the engine's own CIE 1931 CMF fit (it replaced the Wyman et al. 2013 coefficients): samples,
 * codes, environmentRaw and sites changed; blackLevels, flags, development and sourceSha256 did not.
 * Re-pinned in 2.14 for the tier presets 2.1.0 (third-stop ISO settings): only the request records changed (sites ×5,
 * environmentRaw ×1), because they carry the whole readout profile, which now lists a regime per third-stop ISO, and the
 * 2.1.0 profile versions; samples, codes, blackLevels, flags, development and sourceSha256 are unchanged.
 */
const BASELINE: Record<string, Record<string, string>> = {
  uniform: {
    samples: "01f5ba9c3947726453f0408341e41da2234379419b23dbf7ad59d46b7f23d131",
    codes: "3f2be7bed79ed3261fd587372ca77a31e3e55568349b721102cba128a859f768",
    blackLevels: "85d8c8cdf03881458c326e5ea9b9d1993a0a13a1eab0eafb4f3bf9aa60d25f6b",
    flags: "6db65fd59fd356f6729140571b5bcd6bb3b83492a16e1bf0a3884442fc3c8a0e",
    jpeg: "none",
    environmentRaw: "963c0242b3ac30a7ee396fe7f2202e5c9fa529ffe2988d6d1693c2c114e09ff4",
    development: "5eb9d20168ba577baf2523450c593d4f18edcd6b60f4cde1f68a07f88470b108",
    sites: "c281b0159e753b396693e293ed865e105d8f4fc34c2de8f3f03defb126c72fee",
    sourceSha256: "6a9f7f6da9604c767ea52a17dade98a8e2887ccafb4e6c09a82c0f429fe572e9"
  },
  edge16: {
    samples: "125a52506ab91c51a29997183d17924613917e8ffef72137b58cbc232109641e",
    codes: "123b6ee0d241bce856e76615958a642ef8c4a423c94289aa127d67f6e3c3b323",
    blackLevels: "e609dcf9cc04614ef47867ee972ed167a4b405fd41ec28585b86d2907f179f1c",
    flags: "17b0761f87b081d5cf10757ccc89f12be355c70e2e29df288b65b30710dcbcd1",
    jpeg: "none",
    environmentRaw: "5d8f6a9e2add505f477c1b2fcd38f899f4eda2eeb87b2ba52c358e8d71ebed3b",
    development: "ea3c54f5a8ac75edc8e69e5fc77e16769b77060b307454d27f582773c7c78e0d",
    sites: "d9dfb49e94aa5c01d44338123b0401f661292b3816d926940fb3f58ecbe2067a",
    sourceSha256: "3b43a89f6c71e66ded934d2485ab8e49723b2540f8ff8fe54c1608a9f7a51166"
  },
  jpegAuto: {
    samples: "7e7dd20e11236e2ba6fd57d5902e6e5b679f026021acb21a028fdd13f7d5fa8a",
    codes: "e4d3fe3b8f1b8fc3dc76787ca20b7f60e4fe3b6648068beedac610f53801bd2b",
    blackLevels: "f235651a4bd57afc227c07e0fdb0b4ebe6aa8463eaf8307fec533194c8624a1f",
    flags: "cd00e292c5970d3c5e2f0ffa5171e555bc46bfc4faddfb4a418b6840b86e79a3",
    jpeg: "b4ba0b638197e309fbaadf60c895fa40fc97000e907dd3389c95b9c5d9163a9e",
    environmentRaw: "0c8b8eb1ba9f74bdc48c4201d06acce7a493fd27e2d46012a011f0da20d87291",
    development: "d919bdef431a2156a47488818ffe86288634d1a02f6af0ccd6d7476f18c571e7",
    sites: "bae7af3a56a2b45e457cacfcf917336fed310832a8267980286fcac6110f0587",
    sourceSha256: "d09e9c4233d2ccc43f00be71dc1b04845c11caad831eeb32b90e1fa278779f80"
  },
  pupil: {
    samples: "274c555bfd3ab135020f9a946c841ee554c83af7bf378371a6816d05a7e1c0c2",
    codes: "6e20371269d9b611ec785bd971c30ebb72dc292754c62bd928fbe2a24479c0a1",
    blackLevels: "85d8c8cdf03881458c326e5ea9b9d1993a0a13a1eab0eafb4f3bf9aa60d25f6b",
    flags: "6db65fd59fd356f6729140571b5bcd6bb3b83492a16e1bf0a3884442fc3c8a0e",
    jpeg: "none",
    environmentRaw: "e78b5cf661ab7a83b6442e13b6dc7a76f536e4700b7e0d835bb98d005ea085c9",
    development: "5eb9d20168ba577baf2523450c593d4f18edcd6b60f4cde1f68a07f88470b108",
    sites: "f4c4208df32f99ad3a7e3a9b906a94388d7b8affd435de822c281c51473f473e",
    sourceSha256: "a01c6c54d4193eea40a88e8ae802e6887aeb2058b0d43bd73b670a650f4835f0"
  }
};

describe("simulateCapture 2.0 integration", { timeout: 120_000 }, () => {
  it("keeps every pinned facade output when no 2.0 option is given (at the 1.0 default illuminance)", async () => {
    for (const [name, options] of Object.entries(BASELINE_CASES)) expect(digest(await simulateCapture(options)), name).toEqual(BASELINE[name]);
  });
  it("changes only the scene light with the CIPA DC-004 default illuminance", async () => {
    const current = digest(await simulateCapture({ scene: { preset: "uniform" }, output: { width: 4, height: 4 } }));
    expect(current).toEqual(DC004_DEFAULT_UNIFORM);
    expect(current.development).toBe(BASELINE.uniform!.development);
    expect(current.blackLevels).toBe(BASELINE.uniform!.blackLevels);
    expect(current.codes).not.toBe(BASELINE.uniform!.codes);
  });
});

/** PNG chunk payloads by type (signature and CRC are checked by the encoder's own tests). */
function pngChunks(png: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength), out = new Map<string, Uint8Array>();
  for (let o = 8; o < png.length;) {
    const length = view.getUint32(o), type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    out.set(type, png.subarray(o + 8, o + 8 + length));
    o += 12 + length;
  }
  return out;
}
function meanOf(samples: ArrayLike<number>, channel: number): number {
  let sum = 0;
  for (let i = channel; i < samples.length; i += 3) sum += samples[i]!;
  return sum / (samples.length / 3);
}
/** Mean black-subtracted, white-normalized green RAW level in a native-site window. */
function greenLevel(r: SimulateCaptureResult, x0: number, y0: number, x1: number, y1: number): number {
  const raw = r.raw, w = r.plan.exposure.geometry.nativeRaster.pixelWidth;
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if ((x + y) % 2 !== 1) continue;
    const i = y * w + x, white = raw.effectiveSaturationCodes[(y % 2) * 2 + (x % 2)]!;
    sum += (raw.codes[i]! - raw.blackLevels[i]!) / (white - raw.blackLevels[i]!); n++;
  }
  return sum / n;
}
/** Sub-pixel x where a row of the green channel crosses the midpoint between its extremes. */
function edgeX(samples: ArrayLike<number>, width: number, y: number): number {
  const row = Array.from({ length: width }, (_, x) => samples[(y * width + x) * 3 + 1]!);
  const mid = (Math.min(...row) + Math.max(...row)) / 2;
  for (let x = 0; x + 1 < width; x++) if ((row[x]! - mid) * (row[x + 1]! - mid) <= 0 && row[x] !== row[x + 1]) return x + (mid - row[x]!) / (row[x + 1]! - row[x]!);
  return NaN;
}
const evidence = [{ sourceOrigin: "photivra" as const, sourceReference: "test:facade-psf", reuseStatus: "photivra-owned" as const }];
/** Engine-owned synthetic sampled PSF bound to the facade defaults (50 mm, f/8, focus 5 m): a 3 × 3 kernel at the pixel pitch. */
function facadePsf(): NonNullable<NonNullable<SimulateCaptureOptions["lens"]>["psf"]> {
  const axes = { focalLengthMm: [50], focusDiopters: [0.2], apertureFNumber: [8], fieldXmm: [-1, 1], fieldYmm: [-1, 1], wavelengthNm: [380, 780], signedDefocusImagePlaneMicrometers: [0] };
  const kernel = { widthSamples: 3, heightSamples: 3, samplePitchMicrometersX: 6, samplePitchMicrometersY: 6, centerSampleX: 1, centerSampleY: 1,
    normalizedIntensity: [0.0625, 0.125, 0.0625, 0.125, 0.25, 0.125, 0.0625, 0.125, 0.0625] };
  const profile: LensSampledPsfProfile = { schemaVersion: "0.1.0", profileId: "test-binomial-psf", profileVersion: "1", scientificStatus: "approximation",
    opticalDomain: "lens-primary-optical-path-only", coordinateSystem: "image-plane-metric", fieldAxes: "+X right, +Y up", kernelEnergyNormalization: "unit-energy-shape",
    interpolation: "bounded-regular-grid-multilinear", throughputOwnership: "separate-relative-pupil-throughput-factor",
    responseIncludes: { diffraction: true, aberration: true, defocus: true, pupilClippingShape: true }, sensorOpticalStackIncluded: false, sensorSamplingIncluded: false,
    reconstructionIncluded: false, strayLightIncluded: false, axes, evidence, limitations: ["Synthetic binomial kernel for a facade test."],
    nodes: axes.fieldXmm.flatMap((x) => axes.fieldYmm.flatMap((y) => axes.wavelengthNm.map((nm) => ({ nodeId: "n-" + x + "-" + y + "-" + nm,
      coordinate: { focalLengthMm: 50, focusDiopters: 0.2, apertureFNumber: 8, fieldXmm: x, fieldYmm: y, wavelengthNm: nm, signedDefocusImagePlaneMicrometers: 0 },
      kernel, bestFocusImagePlaneOffsetMicrometers: 0, relativePupilThroughputFactor: 1, evidence, uncertainty: { kind: "not-quantified" as const, limitation: "Synthetic." } })))) };
  return { kind: "sampled-local", configuration: { psf: { profile, focalLengthMm: 50, focus: { kind: "finite", distanceM: 5 }, apertureFNumber: 8, signedDefocusImagePlaneMicrometers: 0 },
    psfWavelengthBasis: { value: "vacuum", evidence }, spatialModel: { kind: "destination-local-shift-invariant-approximation", evidence, limitation: "Synthetic local kernel." } } };
}

describe("simulateCapture 2.0 options", { timeout: 300_000 }, () => {
  it("writes sRGB PNG from exactly the developed sRGB samples, at 8 and 16 bits", async () => {
    const base = { scene: { preset: "checkerboard" as const }, sensor: { noiseSeed: 3 } };
    const srgb8 = await simulateCapture({ ...base, output: { width: 6, height: 4 } }), png8 = await simulateCapture({ ...base, output: { width: 6, height: 4, format: "png" } });
    expect(Array.from(png8.image.samples)).toEqual(Array.from(srgb8.image.samples));
    expect(Array.from(png8.image.png!.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const chunks = pngChunks(png8.image.png!);
    expect(chunks.get("IHDR")![8]).toBe(8);
    expect(chunks.has("sRGB")).toBe(true);
    expect(png8.image.colorEncoding).toBe("srgb");
    expect(png8.assumptions.map((a) => a.id)).toEqual(expect.arrayContaining(["output.colorEncoding", "output.bitDepth", "output.png"]));
    const srgb16 = await simulateCapture({ ...base, output: { width: 6, height: 4, format: "srgb-16" } });
    const png16 = await simulateCapture({ ...base, output: { width: 6, height: 4, format: "png", bitDepth: 16 } });
    expect(png16.image.samples).toBeInstanceOf(Uint16Array);
    expect(Array.from(png16.image.samples)).toEqual(Array.from(srgb16.image.samples));
    expect(pngChunks(png16.image.png!).get("IHDR")![8]).toBe(16);
  });

  it("converts wide-gamut PNG through XYZ from the unclipped linear development", async () => {
    // A saturated green emitter (a 530 nm band on a weak flat floor) lies outside sRGB but inside Display P3 and Rec. 2020.
    const scene = { kind: "radiance-function" as const, sceneId: "green-emitter", evaluate: (p: { wavelengthNanometers: number }): number => 5e-2 * (0.15 + Math.exp(-(((p.wavelengthNanometers - 530) / 30) ** 2))) };
    const options = { scene, sensor: { spectralStepNanometers: 5 }, output: { width: 4, height: 4, whiteBalance: "none" as const, bitDepth: 16 as const } };
    const p3 = await simulateCapture({ ...options, output: { ...options.output, format: "png", colorEncoding: "display-p3" } });
    const rec2020 = await simulateCapture({ ...options, output: { ...options.output, format: "png", colorEncoding: "rec2020" } });
    const srgb = await simulateCapture({ ...options, output: { ...options.output, format: "png", colorEncoding: "srgb" } });
    expect(Array.from(pngChunks(p3.image.png!).get("cICP")!)).toEqual([12, 13, 0, 1]);
    expect(Array.from(pngChunks(rec2020.image.png!).get("cICP")!)).toEqual([9, 1, 0, 1]);
    expect(srgb.diagnostics.rendering.gamutClippedLowSampleCount).toBeGreaterThan(0);
    // Decode each encoding to XYZ: the wide gamuts agree with each other and keep the chroma that sRGB clips.
    const toXyz = (r: SimulateCaptureResult, space: "display-p3" | "rec2020", decode: (v: number) => number): number[] => {
      const m = resolveRgbColorSpace(space).value.rgbToXyz, rgb = [0, 1, 2].map((c) => decode(meanOf(r.image.samples, c) / 65535));
      return m.map((row) => row[0]! * rgb[0]! + row[1]! * rgb[1]! + row[2]! * rgb[2]!);
    };
    const a = toXyz(p3, "display-p3", evaluateSrgbDecoding), b = toXyz(rec2020, "rec2020", evaluateBt709InverseOetf);
    expect(p3.diagnostics.rendering.gamutClippedLowSampleCount).toBe(0);
    expect(rec2020.diagnostics.rendering.gamutClippedLowSampleCount).toBe(0);
    expect(p3.diagnostics.rendering.gamutClippedHighSampleCount + rec2020.diagnostics.rendering.gamutClippedHighSampleCount).toBe(0);
    for (let k = 0; k < 3; k++) expect(a[k]! / b[k]!).toBeCloseTo(1, 2);
    // With the colorimetric (Luther) sensor and no white balance, the wide-gamut result reproduces the emitter's CIE 1931 chromaticity.
    const xy = (xyz: number[]): number[] => [xyz[0]! / (xyz[0]! + xyz[1]! + xyz[2]!), xyz[1]! / (xyz[0]! + xyz[1]! + xyz[2]!)];
    const truth = [0, 0, 0];
    for (let nm = 380; nm <= 780; nm++) { const e = scene.evaluate({ wavelengthNanometers: nm }), c = estimateCie1931ColorMatchingFunctions(nm); truth[0]! += e * c.x; truth[1]! += e * c.y; truth[2]! += e * c.z; }
    const s = resolveRgbColorSpace("srgb").value.rgbToXyz, sRgb = [0, 1, 2].map((c) => evaluateSrgbDecoding(meanOf(srgb.image.samples, c) / 65535));
    const distance = (u: number[], v: number[]): number => Math.hypot(u[0]! - v[0]!, u[1]! - v[1]!);
    expect(distance(xy(a), xy(truth))).toBeLessThan(0.004); // 5 nm spectral quadrature
    expect(distance(xy(s.map((row) => row[0]! * sRgb[0]! + row[1]! * sRgb[1]! + row[2]! * sRgb[2]!)), xy(truth))).toBeGreaterThan(0.015);
    // A neutral grey card is neutral in every encoding and agrees with sRGB in luminance.
    const grey = (colorEncoding: "display-p3" | "rec2020"): Promise<SimulateCaptureResult> => simulateCapture({ scene: { preset: "uniform" }, output: { width: 4, height: 4, format: "png", colorEncoding, bitDepth: 16 } });
    const sGrey = await simulateCapture({ scene: { preset: "uniform" }, output: { width: 4, height: 4, format: "srgb-16" } });
    const linearGrey = evaluateSrgbDecoding(meanOf(sGrey.image.samples, 1) / 65535);
    const p3Grey = await grey("display-p3");
    expect(evaluateSrgbDecoding(meanOf(p3Grey.image.samples, 1) / 65535) / linearGrey).toBeCloseTo(1, 2);
    const rec2020Grey = await grey("rec2020");
    expect(Array.from(pngChunks(rec2020Grey.image.png!).get("cICP")!)).toEqual([9, 1, 0, 1]);
    expect(evaluateBt709InverseOetf(meanOf(rec2020Grey.image.samples, 1) / 65535) / linearGrey).toBeCloseTo(1, 2);
    for (const r of [p3Grey, rec2020Grey]) expect(Math.abs(meanOf(r.image.samples, 0) - meanOf(r.image.samples, 1)) / meanOf(r.image.samples, 1)).toBeLessThan(0.01);
    // PQ and HLG are not part of 2.0 (licence-on-request patent declarations; THIRD_PARTY.md).
    for (const colorEncoding of ["rec2100-pq", "rec2100-hlg"]) await expect(simulateCapture({ scene: { preset: "uniform" },
      output: { width: 4, height: 4, format: "png", colorEncoding: colorEncoding as "rec2020", bitDepth: 16 } })).rejects.toThrow(InvalidConfigurationError);
  });

  it("writes the packed native RAW as a DNG that round-trips through parseDngRawImage", async () => {
    const r = await simulateCapture({ scene: { preset: "siemens-star" }, output: { width: 6, height: 4, format: "dng", dng: { capturedAtUtc: "2026-10-17T12:00:00.000Z" } } });
    const parsed = parseDngRawImage({ bytes: r.image.dng! });
    expect([parsed.width, parsed.height]).toEqual([8, 6]);
    expect(Array.from(parsed.codes)).toEqual(Array.from(r.raw.codes));
    expect(parsed.activeArea).toEqual({ x: 1, y: 1, width: 6, height: 4 });
    expect(parsed.defaultCrop).toEqual({ x: 0, y: 0, width: 6, height: 4 });
    expect(r.image.samples).toBeInstanceOf(Uint8Array);
    expect(r.provenance.composedContracts).toContain("serializeNativeRawDng");
    const a = r.assumptions.find((x) => x.id === "output.dng")!.value as { noiseProfile: number[] | null };
    expect(a.noiseProfile).toHaveLength(6);
  });

  it("selects built-in demosaic kernels and mirror borders", async () => {
    const base = { scene: { preset: "slanted-edge" as const }, sensor: { noiseSeed: 5 } };
    const legacy = await simulateCapture({ ...base, output: { width: 8, height: 6 } });
    const bilinear = await simulateCapture({ ...base, output: { width: 8, height: 6, demosaic: "bilinear" } });
    // The built-in bilinear kernels reproduce the 1.0 facade's bilinear kernels pixel for pixel.
    expect(Array.from(bilinear.image.samples)).toEqual(Array.from(legacy.image.samples));
    expect(bilinear.plan.exposure.geometry.nativeRaster).toEqual({ pixelWidth: 10, pixelHeight: 8 });
    expect(bilinear.assumptions.find((a) => a.id === "output.demosaic")!.value).toMatchObject({ kernel: "bilinear", kernelReachSites: 1 });
    // The Malvar–He–Cutler option was removed from 2.0 (patent US 7,502,505 still in force).
    await expect(simulateCapture({ ...base, output: { width: 8, height: 6, demosaic: "malvar-he-cutler" as "bilinear" } })).rejects.toThrow(InvalidConfigurationError);
    const mirror = await simulateCapture({ scene: { preset: "uniform" }, output: { width: 6, height: 4, demosaic: "bilinear", borderHandling: "mirror" } });
    expect(mirror.plan.exposure.geometry.nativeRaster).toEqual({ pixelWidth: 6, pixelHeight: 4 });
    expect(mirror.request.development.borderHandling).toBe("mirror");
    // Uniform field: the mirrored edge pixels develop like the interior (no lost or darkened border).
    const s = mirror.image.samples, interior = s[(1 * 6 + 2) * 3 + 1]!;
    for (const [x, y] of [[0, 0], [5, 0], [0, 3], [5, 3]]) expect(Math.abs(s[(y! * 6 + x!) * 3 + 1]! - interior)).toBeLessThanOrEqual(6);
  });

  it("maps lens projection and distortion through the environment lens field mapping", async () => {
    const base = { scene: { preset: "uniform" as const }, output: { width: 8, height: 8 }, sensor: { noiseSeed: 7 } };
    const plain = await simulateCapture(base);
    const identity = await simulateCapture({ ...base, lens: { projection: "rectilinear" } });
    expect(Array.from(identity.raw.codes)).toEqual(Array.from(plain.raw.codes));
    expect(identity.request.siteInput(0).environment.lensFieldMapping).toEqual({ projectionModel: "rectilinear", distortion: { kind: "none" }, radiometricAreaCorrection: "inverse-distortion-jacobian" });
    const fisheye = await simulateCapture({ ...base, lens: { projection: "fisheye-equidistant" } });
    expect(fisheye.assumptions.find((a) => a.id === "lens.projection")!.value).toBe("fisheye-equidistant");
    // Barrel distortion compresses the field off axis, so the area factor 1/det(J) brightens the corners of a uniform scene.
    const barrel = await simulateCapture({ ...base, lens: { distortion: { kind: "radial", profile: { normalizationRadiusMm: 0.05, maximumNormalizedRadius: 1, coefficients: { k1: -0.2, k2: 0, k3: 0 } } } } });
    const centre = greenLevel(barrel, 4, 4, 6, 6), corner = greenLevel(barrel, 0, 0, 2, 2);
    expect(corner / centre).toBeGreaterThan(1.5);
    expect(greenLevel(plain, 0, 0, 2, 2) / greenLevel(plain, 4, 4, 6, 6)).toBeCloseTo(1, 1);
    const tangential = await simulateCapture({ ...base, lens: { distortion: { kind: "brown-conrady", profile: { normalizationRadiusMm: 0.05, maximumNormalizedRadius: 1,
      coefficients: { k1: 0, k2: 0, k3: 0, p1: 0.02, p2: 0 } } } } });
    expect(tangential.assumptions.find((a) => a.id === "lens.distortion")!.value).toMatchObject({ kind: "brown-conrady" });
  });

  it("applies caller vignetting and a sampled PSF as environment hooks", async () => {
    const base = { scene: { preset: "uniform" as const }, output: { width: 8, height: 8 }, sensor: { noiseSeed: 9 } };
    const vignetted = await simulateCapture({ ...base, lens: { vignetting: { normalizationRadiusMm: 0.05, maximumNormalizedRadius: 1, coefficients: { r2: -0.8, r4: 0, r6: 0 } } } });
    // Expected ratio: mean of 1 + r2·ρ² over the green sites of each window, ρ = radius / 0.05 mm on the 10 × 10-site, 6 µm frame.
    const throughput = (x0: number, y0: number, x1: number, y1: number): number => { let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if ((x + y) % 2 === 1) { sum += 1 - 0.8 * (((x + 0.5 - 5) ** 2 + (y + 0.5 - 5) ** 2) * 0.006 ** 2) / 0.05 ** 2; n++; }
      return sum / n; };
    expect(greenLevel(vignetted, 0, 0, 2, 2) / greenLevel(vignetted, 4, 4, 6, 6)).toBeCloseTo(throughput(0, 0, 2, 2) / throughput(4, 4, 6, 6), 1);
    expect(vignetted.request.siteInput(0).environment.fieldThroughput.kind).toBe("radial-illumination-vignetting");
    const edge = { scene: { preset: "slanted-edge" as const, angleDegrees: 0 }, output: { width: 8, height: 4 }, sensor: { noiseSeed: 9 } };
    const sharp = await simulateCapture(edge), blurred = await simulateCapture({ ...edge, lens: { psf: facadePsf() } });
    const step = (r: SimulateCaptureResult): number => { let m = 0; for (let x = 0; x < 7; x++) m = Math.max(m, Math.abs(r.image.samples[(8 + x + 1) * 3 + 1]! - r.image.samples[(8 + x) * 3 + 1]!)); return m; };
    expect(step(blurred)).toBeLessThan(step(sharp));
    expect(blurred.assumptions.find((a) => a.id === "lens.psf")!.value).toEqual({ kind: "sampled-local" });
  });

  it("blurs with camera rotation and shears with a rolling shutter", async () => {
    // Yaw ω moves the image by ω·f/pitch = 500 px/s; over 1/125 s that is 4 px of blur.
    const edge = { scene: { preset: "slanted-edge" as const, angleDegrees: 0 }, output: { width: 16, height: 12 }, sensor: { noiseSeed: 11 } };
    const still = await simulateCapture(edge), moving = await simulateCapture({ ...edge, motion: { angularVelocityRadPerSec: { yaw: 0.06 } } });
    expect(moving.assumptions.find((a) => a.id === "sensor.temporalSampleCount")!.value).toBe(8);
    const transition = (r: SimulateCaptureResult): number => { const row = Array.from({ length: 16 }, (_, x) => r.image.samples[(6 * 16 + x) * 3 + 1]!), lo = Math.min(...row), hi = Math.max(...row);
      return row.filter((v) => v > lo + 0.1 * (hi - lo) && v < hi - 0.1 * (hi - lo)).length; };
    expect(transition(moving)).toBeGreaterThan(transition(still) + 1);
    const rolling = await simulateCapture({ ...edge, motion: { angularVelocityRadPerSec: { yaw: 0.06 }, shutter: "rolling", rollingShutterSkewSeconds: 0.01 } });
    // Each native row opens s·τ later: site start offsets grow linearly down the frame (top-to-bottom tier readout).
    const start = (y: number): number => rolling.request.siteInput(y * 18).charge.completenessProfile.startOffsetSecondsFromOpeningReference;
    expect(start(0)).toBeLessThan(start(13));
    expect(start(13) - start(0)).toBeCloseTo(0.01 * 13 / 14, 3);
    // Shear: the edge moves 500 px/s · τ across the frame relative to the global-shutter capture.
    const shear = (r: SimulateCaptureResult): number => edgeX(r.image.samples, 16, 10) - edgeX(r.image.samples, 16, 1);
    expect(Math.abs(shear(moving))).toBeLessThan(0.5);
    expect(Math.abs(shear(rolling))).toBeGreaterThan(2.5);
    expect(Math.abs(shear(rolling))).toBeLessThan(4.5);
    expect(rolling.assumptions.find((a) => a.id === "sensor.shutter")!.value).toMatchObject({ kind: "electronic-rolling", lineScanSkewSeconds: 0.01 });
    const tier = await simulateCapture({ scene: { preset: "uniform" }, output: { width: 4, height: 4 }, motion: { shutter: "rolling" } });
    expect(tier.assumptions.find((a) => a.id === "sensor.shutter")!.explanation).toMatch(/not scaled/);
  });

  it("rejects inconsistent 2.0 options before any radiance work", async () => {
    let calls = 0;
    const scene = { kind: "radiance-function" as const, sceneId: "never", evaluate: (): number => { calls++; return 0.01; } };
    const bad: SimulateCaptureOptions[] = [
      { scene, output: { colorEncoding: "display-p3" } },
      { scene, output: { format: "png", colorEncoding: "rec2100-pq" as never } },
      { scene, output: { format: "png", colorEncoding: "rec2020", toneCurve: "positive-reinhard-per-channel" } },
      { scene, output: { format: "png", dng: {} } },
      { scene, output: { format: "png", bitDepth: 12 as never } },
      { scene, output: { demosaic: "lmmse" as never } },
      { scene, output: { borderHandling: "wrap" as never } },
      { scene, lens: { projection: "fisheye-equidistant", pupilSampling: { radialSamples: 1, angularSamples: 4 } } },
      { scene, lens: { distortion: { kind: "radial", profile: { normalizationRadiusMm: 1, maximumNormalizedRadius: 1, coefficients: { k1: -2, k2: 0, k3: 0 } } } } },
      { scene, lens: { psf: { kind: "other" } as never } },
      { scene, lens: { pupilSampling: { radialSamples: 1, angularSamples: 3 } } },
      { scene, motion: { rollingShutterSkewSeconds: 0.01 } },
      { scene, motion: { shutter: "focal-plane" as never } },
      { scene, motion: { angularVelocityRadPerSec: { yaw: Number.NaN } } },
      { scene, motion: { spin: 1 } as never }
    ];
    for (const options of bad) await expect(simulateCapture(options), JSON.stringify(options, (_k, v: unknown) => typeof v === "function" ? "fn" : v)).rejects.toThrow(InvalidConfigurationError);
    expect(calls).toBe(0);
  });
});

describe("simulateCapture perceptual gamut mapping", { timeout: 300_000 }, () => {
  /** CIELAB hue angle (degrees) of an XYZ colour relative to D65. */
  function hue(xyz: number[]): number {
    const w = resolveRgbColorSpace("srgb").value.whiteXyz, white = [w.x, w.y, w.z], f = (t: number): number => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
    const [fx, fy, fz] = xyz.map((v, i) => f(v / white[i]!)) as [number, number, number];
    return Math.atan2(200 * (fy - fz), 500 * (fx - fy)) * 180 / Math.PI;
  }
  it("keeps clip as the unchanged default and maps out-of-gamut colour at constant hue", async () => {
    const plain = await simulateCapture({ scene: { preset: "checkerboard" }, output: { width: 4, height: 4, format: "png" } });
    const clip = await simulateCapture({ scene: { preset: "checkerboard" }, output: { width: 4, height: 4, format: "png", gamutMapping: "clip" } });
    expect(Array.from(clip.image.png!)).toEqual(Array.from(plain.image.png!));
    expect(plain.assumptions.find((a) => a.id === "output.gamutMapping")!.value).toBe("clip");
    const scene = { kind: "radiance-function" as const, sceneId: "green-emitter", evaluate: (p: { wavelengthNanometers: number }): number => 5e-2 * (0.15 + Math.exp(-(((p.wavelengthNanometers - 530) / 30) ** 2))) };
    const base = { scene, sensor: { spectralStepNanometers: 5 }, output: { width: 4, height: 4, whiteBalance: "none" as const, format: "png" as const, bitDepth: 16 as const } };
    const clipped = await simulateCapture(base), mapped = await simulateCapture({ ...base, output: { ...base.output, gamutMapping: "perceptual" } });
    expect(clipped.diagnostics.rendering.gamutClippedLowSampleCount).toBeGreaterThan(0);
    expect(mapped.diagnostics.gamutMapping).toMatchObject({ method: "cielab-hue-preserving-chroma-compression", kneeFraction: 0.9, adjustedPixelCount: 16 });
    expect(mapped.provenance.composedContracts).toContain("prepareRgbGamutMapping");
    const decode = (r: SimulateCaptureResult): number[] => {
      const rgb = [0, 1, 2].map((c) => evaluateSrgbDecoding(meanOf(r.image.samples, c) / 65535)), m = resolveRgbColorSpace("srgb").value.rgbToXyz;
      return m.map((row) => row[0]! * rgb[0]! + row[1]! * rgb[1]! + row[2]! * rgb[2]!);
    };
    const truth = [0, 0, 0];
    for (let nm = 380; nm <= 780; nm++) { const e = scene.evaluate({ wavelengthNanometers: nm }), c = estimateCie1931ColorMatchingFunctions(nm); truth[0]! += e * c.x; truth[1]! += e * c.y; truth[2]! += e * c.z; }
    const hueError = (r: SimulateCaptureResult): number => Math.abs(hue(decode(r)) - hue(truth));
    expect(hueError(mapped)).toBeLessThan(1);
    expect(hueError(mapped)).toBeLessThan(hueError(clipped));
    // Neutral colours are untouched by the mapping.
    const grey = await simulateCapture({ scene: { preset: "uniform" }, output: { width: 4, height: 4, format: "png", gamutMapping: "perceptual" } });
    expect(grey.diagnostics.gamutMapping!.adjustedPixelCount).toBe(0);
    const greyClip = await simulateCapture({ scene: { preset: "uniform" }, output: { width: 4, height: 4, format: "png" } });
    for (let i = 0; i < greyClip.image.samples.length; i++) expect(Math.abs(grey.image.samples[i]! - greyClip.image.samples[i]!)).toBeLessThanOrEqual(1);
    for (const bad of [{ format: "srgb-8", gamutMapping: "perceptual" },
      { format: "png", gamutMapping: "perceptual", toneCurve: "positive-reinhard-per-channel" }, { format: "png", gamutMapping: "hue" }])
      await expect(simulateCapture({ scene: { preset: "uniform" }, output: bad as never })).rejects.toThrow(InvalidConfigurationError);
  });
});
