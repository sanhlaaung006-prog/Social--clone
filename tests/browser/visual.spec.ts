/*
 * Real WebGL proof shots via Playwright + Chromium. These capture the
 * actual locked ReliefTerrain renderer (ACES tone mapping, hemisphere +
 * directional lighting, IBL) that the CPU raster harness can only
 * approximate. Runs in CI; see playwright.config.ts.
 */

import { test, expect } from "@playwright/test";

test("terrain and royal city render in a real browser", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator("#terrainCanvas");
  await expect(canvas).toBeAttached();
  // Give the engine time to build the merged ground, city and scatter.
  await page.waitForTimeout(4000);
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
});
