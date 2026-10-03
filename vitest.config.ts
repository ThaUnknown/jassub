import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  // Pre-bundle the runtime deps. Otherwise Vite discovers a dep (lfa-ponyfill)
  // when the worker first loads, re-optimizes mid-run, and reloads the test
  // iframe. That makes the file time out instead of running.
  optimizeDeps: {
    include: ['abslink', 'abslink/w3c', 'lfa-ponyfill', 'rvfc-polyfill', 'throughput']
  },
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium', viewport: { width: 1280, height: 720 } }]
    }
  },
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin'
    }
  }
})
