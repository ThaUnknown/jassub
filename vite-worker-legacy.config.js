const { defineConfig } = require('vite')
const commonjs = require('@rollup/plugin-commonjs')

module.exports = defineConfig({
  resolve: {
    alias: {
      'jassub-wasm': 'dist/js/jassub-worker-legacy.js'
    }
  },
  build: {
    emptyOutDir: false,
    target: 'esnext',
    outDir: 'dist',
    lib: {
      fileName: 'jassub-worker-legacy',
      entry: 'src/worker.js',
      formats: ['cjs']
    }
  },
  plugins: [
    commonjs()
  ]
})
