if (self.name.startsWith('em-pthread')) {
  const url = self.name.split('-').slice(2).join('-')

  const _fetch = globalThis.fetch
  globalThis.fetch = _ => _fetch(url)
  self.name = 'em-pthread'
}
