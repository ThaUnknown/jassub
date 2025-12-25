/* eslint-disable no-global-assign, no-unused-vars, prefer-const, no-extend-native */
/* global out, err, updateMemoryViews, wasmMemory */

let asm = null
var _scriptName

// patch EMS function to include Uint8Clamped, but call old function too
updateMemoryViews = (_super => {
  return () => {
    _super()
    self.wasmMemory = wasmMemory
    self.HEAPU8C = new Uint8ClampedArray(wasmMemory.buffer)
    self.HEAPU8 = new Uint8Array(wasmMemory.buffer)
  }
})(updateMemoryViews)
