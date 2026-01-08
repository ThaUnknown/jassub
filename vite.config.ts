import devtoolsJson from 'vite-plugin-devtools-json';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

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
    alias: {}
  },
  ssr: {
    target: 'webworker'
  },
    optimizeDeps: {
    exclude: ['anitomyscript']
  }
})
