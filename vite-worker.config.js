const { defineConfig } = require('vite')
const commonjs = require('@rollup/plugin-commonjs')

module.exports = defineConfig({
  build: {
    emptyOutDir: false,
    target: 'esnext',
    outDir: 'dist',
    lib: {
      fileName: 'jassub-worker',
      entry: 'src/worker.js',
      formats: ['cjs']
    }
  },
  plugins: [
    commonjs()
  ]
})
