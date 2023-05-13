// vite.config.js
import { resolve, dirname } from 'path'
import { build } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

await build({
  configFile: false,
  build: {
    target: 'esnext',
    emptyOutDir: false,
    minify: 'esbuild',
    lib: {
      entry: resolve(__dirname, 'src/jassub.js'),
      name: 'JASSUB',
      fileName: (format) => `jassub.${format}.js`
    }
  }
})

await build({
  configFile: false,
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'dist/js/jassub-worker.wasm',
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
        'jassub-worker': resolve(__dirname, 'dist/js/jassub-worker.js')
      }
    },
    emptyOutDir: false
  }
})

await build({
  configFile: false,
  build: {
    terserOptions: {
      mangle: {
        reserved: ['WebAssembly']
      },
      compress: false,
      format: {
        comments: false
      }
    },
    target: 'esnext',
    outDir: './dist',
    minify: 'terser',
    rollupOptions: {
      treeshake: false,
      output: {
        exports: 'none',
        entryFileNames: '[name].js'
      },
      input: {
        'jassub-worker.wasm': resolve(__dirname, 'dist/js/jassub-worker.wasm.js')
      }
    },
    emptyOutDir: false
  }
})
