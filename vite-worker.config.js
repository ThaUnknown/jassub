// vite.config.js
const { resolve } = require('path')
const { defineConfig } = require('vite')
const { viteStaticCopy } = require('vite-plugin-static-copy')

module.exports = defineConfig({
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'dist/js/jassub-worker.wasm',
          dest: './'
        },
        {
          src: 'dist/js/jassub-worker-legacy.mem',
          dest: './'
        }
      ]
    })
  ],
  build: {
    target: 'esnext',
    outDir: './dist',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        entryFileNames: '[name].js'
      },
      input: {
        'jassub-worker': resolve(__dirname, 'dist/js/jassub-worker.js'),
        'jassub-worker-legacy': resolve(__dirname, 'dist/js/jassub-worker-legacy.js')
      }
    },
    emptyOutDir: false
  }
})
