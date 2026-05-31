// emscripten doesnt support conditional loading of wasm modules out of the box
// so we hack around it by passing the url and simd support via the worker name
// hopefully not bad?
if (self.name.startsWith('em-pthread')) {
  const url = self.name.split('-').slice(2).join('-')

  const _fetch = globalThis.fetch
  globalThis.fetch = _ => _fetch(url)
  self.name = 'em-pthread'
}
