import { bigInt, bulkMemory, saturatedFloatToInt, signExtensions, threads } from 'wasm-feature-detect'

export type Tier = 'shipped' | 'legacy-wasm' | 'wasm2js'

async function supports (tests: Array<() => Promise<boolean>>) {
  try {
    const results = await Promise.all(tests.map(test => test()))
    return results.every(Boolean)
  } catch {
    return false
  }
}

// Run this before the polyfills replace WebAssembly with a stub.
export async function chooseTier (): Promise<Tier> {
  if (typeof WebAssembly === 'undefined') return 'wasm2js'
  return await supports([threads, bulkMemory, signExtensions, saturatedFloatToInt, bigInt]) ? 'shipped' : 'legacy-wasm'
}
