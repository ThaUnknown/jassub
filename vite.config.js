// vite.config.js
const path = require('path')
const { defineConfig } = require('vite')

module.exports = defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, 'src/jassub.js'),
      name: 'JASSUB',
      fileName: (format) => `jassub.${format}.js`
    }
  }
})
