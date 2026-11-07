interface WorkerGlobalScope {
  jassubLoadWasmGlue: (url: string) => Promise<{ default: unknown }>
}

declare module 'whatwg-fetch'
declare module 'proxy-polyfill'
