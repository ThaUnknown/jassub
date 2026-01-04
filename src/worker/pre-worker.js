// @ts-nocheck
// very cursed patches/fixes for emscripten

// must be loaded before the emscripten module... minimalRuntime causes this....
var asm = null
var _scriptName

// emscripten doesn't support conditional memory growth out of the box
// so we hack around it by checking for WebAssembly.Memory.prototype.toResizableBuffer
const supportsGrowth = !!WebAssembly.Memory.prototype.toResizableBuffer

updateMemoryViews = () => {
  if (supportsGrowth && self.HEAPU8RAW) return

  var b = supportsGrowth ? wasmMemory.toResizableBuffer() : wasmMemory.buffer
  HEAP8 = new Int8Array(b)
  HEAP16 = new Int16Array(b)
  self.HEAPU8RAW = HEAPU8 = new Uint8Array(b)
  HEAPU16 = new Uint16Array(b)
  HEAP32 = new Int32Array(b)
  HEAPU32 = new Uint32Array(b)
  HEAPF32 = new Float32Array(b)
  HEAPF64 = new Float64Array(b)
  HEAP64 = new BigInt64Array(b)
  HEAPU64 = new BigUint64Array(b)
}

// emscripten doesnt support conditional loading of wasm modules out of the box
// so we hack around it by passing the url and simd support via the worker name
// hopefully not bad?
if (self.name.startsWith('em-pthread')) {
  const url = self.name.split('-').slice(2).join('-')

  const _fetch = globalThis.fetch
  globalThis.fetch = _ => _fetch(url)
} else {
  const OriginalWorker = globalThis.Worker
  globalThis.Worker = class extends OriginalWorker {
    constructor(scriptURL, options = {}) {
      super(scriptURL, {
        ...options,
        name: 'em-pthread-' + moduleArg.__url
      })
    }
  }
}