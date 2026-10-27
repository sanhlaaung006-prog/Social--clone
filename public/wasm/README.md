# WASM output directory

`math_core.wasm` is built here from `../../game/wasm/native/math_core.c`:

```bash
npm run build:wasm   # requires clang + lld: apt install clang lld
```

CI (`.github/workflows/ci.yml`) builds it on every push and uploads it as the
`math-core-wasm` artifact. The compiled `.wasm` is git-ignored; when it is
absent the game automatically uses the bit-identical TypeScript fallback in
`game/wasm/noise.ts`, so local development works without a WASM toolchain.
