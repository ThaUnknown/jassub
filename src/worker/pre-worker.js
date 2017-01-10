// @ts-nocheck
// hacky patches/fixes for emscripten

var asm = null
var _scriptName

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
