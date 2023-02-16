const { defineConfig } = require('vite')
const { writeFileSync } = require('fs')

writeFileSync('./dist/package.json', JSON.stringify({"name": "jassub-wasm","main": "js/jassub-worker-legacy.js"}))

module.exports = defineConfig({
  build: {
    emptyOutDir: false,
    target: 'esnext',
    outDir: 'dist',
    lib: {
      fileName: 'jassub-worker-legacy',
      entry: 'src/worker.js',
      formats: ['cjs']
    }
  }
})
