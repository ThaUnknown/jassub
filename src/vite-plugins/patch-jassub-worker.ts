import type { Plugin } from 'vite'

// worker.js loads the emscripten glue with a dynamic import(). A classic worker on an old browser
// cannot import(), so the demo worker entry supplies jassubLoadWasmGlue() instead.
const GLUE_IMPORT = /await import\(\s*(?:__rewriteRelativeImportExtension\()?\s*(?:\/\*[^*]*\*\/\s*)*data\.wasmWorkerUrl\s*\)\)?/

// The glue builds the pthread script URL and the wasm URL from import.meta.url. jassub overrides both
// (pre-worker.js passes __workerUrl, worker.js overrides fetch), so the URLs only make Vite emit extra
// assets and nested workers. A plain string keeps the glue inert.
const META_URL = /new URL\(\s*"[^"]+"\s*,\s*import\.meta\.url\s*\)/g

// jassub asks for a module worker. The demo bundles are classic scripts and need importScripts(),
// which module workers forbid. Build only: in dev mode Vite serves workers as modules.
const MODULE_WORKER = /\{ name: 'jassub-worker', type: 'module' \}/g

export function patchJassubClassicWorker (): Plugin {
  return {
    name: 'jassub-legacy:patch-jassub-classic-worker',
    apply: 'build',
    transform (code, id) {
      if (!id.replace(/\\/g, '/').endsWith('/jassub/dist/jassub.js')) return
      if (!MODULE_WORKER.test(code)) throw new Error('jassub-legacy: jassub.js changed, update patch-jassub-worker.ts')
      return { code: code.replace(MODULE_WORKER, "{ name: 'jassub-worker' }"), map: null }
    }
  }
}

export function patchJassubWorker (): Plugin {
  return {
    name: 'jassub-legacy:patch-jassub-worker',
    enforce: 'pre',
    transform (code, id) {
      const path = id.replace(/\\/g, '/')
      if (path.endsWith('/jassub/dist/worker/worker.js')) {
        if (!GLUE_IMPORT.test(code)) throw new Error('jassub-legacy: worker.js changed, update patch-jassub-worker.ts')
        return { code: code.replace(GLUE_IMPORT, 'await self.jassubLoadWasmGlue(data.wasmWorkerUrl)'), map: null }
      }
      if (/\/jassub\/dist\/wasm\/jassub-worker(-modern)?\.js$/.test(path)) {
        return { code: code.replace(META_URL, 'self.location.href'), map: null }
      }
    }
  }
}
