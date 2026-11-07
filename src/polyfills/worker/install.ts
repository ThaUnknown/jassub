import 'proxy-polyfill'

import { chooseCanvasTransport, registerRemoteCanvasHandler, SoftwareImageData, SoftwareOffscreenCanvas } from '../../offscreen-canvas/worker.ts'

import { installInstantiateStreaming } from './instantiate-streaming.ts'

declare const self: DedicatedWorkerGlobalScope

const global = self as unknown as Record<string, unknown>

if (typeof self.name !== 'string' || self.name === '') {
  Object.defineProperty(self, 'name', { value: 'jassub-worker', writable: true, configurable: true })
}

if (typeof global.performance === 'undefined') {
  const start = Date.now()
  global.performance = { now: () => Date.now() - start }
}

if (typeof global.AbortController === 'undefined') {
  global.AbortController = class AbortControllerShim {
    signal = { aborted: false, addEventListener () {}, removeEventListener () {} }
    abort () { this.signal.aborted = true }
  }
}

installInstantiateStreaming()

const DESYNCHRONIZED_FIXED_IN_CHROME = 90

function chromeVersion () {
  const match = /Chrom(?:e|ium)\/(\d+)/.exec(self.navigator.userAgent)
  return match ? Number(match[1]) : Infinity
}

function dropDesynchronized () {
  const proto = (global.OffscreenCanvas as { prototype: { getContext: (type: string, attributes?: Record<string, unknown>) => unknown } }).prototype
  const original = proto.getContext
  proto.getContext = function (this: unknown, type: string, attributes?: Record<string, unknown>) {
    if (attributes && 'desynchronized' in attributes) {
      attributes = { ...attributes }
      delete attributes.desynchronized
    }
    return original.call(this, type, attributes)
  }
}

if (typeof global.OffscreenCanvas !== 'function') {
  global.OffscreenCanvas = SoftwareOffscreenCanvas
} else if (chromeVersion() < DESYNCHRONIZED_FIXED_IN_CHROME) {
  dropDesynchronized()
}

function hasImageDataConstructor () {
  try {
    return new (global.ImageData as new (width: number, height: number) => unknown)(1, 1) !== null
  } catch {
    return false
  }
}
if (typeof global.ImageData !== 'function' || !hasImageDataConstructor()) global.ImageData = SoftwareImageData

chooseCanvasTransport()
registerRemoteCanvasHandler()
