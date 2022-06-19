/* eslint no-extend-native: 0 */
if (!String.prototype.startsWith) {
  String.prototype.startsWith = function (search, pos) {
    if (pos === undefined) {
      pos = 0
    }
    return this.substring(pos, search.length) === search
  }
}

if (!String.prototype.includes) {
  String.prototype.includes = function (search, pos) {
    return this.indexOf(search, pos) !== -1
  }
}

if (!ArrayBuffer.isView) {
  const typedArrays = [
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array
  ]

  ArrayBuffer.isView = function (obj) {
    return obj && obj.constructor && typedArrays.indexOf(obj.constructor) !== -1
  }
}

if (!Uint8Array.prototype.slice) {
  Uint8Array.prototype.slice = function (begin, end) {
    return new Uint8Array(this.subarray(begin, end))
  }
}

Date.now = (Date.now || function () {
  return new Date().getTime()
})
