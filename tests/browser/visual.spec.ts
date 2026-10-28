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
    const body = [
      `# ${label}`,
      `url: ${page.url()}`,
      `userAgent: ${ua}`,
      `canvas attached: ${await page.locator("#terrainCanvas").count().catch(() => 0)}`,
      `crosshair attached: ${await page.locator(".crosshair").count().catch(() => 0)}`,
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
  await page.screenshot({ path: "screenshots/browser/01-orbit-city.png" });

  // Enter first-person mode and capture a walk view with the crosshair.
  await page.getByRole("button", { name: /walk the map/i }).click();
  await page.waitForTimeout(1200);
  await expect(page.locator(".crosshair")).toBeAttached();
  await page.screenshot({ path: "screenshots/browser/02-walk-mode.png" });

  // Walk forward for a few seconds to exercise the controller and
  // collision code, then capture the resulting view.
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(3500);
  await page.keyboard.up("KeyW");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "screenshots/browser/03-walk-forward.png" });

  // Back to orbit for the exit transition.
  await page.getByRole("button", { name: /orbit view/i }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "screenshots/browser/04-back-to-orbit.png" });

  expect(pageErrors, `page errors during run: ${pageErrors.join(" | ")}`).toHaveLength(0);
  await dumpDiag("complete");
  } catch (err) {
    await dumpDiag(`failure: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
});
