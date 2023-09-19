/* eslint-disable no-global-assign, no-unused-vars, prefer-const, no-extend-native */
/* global out, err, updateMemoryViews, wasmMemory */

function assert (c, m) {
  if (!c) throw m
}

let asm = null

out = text => {
  if (text === 'JASSUB: No usable fontconfig configuration file found, using fallback.') {
    console.debug(text)
  } else {
    console.log(text)
  }
}

err = text => {
  if (text === 'Fontconfig error: Cannot load default config file: No such file: (null)') {
    console.debug(text)
  } else {
    console.error(text)
  }
}

// patch EMS function to include Uint8Clamped, but call old function too
updateMemoryViews = (_super => {
  return () => {
    _super()
    self.wasmMemory = wasmMemory
    self.HEAPU8C = new Uint8ClampedArray(wasmMemory.buffer)
    self.HEAPU8 = new Uint8Array(wasmMemory.buffer)
  }
})(updateMemoryViews)

if (!String.prototype.startsWith) {
  String.prototype.startsWith = function (s, p = 0) {
    return this.substring(p, s.length) === s
  }
}

if (!String.prototype.includes) {
  String.prototype.includes = function (s, p) {
    return this.indexOf(s, p) !== -1
  }
}

if (!Uint8Array.prototype.slice) {
  Uint8Array.prototype.slice = function (b, e) {
    return new Uint8Array(this.subarray(b, e))
  }
}
