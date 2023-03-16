// vite.config.js
const { resolve } = require('path')
const { defineConfig } = require('vite')

module.exports = defineConfig({
  build: {
    emptyOutDir: false,
    minify: 'esbuild',
    lib: {
      entry: resolve(__dirname, 'src/jassub.js'),
      name: 'JASSUB',
      fileName: (format) => `jassub.${format}.js`
    }
  }
})
