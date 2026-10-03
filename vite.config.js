import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    open: '/debug/manual/index.html',
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    }
  }
})
