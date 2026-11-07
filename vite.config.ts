import legacy from '@vitejs/plugin-legacy'
import { defineConfig } from 'vite'

import { babelLegacyChunks } from './src/vite-plugins/babel-legacy-chunks.ts'
import { legacyBuildAssets } from './src/vite-plugins/legacy-build-assets.ts'
import { patchAbslink } from './src/vite-plugins/patch-abslink.ts'
import { patchJassubClassicWorker, patchJassubWorker } from './src/vite-plugins/patch-jassub-worker.ts'
import { LEGACY_TARGETS } from './src/vite-plugins/targets.ts'

// Cross-origin isolation gives capable browsers SharedArrayBuffer, so the shipped build can use threads.
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp'
}

export default defineConfig({
  // No SPA fallback. A missing legacy build must 404, not return index.html to importScripts().
  appType: 'mpa',
  plugins: [
    patchJassubWorker(),
    patchJassubClassicWorker(),
    patchAbslink(),
    legacy({
      targets: LEGACY_TARGETS,
      // The modern chunks carry the shipped emscripten glue, which has BigInt literals. This is also the floor of that build.
      modernTargets: ['chrome >= 85', 'firefox >= 79', 'safari >= 15'],
      // The page uses XMLHttpRequest, only the worker needs fetch and it bundles whatwg-fetch itself.
      modernPolyfills: true
    }),
    babelLegacyChunks(/polyfills-legacy/, { containsCoreJs: true }),
    legacyBuildAssets()
  ],
  server: { headers: ISOLATION_HEADERS },
  preview: { headers: ISOLATION_HEADERS },
  worker: {
    // A classic script runs in every browser with Workers. A module worker needs Chrome 80, Firefox 114 or Safari 15.
    format: 'iife',
    plugins: () => [patchJassubWorker(), patchAbslink(), babelLegacyChunks(/worker-legacy/)]
  },
  optimizeDeps: {
    // Pre-bundling would give the page and the worker separate copies of the abslink transfer handler map.
    exclude: ['jassub', 'abslink']
  },
  build: {
    sourcemap: true,
    // esbuild re-introduces syntax that the babel pass removed, terser keeps ES5 output as ES5.
    minify: 'terser',
    terserOptions: { ecma: 5, safari10: true }
  }
})
