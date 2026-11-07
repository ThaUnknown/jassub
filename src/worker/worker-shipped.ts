// The polyfills must install before worker.js loads.
import '../polyfills/worker/install.ts'
import modernGlue from 'jassub/dist/wasm/jassub-worker-modern.js'
import normalGlue from 'jassub/dist/wasm/jassub-worker.js'
import 'jassub/dist/worker/worker.js'

declare const self: DedicatedWorkerGlobalScope

// jassub passes the pthread entry URL as wasmWorkerUrl, see main.ts. The same glue is bundled here.
self.jassubLoadWasmGlue = url => Promise.resolve({ default: url.includes('modern') ? modernGlue : normalGlue })
