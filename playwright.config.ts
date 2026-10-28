/*
 * Real-browser visual harness. The sandbox used for development blocks
 * the Playwright browser CDN, so this runs in GitHub Actions (where
 * `npx playwright install chromium` is reachable) or any machine with a
 * local Chromium. It is deliberately NOT part of `npm test`: the headless
 * logic tests never need a browser or GPU. Run:
 *   npx playwright install chromium && npm run screenshot:browser
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1280, height: 720 },
    headless: true,
    actionTimeout: 15_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Headless CI has no GPU: force software WebGL via ANGLE +
        // SwiftShader. Recent Chrome builds refuse SwiftShader unless
        // the unsafe flag is present.
        launchOptions: {
          args: [
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--ignore-gpu-blocklist",
            "--disable-gpu-sandbox"
          ]
        }
      }
    }
  ],
  webServer: {
    command: "npm run dev -- --port 5173 --host 127.0.0.1",
    url: "http://127.0.0.1:5173/",
    reuseExistingServer: true,
    timeout: 60_000
  }
});
