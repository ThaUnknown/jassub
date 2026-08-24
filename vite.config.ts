import devtoolsJson from 'vite-plugin-devtools-json';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const akarisubDir = resolve('node_modules/akarisub');

const viteServerConfig = () => ({
  name: 'add-headers',
  configureServer: (server) => {
    server.middlewares.use((req, res, next) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
      res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless')
      next()
    })
  }
})

export default defineConfig({ 
  plugins: [sveltekit(), viteServerConfig(), devtoolsJson()],
  build: {
    target: 'es2020',
    sourcemap: true
  },
  resolve: {
    alias: [
      { find: /^\$akarisub\/(.*)$/, replacement: (_, path) => resolve(akarisubDir, path) }
    ]
  },
  ssr: {
    target: 'webworker'
  },
  worker: {
    format: 'es'
  },
  optimizeDeps: {
    exclude: ['anitomyscript']
  }
})
