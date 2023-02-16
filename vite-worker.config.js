const { defineConfig } = require('vite')
const { writeFileSync } = require('fs')

writeFileSync('./dist/package.json', JSON.stringify({"name": "jassub-wasm","main": "js/jassub-worker.js"}))

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
  }
})
