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
    let u = xf * xf * (3.0 - 2.0 * xf);
    let v = zf * zf * (3.0 - 2.0 * zf);
    let a = hash2(seed, xi, zi);
    let b = hash2(seed, xi + 1.0, zi);
    let c = hash2(seed, xi, zi + 1.0);
    let d = hash2(seed, xi + 1.0, zi + 1.0);
    a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

#[inline]
fn fbm(seed: u32, x: f64, z: f64, octaves: u32) -> f64 {
    let mut amp = 0.5;
    let mut freq = 1.0;
    let mut sum = 0.0;
    let mut norm = 0.0;
    for _ in 0..octaves {
        sum += amp * value_noise(seed, x * freq, z * freq);
        norm += amp;
        amp *= 0.5;
        freq *= 2.03;
    }
    sum / norm
}

#[inline]
fn base_height(seed: u32, x: f64, z: f64) -> f64 {
    let mut h = fbm(seed, x * 0.011 + 13.7, z * 0.011 - 4.2, 5) * 30.0;
    let n = fbm(seed, x * 0.0038 - 7.1, z * 0.0038 + 9.3, 3);
    h += n * n * 46.0;
    h
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
    shaped * 165.0 * ridge + beyond
}

#[inline]
fn raw_height(seed: u32, x: f64, z: f64, half: f64, rim_start: f64) -> f64 {
    base_height(seed, x, z) + rim_height(seed, x, z, half, rim_start)
}

#[no_mangle]
pub extern "C" fn ironveil_abi_version() -> u32 {
    1
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
    }
    (n * n) as u32
}
