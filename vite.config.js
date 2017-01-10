import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    open: '/test/index.html',
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    }
  }
})
