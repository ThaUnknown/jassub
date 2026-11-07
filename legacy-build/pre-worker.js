// @ts-nocheck
// ES5 replacement for src/worker/pre-worker.js of jassub. The upstream file uses arrow functions, a
// class wrapper around Worker and a Proxy for ASM_CONSTS, none of which this build can use.

var asm = null
var _scriptName

// Emscripten MINIMAL_RUNTIME marks workers as web, which disables blocking waits.
ENVIRONMENT_IS_WEB = false

// Publish the heap for the renderers, which run outside the module scope.
updateMemoryViews = (function (original) {
  return function () {
    original()
    self.HEAPU8RAW = HEAPU8
    self.HEAPU32RAW = HEAPU32
  }
})(updateMemoryViews)

out = moduleArg.__out || out
