// SPDX-License-Identifier: Apache-2.0

/**
 * #593, #601: the default form of the display view's coupled GPU steps (no coupled step), statically part of the kernels; the
 * coupled steps themselves (`wgsl-display-view-coupled.ts`) are loaded on demand, only for a view that asks for them.
 */

/** The functions' shared declarations (both forms). */
export const DISPLAY_VIEW_COUPLED_DECLARATIONS_WGSL = /* wgsl */ `
struct CpOut { hm: vec3<f32>, hv: vec3<f32>, a0: vec3<f32>, a1: vec3<f32>, a2: vec3<f32>, bm: vec3<f32>, bv: vec3<f32>, ju: f32, flag: bool, top: bool };
fn cp_on() -> bool { return cp_k(0u) != 0.0; }
`;

/**
 * #605: the kernels' default form of the GPU neighbor highlight reconstruction (`wgsl-display-view-neighbors.ts`): no ratios,
 * every pixel computed in one dispatch.
 */
export const DISPLAY_VIEW_NEIGHBORS_STUB_WGSL = /* wgsl */ `
fn nb_skip(i: u32) -> bool { return false; }
fn nb_ratio(i: u32, j: u32) -> bool { return true; }
fn nb_flag() -> u32 { return 0u; }`;

/** The default form: no coupled step (the buffer holds one zero word). */
export const DISPLAY_VIEW_COUPLED_STUB_WGSL = DISPLAY_VIEW_NEIGHBORS_STUB_WGSL + /* wgsl */ `${DISPLAY_VIEW_COUPLED_DECLARATIONS_WGSL}
fn cp_zero() -> CpOut { var t: CpOut; return t; }
fn cp_luminance() -> bool { return false; }
fn cp_reconstruct() -> bool { return false; }
fn cp_desaturate() -> bool { return false; }
fn cp_reconstruct_reach(cm: vec3<f32>, cv: vec3<f32>) -> u32 { return 0u; }
fn cp_tone(mu: vec3<f32>, s0: vec3<f32>, s1: vec3<f32>, s2: vec3<f32>, dmu: vec3<f32>, dsv: vec3<f32>) -> CpOut { return cp_zero(); }
fn cp_chain(cm: vec3<f32>, c00: f32, c01: f32, c02: f32, c11: f32, c12: f32, c22: f32, dcm: vec3<f32>, dcv: vec3<f32>) -> CpOut { return cp_zero(); }
`;

