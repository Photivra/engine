// SPDX-License-Identifier: Apache-2.0
/**
 * #715: the image-plane Quality passes (src/gpu/display-view-image-quality.ts) build a band's pixel records only for the photo
 * pixels its lattice windows reach (rows and columns), write them 4 MiB of rows at a time, and the Quality host counts them in its
 * band size, so a photo whose records pass the device's storage binding limit renders in bands on the device instead of falling
 * back. The records are the same numbers at other offsets: a banded render equals one band byte for byte. On the float32
 * emulation (test/helpers/fake-webgpu*.ts); the real-device cases are in test/webgpu/display-view-quality.webgpu.ts.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prepareImagePlaneScenes } from "../src/index.js";
import type { SimulateCaptureOptions } from "../src/index.js";
import { IMAGE_PLANE_GPU_CASES, IMAGE_PLANE_GPU_LENS, photo, syntheticPhoto } from "./helpers/image-plane-fixtures.js";
import { createFakeGpu } from "./helpers/fake-webgpu.js";
import { SMALL_VIEW, compareDisplayViews, displayViewGpuFixture, renderOnGpuQuality, runtimeOf } from "./helpers/display-view-gpu-fixture.js";
import type { WebGpuRuntime } from "../src/gpu/webgpu-runtime.js";
import { IMAGE_PLANE_QUALITY_PARAMS } from "../src/gpu/display-view-image-quality.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const MIB = 1024 * 1024;
/** A 2400 × 1600 photo fitted inside the 600 × 400 frame, diffraction on (site kernels): its whole records are 2400 · 1600 · 16 B = 61.4 MB. */
const options: SimulateCaptureOptions = { ...IMAGE_PLANE_GPU_CASES[1]![1], scene: photo(syntheticPhoto(2400, 1600)), lens: { ...IMAGE_PLANE_GPU_LENS, diffraction: "circular-aperture" } };

/** The bytes of every write to a buffer whose label holds `label` (one entry per write), and with `words` the first words of each write. */
function spyWrites(runtime: WebGpuRuntime, label: string, words: number[][] = []): number[] {
  const writes: number[] = [], queue = runtime.device.queue, write = queue.writeBuffer.bind(queue);
  queue.writeBuffer = ((buffer: GPUBuffer, offset: number, data: ArrayBuffer, dataOffset?: number, size?: number) => {
    if (buffer.label.includes(label)) writes.push(size!);
    if (buffer.label.includes("photo-params")) words.push(Array.from(new Uint32Array(data, dataOffset ?? 0, size! / 4)));
    write(buffer, offset, data, dataOffset, size);
  }) as typeof queue.writeBuffer;
  return writes;
}

describe("image-plane Quality passes: the pixel records of a band (#715)", () => {
  beforeAll(async () => { await prepareImagePlaneScenes(); });

  it("a band whose records pass the 16 MiB binding limit is split by the host: the bands render on the device, equal to one band, inside the bounds", async () => {
    // A strip of the full width: its lattice fits one band, its records (a 4800 × 3200 photo, about 380 rows of 4800 pixels, 29 MB) do not.
    const strip = { ...SMALL_VIEW, region: { x: 0, y: 60, width: SMALL_VIEW.width, height: 12 } };
    const fixture = await displayViewGpuFixture({ ...options, scene: photo(syntheticPhoto(4800, 3200)) }, strip);
    const small = await runtimeOf(createFakeGpu({ maxStorageBufferBindingSize: 16 * MIB }).gpu), large = await runtimeOf(createFakeGpu({ maxStorageBufferBindingSize: 1024 * MIB }).gpu);
    const writes = spyWrites(small, "photo-records");
    // Before #715 the small device threw insufficient-limits ("A band's pixel records exceed the device's storage binding limit").
    const banded = await renderOnGpuQuality(small, fixture, 16 * MIB), whole = await renderOnGpuQuality(large, fixture, 1024 * MIB), a = compareDisplayViews(fixture.cpu, banded);
    expect(banded.execution.backend).toBe("webgpu-f32");
    expect(writes.length).toBeGreaterThan(8);
    expect(Math.max(...writes)).toBeLessThanOrEqual(4 << 20);
    expect(banded.samples).toEqual(whole.samples);
    expect(banded.expected).toEqual(whole.expected);
    expect(banded.noiseStd).toEqual(whole.noiseStd);
    expect(Array.from(banded.flaggedPixelIndices)).toEqual(Array.from(whole.flaggedPixelIndices));
    expect(a.outsideExpectedBound + a.outsideVarianceBound).toBe(0);
    expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
    small.destroy(); large.destroy();
  }, scaledTimeout(600_000));

  it("a 48 × 36 region builds the records of the photo columns it reaches, not the photo's width, 4 MiB of rows at a time", async () => {
    const region = { x: 70, y: 40, width: 48, height: 36 }, fixture = await displayViewGpuFixture(options, { ...SMALL_VIEW, region });
    const runtime = await runtimeOf(createFakeGpu().gpu), params: number[][] = [], writes = spyWrites(runtime, "photo-records", params);
    // The first render runs the device's self-check (its own 12 × 8 photo); the second is the region's alone.
    await renderOnGpuQuality(runtime, fixture);
    writes.length = 0; params.length = 0;
    const gpu = await renderOnGpuQuality(runtime, fixture), a = compareDisplayViews(fixture.cpu, gpu);
    const P = IMAGE_PLANE_QUALITY_PARAMS, bytes = writes.reduce((sum, w) => sum + w, 0), bands = params.map((w) => ({ row0: w[P.row0]!, col0: w[P.col0]!, columns: w[P.columns]! }));
    expect(bands).toHaveLength(1);
    const { columns, col0 } = bands[0]!, rows = bytes / (16 * columns);
    // The print spans the frame's width, so a display column is 2400 / 203 photo columns: the region's 48 and 8 more for the kernel's
    // reach and the margin bound the columns read (they start at display column 70). Before #715 every band built all 2400 columns.
    expect(Number.isInteger(rows)).toBe(true);
    expect(columns).toBeLessThanOrEqual(Math.ceil(2400 * (48 + 8) / 203));
    expect(col0).toBeGreaterThanOrEqual(Math.floor(2400 * (70 - 4) / 203));
    expect(bytes).toBeLessThan(0.3 * rows * 2400 * 16);
    expect(Math.max(...writes)).toBeLessThanOrEqual(4 << 20);
    expect(gpu.execution.backend).toBe("webgpu-f32");
    expect(a.outsideExpectedBound + a.outsideVarianceBound).toBe(0);
    expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
    console.log(`#715 48 x 36 region of a 2400 x 1600 photo: ${rows} rows x ${columns} columns from column ${col0}, ${bytes} B of records (full width: ${rows * 2400 * 16} B)`);
    runtime.destroy();
  }, scaledTimeout(600_000));
});
