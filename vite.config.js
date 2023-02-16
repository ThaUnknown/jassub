const { defineConfig } = require('vite')

module.exports = defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: 'src/jassub.js',
      name: 'JASSUB',
      formats: ['umd', 'es'],
      fileName: (format) => `jassub.${format}.js`
    }
  }
})
