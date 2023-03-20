/* eslint-disable no-global-assign */
/* eslint no-extend-native: 0 */
// eslint-disable-next-line no-undef
if (!self.assert) {
  self.assert = (c, m) => {
    if (!c) throw m
  }
}

if (!String.prototype.startsWith) {
  String.prototype.startsWith = function (s, p) {
    if (p === undefined) {
      p = 0
    }
    return this.substring(p, s.length) === s
  }
}

if (!String.prototype.includes) {
  String.prototype.includes = function (s, p) {
    return this.indexOf(s, p) !== -1
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

  ArrayBuffer.isView = o => o && o.constructor && typedArrays.indexOf(o.constructor) !== -1
}

if (!Uint8Array.prototype.slice) {
  Uint8Array.prototype.slice = function (b, e) {
    return new Uint8Array(this.subarray(b, e))
  }
}

if (!Date.now) Date.now = () => new Date().getTime()
if (!('performance' in self)) self.performance = { now: () => Date.now() }

// implement console methods if they're missing
if (typeof console === 'undefined') {
  const msg = (command, a) => {
    postMessage({
      target: 'console',
      command,
      content: JSON.stringify(Array.prototype.slice.call(a))
    })
  }
  console = {
    log: function () {
      msg('log', arguments)
    },
    debug: function () {
      msg('debug', arguments)
    },
    info: function () {
      msg('info', arguments)
    },
    warn: function () {
      msg('warn', arguments)
    },
    error: function () {
      msg('error', arguments)
    }
  }
  console.log('Detected lack of console, overridden console')
}
