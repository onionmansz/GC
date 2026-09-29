import { defineConfig, devices } from '@playwright/test'

// E2E runs against a live Supabase stack (local `supabase start` or the DEV project):
//   SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY, SUPABASE_TEST_SERVICE_ROLE_KEY
// The app is built with the test URL/anon key and served by `vite preview`.
const url = process.env.SUPABASE_TEST_URL ?? ''
const anonKey = process.env.SUPABASE_TEST_ANON_KEY ?? ''
const port = 4173

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    // Deterministic by default; offline.spec.ts opts back in to the service worker.
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 7'],
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
      },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anonKey },
  },
})
