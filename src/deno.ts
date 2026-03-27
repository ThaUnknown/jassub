import 'rvfc-polyfill'

import { Debug } from './debug.ts'
import { ASSRenderer } from './worker/deno.ts'

import type { WeightValue } from './worker/util.ts'
import type { queryRemoteFonts } from 'lfa-ponyfill'

declare const self: typeof globalThis & {
  queryLocalFonts: (opts?: { postscriptNames?: string[] }) => ReturnType<typeof queryRemoteFonts>
}

export type JASSUBOptions = {
  timeOffset?: number
  debug?: boolean
  prescaleFactor?: number
  prescaleHeightLimit?: number
  maxRenderHeight?: number
  workerUrl?: string
  wasmUrl?: string
  modernWasmUrl?: string
  fonts?: Array<string | Uint8Array>
  availableFonts?: Record<string, Uint8Array | string>
  defaultFont?: string
  queryFonts?: 'local' | 'localandremote' | false
  libassMemoryLimit?: number
  libassGlyphLimit?: number
  canvas: HTMLCanvasElement
} & ({
  subUrl: string
  subContent?: string
} | {
  subUrl?: string
  subContent: string
})

export default class JASSUB {
  timeOffset
  prescaleFactor
  prescaleHeightLimit
  maxRenderHeight
  debug
  renderer!: ASSRenderer
  ready
  busy = false

  _videoWidth = 0
  _videoHeight = 0
  _canvas

  _destroyed = false
  _lastDemandTime!: VideoFrameCallbackMetadata
  _skipped = false

  constructor (opts: JASSUBOptions) {
    if (!globalThis.Worker) throw new Error('Worker not supported')
    if (!opts) throw new Error('No options provided')
    if (!opts.canvas) throw new Error('You should give video or canvas in options.')

    JASSUB._test()

    this.timeOffset = opts.timeOffset ?? 0
    this._canvas = opts.canvas

    this.debug = opts.debug ? new Debug() : null

    this.prescaleFactor = opts.prescaleFactor ?? 1.0
    this.prescaleHeightLimit = opts.prescaleHeightLimit ?? 1080
    this.maxRenderHeight = opts.maxRenderHeight ?? 0 // 0 - no limit.

    const modern = opts.modernWasmUrl ?? new URL('./wasm/jassub-worker-modern.wasm', import.meta.url).href
    const normal = opts.wasmUrl ?? new URL('./wasm/jassub-worker.wasm', import.meta.url).href

    const availableFonts = opts.availableFonts ?? {}
    if (!availableFonts['liberation sans'] && !opts.defaultFont) {
      availableFonts['liberation sans'] = new URL('./default.woff2', import.meta.url).href
    }

    this.renderer = new ASSRenderer({
      wasmUrl: JASSUB._supportsSIMD ? modern : normal,
      width: this._canvas.width,
      height: this._canvas.height,
      subUrl: opts.subUrl,
      subContent: opts.subContent ?? null,
      fonts: opts.fonts ?? [],
      availableFonts,
      defaultFont: opts.defaultFont ?? 'liberation sans',
      debug: !!opts.debug,
      libassMemoryLimit: opts.libassMemoryLimit ?? 0,
      libassGlyphLimit: opts.libassGlyphLimit ?? 0,
      queryFonts: opts.queryFonts ?? 'local'
    }, font => this._getLocalFont(font))

    this.ready = this.renderer.ready()
  }

  static _supportsSIMD?: boolean

  static _test () {
    if (JASSUB._supportsSIMD != null) return

    try {
      JASSUB._supportsSIMD = WebAssembly.validate(Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11))
    } catch (e) {
      JASSUB._supportsSIMD = false
    }

    const module = new WebAssembly.Module(Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00))
    if (!(module instanceof WebAssembly.Module) || !(new WebAssembly.Instance(module) instanceof WebAssembly.Instance)) throw new Error('WASM not supported')
  }

  async resize (forceRepaint = false, width: number, height: number) {
    this.renderer._resizeCanvas(
      width,
      height
    )

    if (this._lastDemandTime) await this._demandRender(forceRepaint)
  }

  async _getLocalFont (font: string, weight: WeightValue = 'regular') {
    // electron by default has all permissions enabled, and it doesn't have perm query
    // if this happens, just send it
    if (navigator.permissions?.query) {
      const { state } = await navigator.permissions.query({ name: 'local-fonts' as PermissionName })
      if (state !== 'granted') return
    }

    for (const data of await self.queryLocalFonts()) {
      const family = data.family.toLowerCase()
      const style = data.style.toLowerCase()
      if (family === font && style === weight) {
        const blob = await data.blob()
        return new Uint8Array(await blob.arrayBuffer())
      }
    }
  }

  async _demandRender (repaint = false) {
    const { mediaTime, width, height } = this._lastDemandTime
    if (width !== this._videoWidth || height !== this._videoHeight) {
      this._videoWidth = width
      this._videoHeight = height
      return await this.resize(repaint, width, height)
    }

    if (this.busy) {
      this._skipped = true
      this.debug?._drop()
      return
    }

    this.busy = true
    this._skipped = false

    this.debug?._startFrame()
    this.renderer._draw(mediaTime + this.timeOffset, repaint)
    this.debug?._endFrame(this._lastDemandTime)

    this.busy = false
    if (this._skipped) await this._demandRender()
  }

  async destroy () {
    if (this._destroyed) return
    this._destroyed = true
    this.renderer.destroy()
  }
}
