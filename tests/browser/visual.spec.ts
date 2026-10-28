/*
 * Real WebGL proof shots via Playwright + Chromium. These capture the
 * actual locked ReliefTerrain renderer (ACES tone mapping, hemisphere +
 * directional lighting, IBL) that the CPU raster harness can only
 * approximate. Runs in CI; see playwright.config.ts.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

test("terrain and royal city render in a real browser", async ({ page }) => {
  // Surface browser-side failures (WebGL context loss, engine throws)
  // directly in the test output instead of a silent timeout.
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(`${err.name}: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(`console: ${msg.text()}`);
  });
  const dumpDiag = async (label: string): Promise<void> => {
    mkdirSync("screenshots/browser", { recursive: true });
    const ua = await page.evaluate(() => navigator.userAgent).catch(() => "n/a");
    const glInfo = await page
      .locator("#terrainCanvas")
      .evaluate((el) => {
        const c = el as HTMLCanvasElement;
        const gl = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
        if (!gl) return "no webgl context";
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        return dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.VERSION));
      })
      .catch((e) => `gl probe failed: ${String(e)}`);
    const body = [
      `# ${label}`,
      `url: ${page.url()}`,
      `title: ${await page.title().catch(() => "n/a")}`,
      `userAgent: ${ua}`,
      `webgl: ${glInfo}`,
      `canvas: ${await page.locator("#terrainCanvas").count().catch(() => 0)}`,
      `walk button: ${await page.getByRole("button", { name: /walk the map/i }).count().catch(() => 0)}`,
      `crosshair: ${await page.locator(".crosshair").count().catch(() => 0)}`,
      "errors:",
      ...pageErrors.map((e) => `  - ${e}`)
    ].join("\n");
    writeFileSync("screenshots/browser/diag.txt", body + "\n");
  };

  try {
  await page.goto("/");
  const canvas = page.locator("#terrainCanvas");
  await expect(canvas).toBeAttached({ timeout: 30_000 });

  // WebGL must actually have a live context, not just a canvas element.
  const gl = await canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement;
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  });
  expect(gl, "WebGL context available under SwiftShader").toBe(true);

  // Give the engine time to build the merged ground, city and scatter.
  await page.waitForTimeout(4000);
  await dumpDiag("after-load");
  expect(pageErrors, `page errors during load: ${pageErrors.join(" | ")}`).toHaveLength(0);
  // Element capture of the WebGL canvas is more reliable in headless
  // software-GL than a full-page screenshot (no compositor quiescence wait).
  await canvas.screenshot({
    path: "screenshots/browser/01-orbit-city.png",
    timeout: 30_000,
    animations: "disabled"
  });

  // Enter first-person mode and capture a walk view with the crosshair.
  await page.getByRole("button", { name: /walk the map/i }).click();
  await page.waitForTimeout(1200);
  const crosshair = page.locator(".crosshair");
  await expect(crosshair).toBeAttached();
  await canvas.screenshot({
    path: "screenshots/browser/02-walk-mode.png",
    timeout: 30_000,
    animations: "disabled"
  });

  // Walk forward for a few seconds to exercise the controller and
  // collision code, then capture the resulting view.
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(3500);
  await page.keyboard.up("KeyW");
  await page.waitForTimeout(500);
  await canvas.screenshot({
    path: "screenshots/browser/03-walk-forward.png",
    timeout: 30_000,
    animations: "disabled"
  });

  // Back to orbit for the exit transition.
  await page.getByRole("button", { name: /orbit view/i }).click();
  await page.waitForTimeout(1000);
  await expect(crosshair).toHaveCount(0);
  await canvas.screenshot({
    path: "screenshots/browser/04-back-to-orbit.png",
    timeout: 30_000,
    animations: "disabled"
  });

  expect(pageErrors, `page errors during run: ${pageErrors.join(" | ")}`).toHaveLength(0);
  await dumpDiag("complete");
  } catch (err) {
    await dumpDiag(`failure: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
});
