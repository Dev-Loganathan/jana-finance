import path from "node:path";
import { defineConfig } from "@playwright/test";
import { API_ENV, API_PORT, WEB_PORT } from "./constants";

const root = path.resolve(__dirname, "..");

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Use the installed Chrome locally (no browser download). CI installs Chromium and sets E2E_CHANNEL=chromium.
    channel: process.env.E2E_CHANNEL === "chromium" ? undefined : "chrome",
  },
  webServer: [
    {
      command: "node e2e/start-api.js",
      cwd: root,
      env: API_ENV,
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `corepack pnpm --filter @jana/web exec vite --port ${WEB_PORT} --strictPort`,
      cwd: root,
      env: { API_URL: `http://localhost:${API_PORT}` },
      url: `http://localhost:${WEB_PORT}/login`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
