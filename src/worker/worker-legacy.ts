// Worker for the legacy single-thread build, see legacy-build/.
// This chunk is transpiled to ES5 by vite-plugins/babel-legacy-chunks.ts.
import '../polyfills/worker/core-js.ts'
import 'regenerator-runtime/runtime'
import 'whatwg-fetch'
import '../polyfills/worker/install.ts'
import { installInstantiateStreaming } from '../polyfills/worker/instantiate-streaming.ts'
import 'jassub/dist/worker/worker.js'

declare const self: DedicatedWorkerGlobalScope & { JASSUBLegacy?: unknown }

function wasmGlobal () {
  return (self as unknown as { WebAssembly?: { wasm2js?: boolean } }).WebAssembly
}

self.jassubLoadWasmGlue = url => {
  // Without WebAssembly the WASM=2 shim installs one that runs the same build as JavaScript.
  if (!wasmGlobal()) {
    self.importScripts(url.replace(/\.js(\?.*)?$/, '.wasm.js$1'))
    const wasm = wasmGlobal()
    if (!wasm) throw new Error('jassub-legacy: the wasm2js shim did not define WebAssembly')
    wasm.wasm2js = true
    // The shim has no instantiateStreaming, and the glue calls it.
    installInstantiateStreaming()
  }
  self.importScripts(url)
  const factory = self.JASSUBLegacy
  if (typeof factory !== 'function') throw new Error('jassub-legacy: the legacy glue did not define JASSUBLegacy, build it with -sEXPORT_NAME=JASSUBLegacy')
  return Promise.resolve({ default: factory })
}
