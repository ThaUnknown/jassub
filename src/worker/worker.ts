/* eslint-disable camelcase */
import { finalizer } from 'abslink'
import { expose } from 'abslink/w3c'
import { queryRemoteFonts } from 'lfa-ponyfill'

import WASM from '../wasm/jassub-worker.js'

import { Canvas2DRenderer } from './renderers/2d-renderer.ts'
import { WebGL1Renderer } from './renderers/webgl1-renderer.ts'
import { WebGL2Renderer } from './renderers/webgl2-renderer.ts'
import { _fetch, fetchtext, LIBASS_YCBCR_MAP, THREAD_COUNT, WEIGHT_MAP, type ASSEvent, type ASSImage, type ASSStyle, type WeightValue } from './util.ts'

import type { JASSUB, MainModule } from '../wasm/types.d.ts'
// import { WebGPURenderer } from './webgpu-renderer'

declare const self: DedicatedWorkerGlobalScope &
  typeof globalThis & {
    HEAPU8RAW: Uint8Array<ArrayBuffer>
    WASMMEMORY: WebAssembly.Memory
  }

interface opts {
  wasmUrl: string
  width: number
  height: number
  subUrl: string | undefined
  subContent: string | null
  fonts: Array<string | Uint8Array>
  availableFonts: Record<string, Uint8Array | string>
  defaultFont: string
  debug: boolean
  libassMemoryLimit: number
  libassGlyphLimit: number
  queryFonts: 'local' | 'localandremote' | false
}

const constructor = Symbol.for('constructor')

export class ASSRenderer {
  _wasm!: JASSUB
  _subtitleColorSpace?: 'BT601' | 'BT709' | 'SMPTE240M' | 'FCC' | null
  _videoColorSpace?: 'BT709' | 'BT601'
  _malloc!: (size: number) => number
  _gpurender!: WebGL2Renderer | WebGL1Renderer | Canvas2DRenderer

  debug = false

  constructor (...args: [data: opts, getFont: (font: string, weight: WeightValue) => Promise<Uint8Array<ArrayBuffer> | undefined>, ctrl: OffscreenCanvas]) {
    return this[constructor](...args) as unknown as this
  }

  async [constructor] (data: opts, getFont: (font: string, weight: WeightValue) => Promise<Uint8Array<ArrayBuffer> | undefined>, ctrl: OffscreenCanvas) {
    // remove case sensitivity
    this._availableFonts = Object.fromEntries(Object.entries(data.availableFonts).map(([k, v]) => [k.trim().toLowerCase(), v]))
    this.debug = data.debug
    this.queryFonts = data.queryFonts
    this._getFont = getFont
    this._defaultFont = data.defaultFont.trim().toLowerCase()

    // hack, we want custom WASM URLs
    const _fetch = globalThis.fetch
    globalThis.fetch = _ => _fetch(data.wasmUrl)

    // const devicePromise = navigator.gpu?.requestAdapter({
    //   powerPreference: 'high-performance'
    // }).then(adapter => adapter?.requestDevice())
    try {
      const testCanvas = new OffscreenCanvas(1, 1)
      if (testCanvas.getContext('webgl2')) {
        this._gpurender = new WebGL2Renderer()
      } else {
        this._gpurender = testCanvas.getContext('webgl')?.getExtension('ANGLE_instanced_arrays') ? new WebGL1Renderer() : new Canvas2DRenderer()
      }
    } catch {
      this._gpurender = new Canvas2DRenderer()
    }

    this._gpurender.setCanvas(ctrl)

    this._loadedInitialFonts = !data.fonts.length
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { _malloc, JASSUB } = await (WASM({ __url: data.wasmUrl, __out: (log: string) => this._log(log) }) as Promise<MainModule>)
    this._malloc = _malloc

    this._wasm = new JASSUB(data.width, data.height, this._defaultFont)
    // Firefox seems to have issues with multithreading in workers
    // a worker inside a worker does not recieve messages properly
    this._wasm.setThreads(THREAD_COUNT)

    if (!this._loadedInitialFonts) await this._loadInitialFonts(data.fonts)

    this._wasm.createTrackMem(data.subContent ?? await fetchtext(data.subUrl!))

    this._subtitleColorSpace = LIBASS_YCBCR_MAP[this._wasm.trackColorSpace]

    if (data.libassMemoryLimit > 0 || data.libassGlyphLimit > 0) {
      this._wasm.setMemoryLimits(data.libassGlyphLimit || 0, data.libassMemoryLimit || 0)
    }
    this._checkColorSpace()

    return this
  }

  // this passes a string of track data to libass, be it styles, events etc, which it then processes and adds to the track
  // useful for streaming subtitles
  processData (events: string) {
    this._wasm.processData(events)
  }

  createEvent (event: ASSEvent) {
    this._wasm.createEvent(event)
  }

  getEvents (): Array<Partial<ASSEvent>> {
    return this._wasm.getEvents()
  }

  setEvent (event: ASSEvent, index: number) {
    this._wasm.setEvent(index, event)
  }

  removeEvent (index: number) {
    this._wasm.removeEvent(index)
  }

  createStyle (style: ASSStyle) {
    this._wasm.createStyle(style)
  }

  getStyles (): ASSStyle[] {
    return this._wasm.getStyles()
  }

  setStyle (style: ASSStyle, index: number) {
    this._wasm.setStyle(index, style)
  }

  removeStyle (index: number) {
    this._wasm.removeStyle(index)
  }

  styleOverride (style: ASSStyle) {
    this._wasm.styleOverride(style)
  }

  disableStyleOverride () {
    this._wasm.disableStyleOverride()
  }

  setTrack (content: string) {
    this._wasm.createTrackMem(content)

    this._subtitleColorSpace = LIBASS_YCBCR_MAP[this._wasm.trackColorSpace]!
  }

  freeTrack () {
    this._wasm.removeTrack()
  }

  async setTrackByUrl (url: string) {
    this.setTrack(await fetchtext(url))
  }

  _checkColorSpace () {
    if (!this._subtitleColorSpace || !this._videoColorSpace) return
    this._gpurender.setColorMatrix(this._subtitleColorSpace, this._videoColorSpace)
  }

  _defaultFont!: string
  setDefaultFont (fontName: string) {
    this._defaultFont = fontName.trim().toLowerCase()
    this._wasm.setDefaultFont(this._defaultFont)
  }

  async _log (log: string) {
    console.debug(log)
    const match = log.match(/JASSUB: fontselect:[^(]+: \(([^,]+), (\d{1,4}), \d\)/)
    if (match && !await this._findAvailableFont(match[1]!.trim().toLowerCase(), WEIGHT_MAP[Math.ceil(parseInt(match[2]!) / 100) - 1])) {
      await this._findAvailableFont(this._defaultFont)
    }
  }

  async addFonts (fontOrURLs: Array<Uint8Array | string>) {
    if (!fontOrURLs.length) return false
    const strings: string[] = []
    const uint8s: Uint8Array[] = []

    for (const fontOrURL of fontOrURLs) {
      if (typeof fontOrURL === 'string') {
        strings.push(fontOrURL)
      } else {
        uint8s.push(fontOrURL)
      }
    }
    if (uint8s.length) this._allocFonts(uint8s)

    // this isn't batched like uint8s because software like jellyfin exists, which loads 50+ fonts over the network which takes time...
    // is connection exhaustion a concern here?
    return !!await Promise.allSettled(strings.map(url => this._asyncWrite(url)))
  }

  // we don't want to run _findAvailableFont before initial fonts are loaded
  // because it could duplicate fonts
  _loadedInitialFonts = false
  async _loadInitialFonts (fontOrURLs: Array<Uint8Array | string>) {
    await this.addFonts(fontOrURLs)
    this._loadedInitialFonts = true
    this._wasm.reloadFonts()
  }

  _getFont!: (font: string, weight: WeightValue) => Promise<Uint8Array<ArrayBuffer> | undefined>
  _availableFonts: Record<string, Uint8Array | string> = {}
  _checkedFonts = new Set<string>()
  async _findAvailableFont (fontName: string, weight?: WeightValue) {
    if (!this._loadedInitialFonts) return

    // Roboto Medium, null -> Roboto, Medium
    // Roboto Medium, Medium -> Roboto, Medium
    // Roboto, null -> Roboto, Regular
    // italic is not handled I guess
    for (const _weight of WEIGHT_MAP) {
      // check if fontname has this weight name in it, if yes remove it
      if (fontName.includes(_weight)) {
        fontName = fontName.replace(_weight, '').trim()
        weight ??= _weight
        break
      }
    }

    weight ??= 'regular'

    const key = fontName + ' ' + weight
    if (this._checkedFonts.has(key)) return
    this._checkedFonts.add(key)

    try {
      const font = this._availableFonts[key] ?? this._availableFonts[fontName] ?? await this._queryLocalFont(fontName, weight) ?? await this._queryRemoteFont([key, fontName])
      if (font) return await this.addFonts([font])
    } catch (e) {
      console.warn('Error querying font', fontName, weight, e)
    }
  }

  queryFonts!: 'local' | 'localandremote' | false
  async _queryLocalFont (fontName: string, weight: WeightValue) {
    if (!this.queryFonts) return
    return await this._getFont(fontName, weight)
  }

  async _queryRemoteFont (postscriptNames: string[]) {
    if (this.queryFonts !== 'localandremote') return

    const fontData = await queryRemoteFonts({ postscriptNames })
    if (!fontData.length) return
    const blob = await fontData[0]!.blob()
    return new Uint8Array(await blob.arrayBuffer())
  }

  async _asyncWrite (font: string) {
    const res = await _fetch(font)
    this._allocFonts([new Uint8Array(await res.arrayBuffer())])
  }

  _fontId = 0
  _allocFonts (uint8s: Uint8Array[]) {
    // TODO: this should re-draw last frame!
    for (const uint8 of uint8s) {
      const ptr = this._malloc(uint8.byteLength)
      self.HEAPU8RAW.set(uint8, ptr)
      this._wasm.addFont('font-' + (this._fontId++), ptr, uint8.byteLength)
    }
    this._wasm.reloadFonts()
  }

  _resizeCanvas (width: number, height: number, videoWidth: number, videoHeight: number) {
    this._wasm.resizeCanvas(width, height, videoWidth, videoHeight)
    this._gpurender.resizeCanvas(width, height)
  }

  async [finalizer] () {
    this._wasm.quitLibrary()
    this._gpurender.destroy()
    // @ts-expect-error force GC
    this._wasm = null
    // @ts-expect-error force GC
    this._gpurender = null
    this._availableFonts = {}
  }

  _draw (time: number, repaint = false) {
    const images = this._wasm.rawRender(time, Number(repaint)) as ASSImage[] | null
    if (!images) return

    this._gpurender.render(images, self.HEAPU8RAW)
  }

  _setColorSpace (videoColorSpace: 'RGB' | 'BT709' | 'BT601') {
    if (videoColorSpace === 'RGB') return
    this._videoColorSpace = videoColorSpace
    this._checkColorSpace()
  }
}

if (self.name === 'jassub-worker') {
  expose(ASSRenderer)
}
