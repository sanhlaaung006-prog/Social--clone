//! IRONVEIL deterministic terrain-noise core.
//!
//! This is a dependency-free Rust port of the JavaScript integer hash,
//! value-noise/FBM, base terrain, and rim-mountain functions in
//! `game/src/world.js`. River carving and spawn/relay flattening remain
//! JavaScript-side layout logic and are applied to the raw heights this
//! module returns. The compiled `.wasm` is shipped as a local asset, so
//! the game makes no network request to GitHub or any CDN for it.

#![allow(static_mut_refs)]

const MAX_SEGMENTS: usize = 96;
const MAX_VERTICES: usize = (MAX_SEGMENTS + 1) * (MAX_SEGMENTS + 1);

// Single-threaded scratch buffer. The JS loader copies the returned
// Float64Array view before the next batch call, so reusing one buffer
// keeps the ABI free of allocator ownership rules.
static mut OUT: [f64; MAX_VERTICES] = [0.0; MAX_VERTICES];
static mut LIGHT: [f32; MAX_VERTICES] = [1.0; MAX_VERTICES];

#[inline]
fn hash2(seed: u32, x: f64, z: f64) -> f64 {
    // Bit-exact port of JS Math.imul + unsigned-shift avalanche hash.
    let mut h = (x.floor() as i64 as u32).wrapping_mul(0x27d4_eb2d);
    h ^= (z.floor() as i64 as u32).wrapping_mul(0x1656_67b1);
    h ^= seed;
    h = (h ^ (h >> 15)).wrapping_mul(0x85eb_ca6b);
    h ^= h >> 13;
    h = h.wrapping_mul(0xc2b2_ae35);
    h ^= h >> 16;
    (h as f64) / 4_294_967_296.0
}

#[inline]
fn value_noise(seed: u32, x: f64, z: f64) -> f64 {
    let xi = x.floor();
    let zi = z.floor();
    let xf = x - xi;
    let zf = z - zi;
    // Quintic interpolation, mirrored from JS: C2 value noise without the
    // cubic lattice creases that made broad Myanmar lowland look square.
    let u = xf * xf * xf * (xf * (xf * 6.0 - 15.0) + 10.0);
    let v = zf * zf * zf * (zf * (zf * 6.0 - 15.0) + 10.0);
    let a = hash2(seed, xi, zi);
    let b = hash2(seed, xi + 1.0, zi);
    let c = hash2(seed, xi, zi + 1.0);
    let d = hash2(seed, xi + 1.0, zi + 1.0);
    a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

#[inline]
fn fbm(seed: u32, x: f64, z: f64, octaves: u32) -> f64 {
    let mut amp = 0.5;
    let mut sum = 0.0;
    let mut norm = 0.0;
    let mut px = x;
    let mut pz = z;
    for _ in 0..octaves {
        sum += amp * value_noise(seed, px, pz);
        norm += amp;
        amp *= 0.5;
        let nx = (px * 0.8 - pz * 0.6) * 2.03 + 11.31;
        let nz = (px * 0.6 + pz * 0.8) * 2.03 - 7.87;
        px = nx;
        pz = nz;
    }
    sum / norm
}

#[inline]
fn base_smoothstep(a: f64, b: f64, x: f64) -> f64 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[inline]
fn base_lerp(a: f64, b: f64, t: f64) -> f64 { a + (b - a) * t }

#[inline]
fn base_height(seed: u32, x: f64, z: f64, half: f64) -> f64 {
    // Myanmar-balanced sector, field-for-field with world.js: southern
    // delta/coast, central Dry-Zone lowland, and hill belts only to the
    // north/west plus a lower eastern plateau.
    let inv_half = 1.0 / half.max(1.0);
    let warp_x = (fbm(seed, x * 0.00125 + 31.7, z * 0.00125 - 18.2, 2) - 0.5) * 0.24;
    let warp_z = (fbm(seed, x * 0.00115 - 24.6, z * 0.00115 + 9.4, 2) - 0.5) * 0.24;
    let u = (x * inv_half + warp_x).clamp(-1.0, 1.0);
    let v = (z * inv_half + warp_z).clamp(-1.0, 1.0);
    let macro_n = fbm(seed, x * 0.00155 - 3.1, z * 0.00155 + 8.7, 3);
    let roll = fbm(seed, x * 0.0042 + 17.4, z * 0.0042 - 5.6, 3);
    let detail = fbm(seed, x * 0.011 - 9.8, z * 0.011 + 4.4, 2);
    let ridge_noise = fbm(seed, x * 0.0028 + 43.1, z * 0.0028 - 27.5, 3);
    let ridge_band = (1.0 - (ridge_noise * 2.0 - 1.0).abs()).clamp(0.0, 1.0);
    let ridge = ridge_band * ridge_band;

    let south = base_smoothstep(0.02, 0.48, v);
    let north = base_smoothstep(-0.05, -0.58, v);
    let west = base_smoothstep(-0.12, -0.66, u);
    let east = base_smoothstep(0.28, 0.78, u);
    let hills = (north.max(west * 0.92).max(east * 0.62) * (1.0 - south * 0.88)).clamp(0.0, 1.0);

    let delta_h = 2.2 + macro_n * 3.6 + roll * 1.15 + detail * 0.28;
    let dry_h = 9.0 + macro_n * 7.0 + roll * 3.4 + detail * 0.55;
    let hill_h = 19.0 + macro_n * 15.0 + ridge * 25.0 + roll * 6.5 + detail * 1.5;
    let mut h = base_lerp(dry_h, delta_h, south);
    h = base_lerp(h, hill_h, hills);

    let coast_line = 0.82 + (macro_n - 0.5) * 0.08;
    let coast = base_smoothstep(coast_line - 0.10, coast_line + 0.08, z * inv_half);
    base_lerp(h, -2.4 + roll * 0.7, coast)
}

#[inline]
fn rim_height(seed: u32, x: f64, z: f64, half: f64, rim_start: f64) -> f64 {
    let edge = x.abs().max(z.abs());
    if edge <= rim_start {
        return 0.0;
    }
    let width = (half - rim_start).max(1.0);
    let t = (edge - rim_start) / width;
    let shaped = ((3.1 * t.min(1.0)).exp() - 1.0) / ((3.1_f64).exp() - 1.0);
    let ridge = 0.72 + 0.55 * fbm(seed, x * 0.009 + 41.3, z * 0.009 - 23.8, 3);
    let beyond = if t > 1.0 { (t - 1.0) * width * 0.9 } else { 0.0 };
    let south_edge = if z > 0.0 && z.abs() >= x.abs() {
        base_smoothstep(rim_start, half, z) * base_smoothstep(-0.78, -0.18, x / half.max(1.0))
    } else {
        0.0
    };
    (shaped * 165.0 * ridge + beyond) * (1.0 - south_edge * 0.94)
}

#[inline]
fn raw_height(seed: u32, x: f64, z: f64, half: f64, rim_start: f64) -> f64 {
    base_height(seed, x, z, half) + rim_height(seed, x, z, half, rim_start)
}

#[no_mangle]
pub extern "C" fn ironveil_abi_version() -> u32 {
    5
}

/// Raw terrain height before JS-side river carving / objective flattening.
#[no_mangle]
pub extern "C" fn ironveil_raw_height(seed: u32, x: f64, z: f64, half: f64, rim_start: f64) -> f64 {
    raw_height(seed, x, z, half, rim_start)
}

#[no_mangle]
pub extern "C" fn ironveil_heights_ptr() -> *const f64 {
    core::ptr::addr_of!(OUT) as *const f64
}

#[no_mangle]
pub extern "C" fn ironveil_lighting_ptr() -> *const f32 {
    core::ptr::addr_of!(LIGHT) as *const f32
}

/// Baked per-vertex ambient occlusion from the raw height grid in OUT:
/// horizon slope over 8 directions at 1/2/4 cells plus a concavity
/// term, faded to exactly 1.0 at chunk borders so tiles never seam.
/// JS multiplies its terrain vertex colors by these factors (0.62..1.03).
unsafe fn compute_lighting_from(heights: *const f64, seg: usize, step: f64) {
    let n = seg + 1;
    let light = core::ptr::addr_of_mut!(LIGHT) as *mut f32;
    let at = |row: isize, col: isize| -> f64 {
        let r = row.clamp(0, seg as isize) as usize;
        let c = col.clamp(0, seg as isize) as usize;
        *heights.add(r * n + c)
    };
    const DIRS: [(isize, isize); 8] = [
        (-1, 0), (1, 0), (0, -1), (0, 1),
        (-1, -1), (-1, 1), (1, -1), (1, 1),
    ];
    for row in 0..n {
        for col in 0..n {
            let ri = row as isize;
            let ci = col as isize;
            let h = at(ri, ci);
            let avg4 = (at(ri - 1, ci) + at(ri + 1, ci) + at(ri, ci - 1) + at(ri, ci + 1)) * 0.25;
            let pit = ((avg4 - h).max(0.0) * 0.018).clamp(0.0, 0.18);
            let mut max_slope = 0.0_f64;
            for (dr, dc) in DIRS {
                let diag = if dr != 0 && dc != 0 { 1.41421356 } else { 1.0 };
                for d in [1_isize, 2, 4] {
                    let nh = at(ri + dr * d, ci + dc * d);
                    let slope = (nh - h) / (d as f64 * step * diag);
                    if slope > max_slope {
                        max_slope = slope;
                    }
                }
            }
            let occ = (max_slope * 0.55).clamp(0.0, 0.34);
            let edge = row.min(col).min(seg - row).min(seg - col) as f64;
            let ef = (edge / 3.0).clamp(0.0, 1.0);
            let fade = ef * ef * (3.0 - 2.0 * ef);
            let f = (1.03 - occ - pit).clamp(0.62, 1.03);
            *light.add(row * n + col) = (1.0 + (f - 1.0) * fade) as f32;
        }
    }
}

/// Fills the scratch buffer row-major: index = row * (segments + 1) + col,
/// where col walks +X from `min_x` and row walks +Z from `min_z`.
/// Returns the vertex count written, or 0 for an unsupported segment count.
#[no_mangle]
pub extern "C" fn ironveil_chunk_raw_heights(
    seed: u32,
    min_x: f64,
    min_z: f64,
    size_m: f64,
    segments: u32,
    half: f64,
    rim_start: f64,
) -> u32 {
    let seg = segments as usize;
    if seg == 0 || seg > MAX_SEGMENTS {
        return 0;
    }
    let n = seg + 1;
    let step = size_m / seg as f64;
    unsafe {
        let out = core::ptr::addr_of_mut!(OUT) as *mut f64;
        for row in 0..n {
            let z = min_z + row as f64 * step;
            for col in 0..n {
                let x = min_x + col as f64 * step;
                *out.add(row * n + col) = raw_height(seed, x, z, half, rim_start);
            }
        }
        compute_lighting_from(core::ptr::addr_of!(OUT) as *const f64, seg, step);
    }
    (n * n) as u32
}

// =============================== ABI v3 ===============================
// v3 expands the same offline, dependency-free core in four directions:
// (1) full chunk-mesh buffers, (2) local scatter batches, (3) drone
// LOS/tactical-waypoint batches + coarse A* paths, and (4) precomputed
// sky LUTs plus terrain splat/roughness data. Static scratch buffers are
// reused; JS copies out only the slices it needs.

const MAX_INDICES: usize = MAX_SEGMENTS * MAX_SEGMENTS * 6;
static mut FINAL: [f64; MAX_VERTICES] = [0.0; MAX_VERTICES];
static mut MESH_POS: [f32; MAX_VERTICES * 3] = [0.0; MAX_VERTICES * 3];
static mut MESH_NORM: [f32; MAX_VERTICES * 3] = [0.0; MAX_VERTICES * 3];
static mut MESH_COLOR: [f32; MAX_VERTICES * 3] = [0.0; MAX_VERTICES * 3];
// [rock, dry, wet, roughness] per vertex, consumed by the terrain shader.
static mut MESH_SPLAT: [f32; MAX_VERTICES * 4] = [0.0; MAX_VERTICES * 4];
static mut MESH_INDEX: [u32; MAX_INDICES] = [0; MAX_INDICES];

const MAX_SCATTER: usize = 2048;
const SCATTER_STRIDE: usize = 10; // kind,x,z,sx,sy,sz,rx,ry,rz,variant
static mut SCATTER: [f32; MAX_SCATTER * SCATTER_STRIDE] = [0.0; MAX_SCATTER * SCATTER_STRIDE];

const MAX_AI: usize = 32;
const AI_IN_STRIDE: usize = 6; // x,y,z,anchorX,anchorZ,hover
const AI_OUT_STRIDE: usize = 8; // dist,clear,threat,wayX,wayZ,wayY,minClear,clearRatio
static mut AI_IN: [f32; MAX_AI * AI_IN_STRIDE] = [0.0; MAX_AI * AI_IN_STRIDE];
static mut AI_OUT: [f32; MAX_AI * AI_OUT_STRIDE] = [0.0; MAX_AI * AI_OUT_STRIDE];

const PATH_GRID: usize = 40;
const PATH_NODES: usize = PATH_GRID * PATH_GRID;
const MAX_PATH: usize = 160;
static mut PATH_OUT: [f32; MAX_PATH * 2] = [0.0; MAX_PATH * 2];
static mut PATH_H: [f32; PATH_NODES] = [0.0; PATH_NODES];
static mut PATH_G: [f32; PATH_NODES] = [0.0; PATH_NODES];
static mut PATH_F: [f32; PATH_NODES] = [0.0; PATH_NODES];
static mut PATH_CAME: [i32; PATH_NODES] = [-1; PATH_NODES];
static mut PATH_STATE: [u8; PATH_NODES] = [0; PATH_NODES];
static mut PATH_STACK: [i32; PATH_NODES] = [-1; PATH_NODES];

const SKY_BINS: usize = 128;
const SKY_WEATHERS: usize = 3; // sunny, mist, monsoon
const SKY_CH: usize = 12; // zenith rgb, horizon rgb, sun rgb, cloud rgb
static mut SKY_LUT: [f32; SKY_WEATHERS * SKY_BINS * SKY_CH] = [0.0; SKY_WEATHERS * SKY_BINS * SKY_CH];
static mut SKY_READY: bool = false;

#[inline]
fn clamp01(x: f64) -> f64 { x.clamp(0.0, 1.0) }
#[inline]
fn sstep(a: f64, b: f64, x: f64) -> f64 {
    if a == b { return if x >= b { 1.0 } else { 0.0 }; }
    let t = clamp01((x - a) / (b - a));
    t * t * (3.0 - 2.0 * t)
}
#[inline]
fn mixf(a: f64, b: f64, t: f64) -> f64 { a + (b - a) * t }
#[inline]
fn mix3(a: [f64; 3], b: [f64; 3], t: f64) -> [f64; 3] {
    [mixf(a[0], b[0], t), mixf(a[1], b[1], t), mixf(a[2], b[2], t)]
}

#[no_mangle] pub extern "C" fn ironveil_final_heights_ptr() -> *mut f64 { core::ptr::addr_of_mut!(FINAL) as *mut f64 }
#[no_mangle] pub extern "C" fn ironveil_positions_ptr() -> *const f32 { core::ptr::addr_of!(MESH_POS) as *const f32 }
#[no_mangle] pub extern "C" fn ironveil_normals_ptr() -> *const f32 { core::ptr::addr_of!(MESH_NORM) as *const f32 }
#[no_mangle] pub extern "C" fn ironveil_colors_ptr() -> *const f32 { core::ptr::addr_of!(MESH_COLOR) as *const f32 }
#[no_mangle] pub extern "C" fn ironveil_splat_ptr() -> *const f32 { core::ptr::addr_of!(MESH_SPLAT) as *const f32 }
#[no_mangle] pub extern "C" fn ironveil_indices_ptr() -> *const u32 { core::ptr::addr_of!(MESH_INDEX) as *const u32 }
#[no_mangle] pub extern "C" fn ironveil_scatter_ptr() -> *const f32 { core::ptr::addr_of!(SCATTER) as *const f32 }
#[no_mangle] pub extern "C" fn ironveil_ai_in_ptr() -> *mut f32 { core::ptr::addr_of_mut!(AI_IN) as *mut f32 }
#[no_mangle] pub extern "C" fn ironveil_ai_out_ptr() -> *const f32 { core::ptr::addr_of!(AI_OUT) as *const f32 }
#[no_mangle] pub extern "C" fn ironveil_path_ptr() -> *const f32 { core::ptr::addr_of!(PATH_OUT) as *const f32 }
#[no_mangle] pub extern "C" fn ironveil_sky_lut_ptr() -> *const f32 { core::ptr::addr_of!(SKY_LUT) as *const f32 }
#[no_mangle] pub extern "C" fn ironveil_sky_bins() -> u32 { SKY_BINS as u32 }

/// Full chunk-mesh generation from final heights previously written by JS
/// (JS keeps river carving / objective flattening). Writes positions,
/// normals, vertex colors (including the v2 AO bake plus dry/wet splat
/// tinting), per-vertex splat/roughness, and u32 indices. The palette is
/// passed in from JS so season/terrain colors stay identical to fallback.
#[no_mangle]
pub extern "C" fn ironveil_build_chunk_mesh(
    seed: u32, min_x: f64, min_z: f64, size_m: f64, segments: u32,
    low_r: f64, low_g: f64, low_b: f64,
    mid_r: f64, mid_g: f64, mid_b: f64,
    rock_r: f64, rock_g: f64, rock_b: f64,
    peak_r: f64, peak_g: f64, peak_b: f64,
) -> u32 {
    let seg = segments as usize;
    if seg == 0 || seg > MAX_SEGMENTS { return 0; }
    let n = seg + 1;
    let step = size_m / seg as f64;
    let half_size = size_m * 0.5;
    unsafe {
        let heights = core::ptr::addr_of!(FINAL) as *const f64;
        compute_lighting_from(heights, seg, step);
        let light = core::ptr::addr_of!(LIGHT) as *const f32;
        let pos = core::ptr::addr_of_mut!(MESH_POS) as *mut f32;
        let norm = core::ptr::addr_of_mut!(MESH_NORM) as *mut f32;
        let color = core::ptr::addr_of_mut!(MESH_COLOR) as *mut f32;
        let splat = core::ptr::addr_of_mut!(MESH_SPLAT) as *mut f32;
        let index = core::ptr::addr_of_mut!(MESH_INDEX) as *mut u32;
        let at = |row: isize, col: isize| -> f64 {
            let r = row.clamp(0, seg as isize) as usize;
            let c = col.clamp(0, seg as isize) as usize;
            *heights.add(r * n + c)
        };
        for row in 0..n {
            for col in 0..n {
                let i = row * n + col;
                let ri = row as isize;
                let ci = col as isize;
                let h = at(ri, ci);
                let wx = min_x + col as f64 * step;
                let wz = min_z + row as f64 * step;
                let span_x = ((if col < seg { 1.0 } else { 0.0 }) + (if col > 0 { 1.0 } else { 0.0 })) * step;
                let span_z = ((if row < seg { 1.0 } else { 0.0 }) + (if row > 0 { 1.0 } else { 0.0 })) * step;
                let gx = (at(ri, ci + 1) - at(ri, ci - 1)) / (if span_x == 0.0 { step } else { span_x });
                let gz = (at(ri + 1, ci) - at(ri - 1, ci)) / (if span_z == 0.0 { step } else { span_z });
                let inv_len = 1.0 / (gx * gx + 1.0 + gz * gz).sqrt();
                let ny = inv_len;
                let slope = 1.0 - ny;
                *pos.add(i * 3) = (-half_size + col as f64 * step) as f32;
                *pos.add(i * 3 + 1) = h as f32;
                *pos.add(i * 3 + 2) = (-half_size + row as f64 * step) as f32;
                *norm.add(i * 3) = (-gx * inv_len) as f32;
                *norm.add(i * 3 + 1) = ny as f32;
                *norm.add(i * 3 + 2) = (-gz * inv_len) as f32;

                let mut c = mix3([low_r, low_g, low_b], [mid_r, mid_g, mid_b], sstep(2.0, 26.0, h));
                c = mix3(c, [peak_r, peak_g, peak_b], sstep(38.0, 78.0, h) * 0.8);

                let moisture = fbm(seed ^ 0x9e37_79b9, wx * 0.0035 + 8.4, wz * 0.0035 - 2.7, 3);
                let dry_noise = fbm(seed ^ 0x51f2_7a35, wx * 0.006 - 5.1, wz * 0.006 + 11.9, 3);
                let avg4 = (at(ri - 1, ci) + at(ri + 1, ci) + at(ri, ci - 1) + at(ri, ci + 1)) * 0.25;
                let concavity = avg4 - h;
                let wet = (sstep(9.0, 2.0, h) * sstep(0.42, 0.78, moisture)
                    + sstep(0.35, 2.4, concavity) * 0.38).clamp(0.0, 1.0);
                let dry = sstep(0.55, 0.86, dry_noise) * (1.0 - wet);
                let rock = sstep(0.2, 0.55, slope).max(sstep(52.0, 92.0, h) * 0.68);
                // Linear-space biome tints matching the JS palette: vivid
                // delta green, warm Dry-Zone patches, deep hill forest and
                // a pale beach at sea level. Elevation bands are reliable
                // here because the height model itself is biome-authored.
                c = mix3(c, [0.072, 0.324, 0.048], sstep(10.0, 5.0, h) * sstep(0.38, 0.72, moisture) * 0.55);
                c = mix3(c, [0.399, 0.252, 0.078], dry * sstep(7.0, 13.0, h) * (1.0 - sstep(24.0, 38.0, h)) * 0.48);
                c = mix3(c, [0.017, 0.109, 0.026], sstep(20.0, 34.0, h) * sstep(0.42, 0.74, moisture) * 0.48);
                c = mix3(c, [c[0] * 0.55, c[1] * 0.72, c[2] * 0.58], wet * 0.38);
                c = mix3(c, [0.478, 0.331, 0.141], sstep(2.6, 0.5, h) * (1.0 - sstep(0.12, 0.32, slope)) * 0.72);
                c = mix3(c, [rock_r, rock_g, rock_b], sstep(0.18, 0.5, slope));
                let shade = (0.90 + 0.10 * hash2(seed, wx * 3.1, wz * 3.1))
                    * (*light.add(i) as f64) * (0.94 + 0.06 * ny);
                *color.add(i * 3) = (c[0] * shade) as f32;
                *color.add(i * 3 + 1) = (c[1] * shade) as f32;
                *color.add(i * 3 + 2) = (c[2] * shade) as f32;
                let roughness = (0.97 - wet * 0.5 - rock * 0.1 - sstep(55.0, 95.0, h) * 0.08).clamp(0.36, 1.0);
                *splat.add(i * 4) = rock as f32;
                *splat.add(i * 4 + 1) = dry as f32;
                *splat.add(i * 4 + 2) = wet as f32;
                *splat.add(i * 4 + 3) = roughness as f32;
            }
        }
        let mut k = 0usize;
        for row in 0..seg {
            for col in 0..seg {
                let a = (row * n + col) as u32;
                let b = a + 1;
                let c = a + n as u32;
                let d = c + 1;
                *index.add(k) = a; *index.add(k + 1) = c; *index.add(k + 2) = b;
                *index.add(k + 3) = b; *index.add(k + 4) = c; *index.add(k + 5) = d;
                k += 6;
            }
        }
    }
    (n * n) as u32
}

/// Deterministic local scatter batch around a camera position. Kind 0 is
/// the 6m pebble grid and kind 1 the 4m grass grid; formulas mirror the
/// JS fallback exactly. JS still performs river/objective rejection and
/// final-height placement.
#[no_mangle]
pub extern "C" fn ironveil_scatter_local(seed: u32, kind: u32, cx: f64, cz: f64, radius: f64) -> u32 {
    let cell = if kind == 0 { 6.0 } else { 4.0 };
    let gx0 = ((cx - radius) / cell).floor() as i32;
    let gx1 = ((cx + radius) / cell).floor() as i32;
    let gz0 = ((cz - radius) / cell).floor() as i32;
    let gz1 = ((cz + radius) / cell).floor() as i32;
    let mut count = 0usize;
    unsafe {
        let out = core::ptr::addr_of_mut!(SCATTER) as *mut f32;
        for gx in gx0..=gx1 {
            for gz in gz0..=gz1 {
                if count >= MAX_SCATTER { return count as u32; }
                let fx = gx as f64;
                let fz = gz as f64;
                let (x, z, sx, sy, sz, rx, ry, rz, variant);
                if kind == 0 {
                    if hash2(seed, fx * 19.0 + 401.0, fz * 23.0 - 137.0) < 0.24 { continue; }
                    x = (fx + 0.18 + hash2(seed, fx * 7.0 - 31.0, fz * 11.0 + 71.0) * 0.64) * cell;
                    z = (fz + 0.18 + hash2(seed, fx * 13.0 + 97.0, fz * 5.0 - 53.0) * 0.64) * cell;
                    let s = 0.13 + hash2(seed, fx * 29.0 + 3.0, fz * 31.0 + 9.0) * 0.34;
                    sx = s; sy = s * 0.62; sz = s * (0.75 + hash2(seed, fx + 2.0, fz + 2.0) * 0.45);
                    rx = hash2(seed, fx, fz) * 3.0;
                    ry = hash2(seed, fx + 9.0, fz - 4.0) * 3.0;
                    rz = hash2(seed, fx - 6.0, fz + 8.0) * 3.0;
                    variant = s;
                } else {
                    if hash2(seed, fx * 37.0 - 811.0, fz * 41.0 + 609.0) < 0.12 { continue; }
                    x = (fx + 0.2 + hash2(seed, fx * 17.0 + 19.0, fz * 19.0 - 23.0) * 0.6) * cell;
                    z = (fz + 0.2 + hash2(seed, fx * 23.0 - 41.0, fz * 29.0 + 13.0) * 0.6) * cell;
                    let s = 0.75 + hash2(seed, fx * 53.0 + 7.0, fz * 59.0 - 5.0) * 0.85;
                    sx = s; sy = s; sz = s;
                    rx = 0.0; ry = hash2(seed, fx * 43.0, fz * 47.0) * core::f64::consts::TAU; rz = 0.0;
                    variant = s;
                }
                let o = count * SCATTER_STRIDE;
                *out.add(o) = kind as f32;
                *out.add(o + 1) = x as f32; *out.add(o + 2) = z as f32;
                *out.add(o + 3) = sx as f32; *out.add(o + 4) = sy as f32; *out.add(o + 5) = sz as f32;
                *out.add(o + 6) = rx as f32; *out.add(o + 7) = ry as f32; *out.add(o + 8) = rz as f32;
                *out.add(o + 9) = variant as f32;
                count += 1;
            }
        }
    }
    count as u32
}

fn los_stats(seed: u32, x1: f64, y1: f64, z1: f64, x2: f64, y2: f64, z2: f64, half: f64, rim_start: f64) -> (bool, f64, f64) {
    const SAMPLES: u32 = 28;
    let mut min_clear = 1.0e9;
    let mut blocked = 0u32;
    for k in 1..SAMPLES {
        let t = k as f64 / SAMPLES as f64;
        let x = mixf(x1, x2, t);
        let y = mixf(y1, y2, t);
        let z = mixf(z1, z2, t);
        let clear = y - raw_height(seed, x, z, half, rim_start);
        if clear < min_clear { min_clear = clear; }
        if clear < 0.45 { blocked += 1; }
    }
    (blocked == 0, 1.0 - blocked as f64 / (SAMPLES - 1) as f64, min_clear)
}

/// Batch drone spatial query: distance, terrain LOS to the player, threat
/// score, and a tactical waypoint inside each drone's 28m anchor leash.
#[no_mangle]
pub extern "C" fn ironveil_ai_batch(
    seed: u32, count: u32, px: f64, py: f64, pz: f64, los_m: f64, half: f64, rim_start: f64,
) -> u32 {
    let n = (count as usize).min(MAX_AI);
    unsafe {
        let input = core::ptr::addr_of!(AI_IN) as *const f32;
        let out = core::ptr::addr_of_mut!(AI_OUT) as *mut f32;
        for i in 0..n {
            let x = *input.add(i * AI_IN_STRIDE) as f64;
            let y = *input.add(i * AI_IN_STRIDE + 1) as f64;
            let z = *input.add(i * AI_IN_STRIDE + 2) as f64;
            let ax = *input.add(i * AI_IN_STRIDE + 3) as f64;
            let az = *input.add(i * AI_IN_STRIDE + 4) as f64;
            let hover = *input.add(i * AI_IN_STRIDE + 5) as f64;
            let dist = ((x - px) * (x - px) + (z - pz) * (z - pz)).sqrt();
            let (clear, ratio, min_clear) = los_stats(seed, x, y, z, px, py, pz, half, rim_start);
            let threat = if clear { (1.15 - dist / los_m.max(1.0)).clamp(0.0, 1.0) } else { 0.0 };
            let base_angle = (pz - az).atan2(px - ax);
            let mut best_score = -1.0e9;
            let mut best = (ax, az, raw_height(seed, ax, az, half, rim_start) + hover);
            for radius in [8.0, 16.0, 24.0, 28.0] {
                for off in [-1.0, -0.6, -0.3, 0.0, 0.3, 0.6, 1.0] {
                    let a = base_angle + off;
                    let wx = ax + a.cos() * radius;
                    let wz = az + a.sin() * radius;
                    let wy = raw_height(seed, wx, wz, half, rim_start) + hover + 1.0;
                    let (cclear, cratio, cmin) = los_stats(seed, wx, wy, wz, px, py, pz, half, rim_start);
                    let wd = ((wx - px) * (wx - px) + (wz - pz) * (wz - pz)).sqrt();
                    let mut score = cratio * 3.0 + cmin.min(4.0) * 0.18 - (wd - 55.0).abs() / 45.0;
                    if cclear { score += 2.0; }
                    if score > best_score { best_score = score; best = (wx, wz, wy); }
                }
            }
            let o = i * AI_OUT_STRIDE;
            *out.add(o) = dist as f32;
            *out.add(o + 1) = if clear { 1.0 } else { 0.0 };
            *out.add(o + 2) = threat as f32;
            *out.add(o + 3) = best.0 as f32;
            *out.add(o + 4) = best.1 as f32;
            *out.add(o + 5) = best.2 as f32;
            *out.add(o + 6) = min_clear as f32;
            *out.add(o + 7) = ratio as f32;
        }
    }
    n as u32
}

/// Coarse 40x40 A* over raw terrain around the start/goal box. Returns a
/// simplified XZ path in PATH_OUT; used occasionally for blocked drones,
/// not in the per-frame loop.
#[no_mangle]
pub extern "C" fn ironveil_find_path(
    seed: u32, sx: f64, sz: f64, gx: f64, gz: f64, half: f64, rim_start: f64,
) -> u32 {
    let cx = (sx + gx) * 0.5;
    let cz = (sz + gz) * 0.5;
    let span = ((gx - sx).abs().max((gz - sz).abs()) + 72.0).clamp(80.0, 420.0);
    let min_x = cx - span * 0.5;
    let min_z = cz - span * 0.5;
    let cell = span / (PATH_GRID - 1) as f64;
    let node_x = |idx: usize| min_x + (idx % PATH_GRID) as f64 * cell;
    let node_z = |idx: usize| min_z + (idx / PATH_GRID) as f64 * cell;
    let nearest = |x: f64, z: f64| -> usize {
        let ix = (((x - min_x) / cell).round() as isize).clamp(0, (PATH_GRID - 1) as isize) as usize;
        let iz = (((z - min_z) / cell).round() as isize).clamp(0, (PATH_GRID - 1) as isize) as usize;
        iz * PATH_GRID + ix
    };
    let start = nearest(sx, sz);
    let goal = nearest(gx, gz);
    unsafe {
        let hptr = core::ptr::addr_of_mut!(PATH_H) as *mut f32;
        let gptr = core::ptr::addr_of_mut!(PATH_G) as *mut f32;
        let fptr = core::ptr::addr_of_mut!(PATH_F) as *mut f32;
        let came = core::ptr::addr_of_mut!(PATH_CAME) as *mut i32;
        let state = core::ptr::addr_of_mut!(PATH_STATE) as *mut u8;
        for i in 0..PATH_NODES {
            *hptr.add(i) = raw_height(seed, node_x(i), node_z(i), half, rim_start) as f32;
            *gptr.add(i) = 1.0e30; *fptr.add(i) = 1.0e30; *came.add(i) = -1; *state.add(i) = 0;
        }
        let heuristic = |idx: usize| -> f32 {
            let dx = node_x(idx) - gx;
            let dz = node_z(idx) - gz;
            (dx * dx + dz * dz).sqrt() as f32
        };
        *gptr.add(start) = 0.0; *fptr.add(start) = heuristic(start); *state.add(start) = 1;
        let mut found = false;
        for _ in 0..PATH_NODES {
            let mut current = usize::MAX;
            let mut best_f = 1.0e30f32;
            for i in 0..PATH_NODES {
                if *state.add(i) == 1 && *fptr.add(i) < best_f { best_f = *fptr.add(i); current = i; }
            }
            if current == usize::MAX { break; }
            if current == goal { found = true; break; }
            *state.add(current) = 2;
            let cx_i = (current % PATH_GRID) as isize;
            let cz_i = (current / PATH_GRID) as isize;
            let ch = *hptr.add(current) as f64;
            for dz in -1isize..=1 {
                for dx in -1isize..=1 {
                    if dx == 0 && dz == 0 { continue; }
                    let nx = cx_i + dx;
                    let nz = cz_i + dz;
                    if nx < 0 || nz < 0 || nx >= PATH_GRID as isize || nz >= PATH_GRID as isize { continue; }
                    let ni = nz as usize * PATH_GRID + nx as usize;
                    if *state.add(ni) == 2 { continue; }
                    let step = cell * if dx != 0 && dz != 0 { 1.41421356 } else { 1.0 };
                    let nh = *hptr.add(ni) as f64;
                    let slope = (nh - ch).abs() / step.max(0.001);
                    let mut cost = step * (1.0 + slope * 2.2);
                    if slope > 1.1 { cost *= 3.5; }
                    if nh < 1.5 { cost += 8.0; }
                    if nh > 85.0 { cost += (nh - 85.0) * 0.15; }
                    let tentative = *gptr.add(current) + cost as f32;
                    if tentative < *gptr.add(ni) {
                        *gptr.add(ni) = tentative;
                        *fptr.add(ni) = tentative + heuristic(ni);
                        *came.add(ni) = current as i32;
                        *state.add(ni) = 1;
                    }
                }
            }
        }
        if !found { return 0; }
        let stack = core::ptr::addr_of_mut!(PATH_STACK) as *mut i32;
        let mut len = 0usize;
        let mut cur = goal as i32;
        while cur >= 0 && len < PATH_NODES {
            *stack.add(len) = cur; len += 1;
            if cur as usize == start { break; }
            cur = *came.add(cur as usize);
        }
        let out = core::ptr::addr_of_mut!(PATH_OUT) as *mut f32;
        let mut count = 0usize;
        let mut k = 0usize;
        while k < len && count < MAX_PATH {
            let idx = *stack.add(len - 1 - k) as usize;
            if k % 3 == 0 || k + 1 == len {
                *out.add(count * 2) = node_x(idx) as f32;
                *out.add(count * 2 + 1) = node_z(idx) as f32;
                count += 1;
            }
            k += 1;
        }
        count as u32
    }
}

/// Builds the offline sky/cloud LUT: 3 weathers x 128 cycle bins x
/// [zenith, horizon, sun, cloud] sRGB colors. JS copies it once and then
/// samples/interpolates locally per frame.
#[no_mangle]
pub extern "C" fn ironveil_build_sky_lut() -> u32 {
    unsafe {
        if SKY_READY { return SKY_BINS as u32; }
        let out = core::ptr::addr_of_mut!(SKY_LUT) as *mut f32;
        let zen_day = [63.0, 118.0, 184.0]; let zen_night = [3.0, 5.0, 16.0];
        let hor_day = [183.0, 200.0, 174.0]; let hor_night = [10.0, 17.0, 28.0];
        let hor_dusk = [224.0, 145.0, 79.0];
        let sun_low = [255.0, 148.0, 72.0]; let sun_high = [255.0, 242.0, 216.0];
        let tints = [[215.0, 228.0, 194.0], [216.0, 221.0, 214.0], [95.0, 113.0, 98.0]];
        let strengths = [0.08, 0.72, 0.68];
        let clouds = [0.05, 0.55, 0.9];
        for weather in 0..SKY_WEATHERS {
            for bin in 0..SKY_BINS {
                let cycle = bin as f64 / SKY_BINS as f64;
                let th = cycle * core::f64::consts::TAU;
                let elev = th.sin();
                let daylight = sstep(-0.06, 0.28, elev);
                let nightness = 1.0 - sstep(-0.32, -0.04, elev);
                let duskness = (1.0 - (elev + 0.02).abs() / 0.3).clamp(0.0, 1.0) * (1.0 - nightness * 0.55);
                let cloud_amt = clouds[weather];
                let mut horizon = mix3(hor_night, hor_day, daylight);
                horizon = mix3(horizon, hor_dusk, duskness * 0.72);
                horizon = mix3(horizon, tints[weather], strengths[weather] * (0.35 + 0.65 * daylight));
                let gray = (horizon[0] + horizon[1] + horizon[2]) / 3.0;
                let mut cloud = mix3(horizon, [gray, gray, gray], cloud_amt * 0.5);
                cloud = mix3(cloud, tints[weather], 0.35);
                let darken = 1.0 - cloud_amt * 0.22 * daylight;
                cloud = [cloud[0] * darken, cloud[1] * darken, cloud[2] * darken];
                let mut zenith = mix3(zen_night, zen_day, daylight);
                zenith = mix3(zenith, cloud, cloud_amt * 0.42 * daylight);
                horizon = mix3(horizon, cloud, cloud_amt * 0.28 * daylight);
                let sun = mix3(sun_low, sun_high, (elev * 1.7).clamp(0.0, 1.0));
                let base = (weather * SKY_BINS + bin) * SKY_CH;
                let cols = [zenith, horizon, sun, cloud];
                for (ci, col) in cols.iter().enumerate() {
                    *out.add(base + ci * 3) = (col[0] / 255.0) as f32;
                    *out.add(base + ci * 3 + 1) = (col[1] / 255.0) as f32;
                    *out.add(base + ci * 3 + 2) = (col[2] / 255.0) as f32;
                }
            }
        }
        SKY_READY = true;
    }
    SKY_BINS as u32
}

// =============================== ABI v4 ===============================
// Deterministic heightfield character physics. The host supplies final
// ground height through an imported callback (main thread: river + bridge
// aware terrainHeight; tests: an analytic ground). The complete
// state/input/output contract is one reusable [f64; 32] buffer mirrored
// field-for-field by game/src/physics.js. The equations are an original
// meter-scale synthesis of projection-capped Quake-style acceleration and
// control-speed friction plus heightfield step-up/slope/contour sliding.

#[link(wasm_import_module = "env")]
extern "C" {
    fn ironveil_ground_height(x: f64, z: f64) -> f64;
}

static mut PHYS: [f64; 32] = [0.0; 32];

#[no_mangle]
pub extern "C" fn ironveil_physics_ptr() -> *mut f64 {
    core::ptr::addr_of_mut!(PHYS) as *mut f64
}

#[inline]
fn phys_ground(x: f64, z: f64) -> f64 {
    unsafe { ironveil_ground_height(x, z) }
}

#[inline]
fn phys_sample(x: f64, z: f64, out: &mut [f64; 4]) {
    const EPS: f64 = 0.6;
    let h = phys_ground(x, z);
    let gx = (phys_ground(x + EPS, z) - phys_ground(x - EPS, z)) / (EPS * 2.0);
    let gz = (phys_ground(x, z + EPS) - phys_ground(x, z - EPS)) / (EPS * 2.0);
    let inv = 1.0 / (gx * gx + 1.0 + gz * gz).sqrt();
    out[0] = h;
    out[1] = -gx * inv;
    out[2] = inv;
    out[3] = -gz * inv;
}

#[no_mangle]
pub extern "C" fn ironveil_physics_step() -> u32 {
    unsafe {
        let b = &mut *core::ptr::addr_of_mut!(PHYS);
        let px = b[0]; let py = b[1]; let pz = b[2];
        let mut vx = b[3]; let mut vy = b[4]; let mut vz = b[5];
        let was_grounded = b[6] > 0.5;
        let mut coyote = b[7];
        let dt = b[8];
        let wish_x = b[9]; let wish_z = b[10]; let wish_speed = b[11];
        let jump = b[12] > 0.5;
        let ground_accel = b[13]; let air_accel = b[14]; let friction = b[15];
        let stop_speed = b[16]; let air_wish_cap = b[17]; let gravity = b[18];
        let jump_speed = b[19]; let step_height = b[20]; let snap_distance = b[21];
        let walk_normal_y = b[22]; let slope_gravity_scale = b[23];

        let start_y = py;
        let mut sm = [0.0; 4];
        phys_sample(px, pz, &mut sm);
        let start_ground_y = sm[0]; let snx = sm[1]; let sny = sm[2]; let snz = sm[3];

        let mut grounded = was_grounded;
        let mut sliding = grounded && sny < walk_normal_y && py <= start_ground_y + 0.65;

        if grounded && !sliding {
            let speed = vx.hypot(vz);
            if speed > 0.0001 {
                let control = speed.max(stop_speed);
                let next = (speed - control * friction * dt).max(0.0);
                let scale = next / speed;
                vx *= scale; vz *= scale;
            }
        }

        let mut jumped = false;
        if jump && !sliding && (grounded || coyote > 0.0) {
            vy = jump_speed;
            grounded = false;
            coyote = 0.0;
            jumped = true;
        }

        if !sliding {
            let wish_len = wish_x.hypot(wish_z);
            if wish_len > 0.000001 && wish_speed > 0.0 {
                let dir_scale = 1.0 / wish_len;
                let dir_x = wish_x * dir_scale;
                let dir_z = wish_z * dir_scale;
                let effective_speed = wish_speed * wish_len.min(1.0);
                let current = vx * dir_x + vz * dir_z;
                let target = if grounded { effective_speed } else { effective_speed.min(air_wish_cap) };
                let add = target - current;
                if add > 0.0 {
                    let accel = if grounded { ground_accel } else { air_accel };
                    let delta = (accel * effective_speed * dt).min(add);
                    vx += dir_x * delta;
                    vz += dir_z * delta;
                }
            }
        }

        if was_grounded && !jumped {
            let scale = if sliding { 1.0 } else { slope_gravity_scale };
            vx += -gravity * sny * snx * scale * dt;
            vz += -gravity * sny * snz * scale * dt;
        }

        if grounded {
            if vy < 0.0 { vy = 0.0; }
        } else {
            vy = (vy + gravity * dt).max(-38.0);
        }

        let mut next_x = px + vx * dt;
        let mut next_z = pz + vz * dt;
        let mut next_y = py + vy * dt;
        phys_sample(next_x, next_z, &mut sm);
        let mut ground_y = sm[0]; let mut nnx = sm[1]; let mut nny = sm[2]; let mut nnz = sm[3];

        let mut now_grounded = false;
        let mut landed_impact = 0.0;
        let mut blocked = 0.0;
        let mut resolved = false;

        if next_y <= ground_y {
            let rise = ground_y - start_y;
            let walking_wall = was_grounded && rise > step_height && vy <= 0.5;
            let air_wall = !was_grounded && rise > step_height && vy > -6.0;
            if walking_wall || air_wall {
                blocked = 1.0;
                let mut ux = -nnx; let mut uz = -nnz;
                let ul = ux.hypot(uz);
                if ul > 0.000001 {
                    ux /= ul; uz /= ul;
                    let mut dx = next_x - px; let mut dz = next_z - pz;
                    let into = dx * ux + dz * uz;
                    if into > 0.0 { dx -= ux * into; dz -= uz * into; }
                    let cx2 = px + dx; let cz2 = pz + dz;
                    phys_sample(cx2, cz2, &mut sm);
                    let g2 = sm[0]; let n2x = sm[1]; let n2y = sm[2]; let n2z = sm[3];
                    if !(next_y <= g2 && g2 - start_y > step_height) {
                        next_x = cx2; next_z = cz2;
                        let vin = vx * ux + vz * uz;
                        if vin > 0.0 { vx -= ux * vin; vz -= uz * vin; }
                        ground_y = g2; nnx = n2x; nny = n2y; nnz = n2z;
                    } else {
                        next_x = px; next_z = pz;
                        let vin = vx * ux + vz * uz;
                        if vin > 0.0 { vx -= ux * vin; vz -= uz * vin; }
                        phys_sample(next_x, next_z, &mut sm);
                        ground_y = sm[0]; nnx = sm[1]; nny = sm[2]; nnz = sm[3];
                        if was_grounded && next_y <= ground_y + snap_distance {
                            next_y = ground_y;
                            now_grounded = true;
                            vy = 0.0;
                        } else if next_y < ground_y {
                            next_y = ground_y;
                        }
                        resolved = true;
                    }
                }
            }

            if !resolved && next_y <= ground_y {
                if vy <= 0.0 {
                    landed_impact = if was_grounded { 0.0 } else { -vy };
                    next_y = ground_y;
                    now_grounded = true;
                    if landed_impact > 8.0 {
                        let damp = (1.0 - (landed_impact - 8.0) * 0.03).clamp(0.5, 1.0);
                        vx *= damp; vz *= damp;
                    }
                    vy = 0.0;
                } else if ground_y - start_y <= step_height {
                    next_y = ground_y;
                } else {
                    blocked = 1.0;
                    next_x = px; next_z = pz;
                    phys_sample(next_x, next_z, &mut sm);
                    ground_y = sm[0]; nnx = sm[1]; nny = sm[2]; nnz = sm[3];
                    if next_y < ground_y { next_y = ground_y; }
                }
            }
        }

        if !now_grounded && was_grounded && !jumped && vy <= 0.0
            && next_y <= ground_y + snap_distance && next_y >= ground_y - 0.02 {
            if next_y < ground_y { next_y = ground_y; }
            else { next_y += (ground_y - next_y) * (dt * 20.0).min(1.0); }
            now_grounded = true;
            vy = 0.0;
        }

        sliding = now_grounded && nny < walk_normal_y;
        coyote = if now_grounded { 0.12 } else if jumped { 0.0 } else { (coyote - dt).max(0.0) };

        b[0] = next_x; b[1] = next_y; b[2] = next_z;
        b[3] = vx; b[4] = vy; b[5] = vz;
        b[6] = if now_grounded { 1.0 } else { 0.0 };
        b[7] = coyote;
        b[24] = ground_y; b[25] = nnx; b[26] = nny; b[27] = nnz;
        b[28] = landed_impact;
        b[29] = if sliding { 1.0 } else { 0.0 };
        b[30] = blocked;
        b[31] = vx.hypot(vz);
    }
    1
}

// =============================== ABI v5 ===============================
// Safety-report sink for the anti-underground sweep. Reports are kept in
// a fixed 32-entry ring (stride 6: code, x, y, z, groundY, simSeconds),
// so reporting a rescue never allocates in either JS or Rust.
static mut SAFETY_REPORTS: [f64; 32 * 6] = [0.0; 32 * 6];
static mut SAFETY_REPORT_COUNT: u32 = 0;

#[no_mangle]
pub extern "C" fn ironveil_safety_reports_ptr() -> *const f64 {
    core::ptr::addr_of!(SAFETY_REPORTS) as *const f64
}

#[no_mangle]
pub extern "C" fn ironveil_safety_report_count() -> u32 {
    unsafe { *core::ptr::addr_of!(SAFETY_REPORT_COUNT) }
}

#[no_mangle]
pub extern "C" fn ironveil_safety_report(
    code: u32, x: f64, y: f64, z: f64, ground_y: f64, sim_seconds: f64,
) -> u32 {
    unsafe {
        let count = *core::ptr::addr_of!(SAFETY_REPORT_COUNT);
        let base = ((count % 32) * 6) as usize;
        let reports = &mut *core::ptr::addr_of_mut!(SAFETY_REPORTS);
        reports[base] = code as f64;
        reports[base + 1] = x;
        reports[base + 2] = y;
        reports[base + 3] = z;
        reports[base + 4] = ground_y;
        reports[base + 5] = sim_seconds;
        let next = count.wrapping_add(1);
        *core::ptr::addr_of_mut!(SAFETY_REPORT_COUNT) = next;
        next
    }
}
