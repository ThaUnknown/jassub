import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { transformAsync } from '@babel/core'

import { LEGACY_TARGETS } from './targets.ts'

import type { Plugin } from 'vite'

// The legacy build lives in legacy/ at the repository root, built by legacy-build/. Emscripten 4.0.23
// emits JavaScript for Chrome 74, Firefox 68 and Safari 12.2 at the oldest, so the glue and the wasm2js
// shim go through Babel here before they are emitted under dist/legacy/. The wasm file is copied as is.
const LEGACY_DIR = fileURLToPath(new URL('../../legacy/', import.meta.url))
const FILES = ['jassub-worker-legacy.js', 'jassub-worker-legacy.wasm', 'jassub-worker-legacy.wasm.js']

export function legacyBuildAssets (): Plugin {
  return {
    name: 'jassub-legacy:legacy-build-assets',
    apply: 'build',
    async generateBundle () {
      for (const name of FILES) {
        const path = LEGACY_DIR + name
        if (!existsSync(path)) {
          this.warn(`${name} is missing in legacy/, the legacy and wasm2js tiers will not run. Run legacy-build/.`)
          continue
        }
        let source: string | Uint8Array = readFileSync(path)
        if (name.endsWith('.js')) {
          const result = await transformAsync(readFileSync(path, 'utf8'), {
            babelrc: false,
            configFile: false,
            compact: true,
            comments: false,
            sourceMaps: false,
            presets: [['@babel/preset-env', { targets: LEGACY_TARGETS, modules: false, useBuiltIns: false }]]
          })
          if (!result?.code) throw new Error('jassub-legacy: babel produced no output for ' + name)
          source = result.code
        }
        this.emitFile({ type: 'asset', fileName: 'legacy/' + name, source })
      }
    }
  }
}
