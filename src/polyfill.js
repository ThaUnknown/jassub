/* eslint-disable no-global-assign */
/* eslint no-extend-native: 0 */
// eslint-disable-next-line no-unused-vars
function assert (c, m) {
  if (!c) throw m
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

Date.now = Date.now || (() => new Date().getTime())

// implement console methods if they're missing
if (typeof console === 'undefined') {
  const postConsoleMessage = (command, a) => {
    postMessage({
      target: 'console',
      command,
      content: JSON.stringify(Array.prototype.slice.call(a))
    })
  }
  console = {
    log: function () {
      postConsoleMessage('log', arguments)
    },
    debug: function () {
      postConsoleMessage('debug', arguments)
    },
    info: function () {
      postConsoleMessage('info', arguments)
    },
    warn: function () {
      postConsoleMessage('warn', arguments)
    },
    error: function () {
      postConsoleMessage('error', arguments)
    }
  }
  console.log('overridden console')
}
