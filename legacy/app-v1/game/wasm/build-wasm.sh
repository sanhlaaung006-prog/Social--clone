#!/usr/bin/env bash
#
# Build math_core.c -> public/wasm/math_core.wasm using clang's
# WebAssembly target (lld provides wasm-ld; install both on Debian/Ubuntu
# with: sudo apt-get install clang lld).
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="$ROOT/game/wasm/native"
OUT_DIR="$ROOT/public/wasm"
OUT="$OUT_DIR/math_core.wasm"

mkdir -p "$OUT_DIR"

clang --target=wasm32 \
  -O2 \
  -nostdlib \
  -mbulk-memory \
  -Wl,--no-entry \
  -Wl,--export-all \
  -Wl,--allow-undefined \
  -o "$OUT" "$SRC_DIR/math_core.c" "$SRC_DIR/physics_core.c"

echo "Built $OUT ($(wc -c < "$OUT") bytes)"
