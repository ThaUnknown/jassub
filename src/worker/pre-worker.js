// @ts-nocheck
// very cursed patches/fixes for emscripten

// must be loaded before the emscripten module... minimalRuntime causes this....
var asm = null
var _scriptName

// GROWABLE_ARRAYBUFFERS=1 makes emscripten handle resizable heap views itself,
// including the Firefox and maximum-memory cases. Publish the heap for the
// renderers, which run outside the module scope.
updateMemoryViews = (o => () => {
  o()
  self.HEAPU8RAW = HEAPU8
  self.WASMMEMORY = wasmMemory
})(updateMemoryViews)

out = moduleArg.__out || out
// err = moduleArg.__err || err
// emscripten doesnt support conditional loading of wasm modules out of the box
// so we hack around it by passing the url and simd support via the worker name
// hopefully not bad?
if (!self.name.startsWith('em-pthread')) {
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

// EM_ASM_PTR generates different code indices per build variant.
// The Proxy defaultsto the equivalent inline behavior.
const _origLoadModule = loadModule
loadModule = function () {
  _origLoadModule()
  ASM_CONSTS = new Proxy({}, {
    get () {
      return $0 => stringToNewUTF8(Emval.toValue($0))
    }
  })
}