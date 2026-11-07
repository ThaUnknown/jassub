interface WebAssemblyLike {
  instantiateStreaming?: (source: Response | PromiseLike<Response>, imports?: WebAssembly.Imports) => Promise<WebAssembly.WebAssemblyInstantiatedSource>
  instantiate: (bytes: BufferSource, imports?: WebAssembly.Imports) => PromiseLike<WebAssembly.WebAssemblyInstantiatedSource>
  // Set by the legacy worker after it loads the wasm2js shim.
  wasm2js?: boolean
}

export function installInstantiateStreaming () {
  const wasm = (self as unknown as { WebAssembly?: WebAssemblyLike }).WebAssembly
  if (!wasm || typeof wasm.instantiateStreaming === 'function') return

  wasm.instantiateStreaming = async (source, imports) => {
    // The shim runs compiled JavaScript, the binary is never read.
    if (wasm.wasm2js) return await wasm.instantiate(new ArrayBuffer(8), imports)
    const response = await source
    if (!response.ok) throw new Error(`jassub-legacy: wasm fetch failed with HTTP ${response.status}`)
    return await wasm.instantiate(await response.arrayBuffer(), imports)
  }
}
