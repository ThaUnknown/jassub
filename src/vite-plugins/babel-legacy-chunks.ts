import { transformAsync } from '@babel/core'

import { LEGACY_TARGETS } from './targets.ts'

import type { Plugin } from 'vite'

interface Options {
  // The chunk contains core-js. Its Symbol sham relies on raw typeof checks, so the typeof transform
  // must stay out. Babel documents this exclusion for transpiled core-js.
  containsCoreJs?: boolean
}

// Transpiles the matching chunks to ES5 after the bundler is done with them.
// plugin-legacy only covers the page chunks. Its polyfill chunk and the worker chunks keep the
// ES2015 syntax of the bundler's helpers and minifier, so this runs on the final code in generateBundle.
export function babelLegacyChunks (pattern: RegExp, options: Options = {}): Plugin {
  return {
    name: 'jassub-legacy:babel-legacy-chunks',
    enforce: 'post',
    async generateBundle (_options, bundle) {
      for (const fileName in bundle) {
        const chunk = bundle[fileName]
        if (!chunk || chunk.type !== 'chunk' || !pattern.test(fileName)) continue
        const result = await transformAsync(chunk.code, {
          babelrc: false,
          configFile: false,
          // Readable output. Old browsers report errors by line, and size does not matter on the legacy path.
          compact: false,
          comments: false,
          sourceMaps: false,
          presets: [['@babel/preset-env', {
            targets: LEGACY_TARGETS,
            modules: false,
            useBuiltIns: false,
            exclude: options.containsCoreJs ? ['transform-typeof-symbol'] : []
          }]]
        })
        if (!result?.code) throw new Error('jassub-legacy: babel produced no output for ' + fileName)
        chunk.code = result.code
      }
    }
  }
}
