// IRONVEIL production build: bundle src/ironveil.jsx with esbuild and inline
// it into template.html -> index.html (one self-contained file, no import
// map, no Babel, no esm.sh — so first paint works on any phone, even offline
// apart from Google Fonts + the backdrop photo).
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const result = await build({
  entryPoints: [join(here, "src/ironveil.jsx")],
  bundle: true,
  format: "iife",
  minify: true,
  // Down-level modern syntax so older mobile browsers can parse the bundle.
  target: ["es2017", "safari14"],
  define: { "process.env.NODE_ENV": '"production"' },
  write: false,
  logLevel: "info",
});

// Never let a literal "</script" inside the JS terminate the inline tag.
const js = result.outputFiles[0].text.replaceAll("</script", "<\\/script");

const template = readFileSync(join(here, "template.html"), "utf8");
const token = "/*__IRONVEIL_BUNDLE__*/";
if (!template.includes(token)) throw new Error("bundle placeholder missing in template.html");

writeFileSync(join(here, "index.html"), template.replace(token, () => js));
console.log(`built index.html (bundle ${(js.length / 1024).toFixed(0)} KB inlined)`);
