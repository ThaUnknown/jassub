export function installWebAssemblyStub () {
  const global = self as unknown as { WebAssembly?: unknown }
  if (typeof global.WebAssembly !== 'undefined') return

  class Module {
    constructor (_bytes: BufferSource) {}
  }
  class Instance {
    exports = {}
    constructor (_module: Module, _imports?: unknown) {}
  }
  global.WebAssembly = { Module, Instance, validate: () => false }
}
