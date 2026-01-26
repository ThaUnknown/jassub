/* eslint-disable camelcase */
import { finalizer } from 'abslink'
import { expose } from 'abslink/w3c'
import { queryRemoteFonts } from 'lfa-ponyfill'

import WASM from '../wasm/jassub-worker.js'

import { _applyKeys, _fetch, fetchtext, IS_FIREFOX, LIBASS_YCBCR_MAP, WEIGHT_MAP, type ASSEvent, type ASSImage, type ASSStyle, type WeightValue } from './util.ts'
import { WebGL2Renderer } from './webgl-renderer.ts'

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

export class ASSRenderer {
  _offCanvas?: OffscreenCanvas
  _wasm!: JASSUB
  _subtitleColorSpace?: 'BT601' | 'BT709' | 'SMPTE240M' | 'FCC' | null
  _videoColorSpace?: 'BT709' | 'BT601'
  _malloc!: (size: number) => number
  _gpurender = new WebGL2Renderer()

  debug = false

  _ready

  constructor (data: opts, getFont: (font: string, weight: WeightValue) => Promise<Uint8Array<ArrayBuffer> | undefined>) {
    // remove case sensitivity
    this._availableFonts = Object.fromEntries(Object.entries(data.availableFonts).map(([k, v]) => [k.trim().toLowerCase(), v]))
    this.debug = data.debug
    this.queryFonts = data.queryFonts
    this._getFont = getFont
    this._defaultFont = data.defaultFont.trim().toLowerCase()

    // hack, we want custom WASM URLs
    const _fetch = globalThis.fetch
    globalThis.fetch = _ => _fetch(data.wasmUrl)

    // TODO: abslink doesnt support transferables yet
    const handleMessage = async ({ data }: MessageEvent) => {
      if (data.name === 'offscreenCanvas') {
        // await this._ready // needed for webGPU
        this._offCanvas = data.ctrl
        this._gpurender.setCanvas(this._offCanvas!)
        removeEventListener('message', handleMessage)
      }
    }
    addEventListener('message', handleMessage)

    // const devicePromise = navigator.gpu?.requestAdapter({
    //   powerPreference: 'high-performance'
    // }).then(adapter => adapter?.requestDevice())

    // eslint-disable-next-line @typescript-eslint/unbound-method
    this._ready = (WASM({ __url: data.wasmUrl, __out: (log: string) => this._log(log) }) as Promise<MainModule>).then(async ({ _malloc, JASSUB }) => {
      this._malloc = _malloc

      this._wasm = new JASSUB(data.width, data.height, this._defaultFont)
      // Firefox seems to have issues with multithreading in workers
      // a worker inside a worker does not recieve messages properly
      this._wasm.setThreads(!IS_FIREFOX && self.crossOriginIsolated ? Math.min(Math.max(1, navigator.hardwareConcurrency - 2), 8) : 1)

      this._loadInitialFonts(data.fonts)

      this._wasm.createTrackMem(data.subContent ?? await fetchtext(data.subUrl!))

      this._subtitleColorSpace = LIBASS_YCBCR_MAP[this._wasm.trackColorSpace]

      if (data.libassMemoryLimit > 0 || data.libassGlyphLimit > 0) {
        this._wasm.setMemoryLimits(data.libassGlyphLimit || 0, data.libassMemoryLimit || 0)
      }
      // const device = await devicePromise
      // this._gpurender = device ? new WebGPURenderer(device) : new WebGL2Renderer()
      // if (this._offCanvas) this._gpurender.setCanvas(this._offCanvas, this._offCanvas.width, this._offCanvas.height)
      this._checkColorSpace()
    })
  }

  ready () {
    return this._ready
  }

  createEvent (event: ASSEvent) {
    _applyKeys(event, this._wasm.getEvent(this._wasm.allocEvent())!)
  }

  getEvents () {
    const events: Array<Partial<ASSEvent>> = []
    for (let i = 0; i < this._wasm.getEventCount(); i++) {
      const { Start, Duration, ReadOrder, Layer, Style, MarginL, MarginR, MarginV, Name, Text, Effect } = this._wasm.getEvent(i)!
      events.push({ Start, Duration, ReadOrder, Layer, Style, MarginL, MarginR, MarginV, Name, Text, Effect })
    }
    return events
  }

  setEvent (event: ASSEvent, index: number) {
    _applyKeys(event, this._wasm.getEvent(index)!)
  }

  removeEvent (index: number) {
    this._wasm.removeEvent(index)
  }

  createStyle (style: ASSStyle) {
    const alloc = this._wasm.getStyle(this._wasm.allocStyle())!
    _applyKeys(style, alloc)
    return alloc
  }

  getStyles () {
    const styles: ASSStyle[] = []
    for (let i = 0; i < this._wasm.getStyleCount(); i++) {
    // eslint-disable-next-line @typescript-eslint/naming-convention
      const { Name, FontName, FontSize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding, treat_fontname_as_pattern, Blur, Justify } = this._wasm.getStyle(i)!

      styles.push({ Name, FontName, FontSize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding, treat_fontname_as_pattern, Blur, Justify })
    }
    return styles
  }

  setStyle (style: ASSStyle, index: number) {
    _applyKeys(style, this._wasm.getStyle(index)!)
  }

  removeStyle (index: number) {
    this._wasm.removeStyle(index)
  }

  styleOverride (style: ASSStyle) {
    this._wasm.styleOverride(this.createStyle(style))
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

  _defaultFont
  setDefaultFont (fontName: string) {
    this._defaultFont = fontName.trim().toLowerCase()
    this._wasm.setDefaultFont(this._defaultFont)
  }

  async _log (log: string) {
    console.debug(log)
    const match = log.match(/JASSUB: fontselect:[^(]+: \(([^,]+), (\d{1,4}), \d\)/)
    if (match && !await this._findAvailableFont(match[1]!.trim().toLowerCase(), WEIGHT_MAP[parseInt(match[2]!, 10) / 100 - 1])) {
      await this._findAvailableFont(this._defaultFont)
    }
  }

  async addFonts (fontOrURLs: Array<Uint8Array | string>) {
    if (!fontOrURLs.length) return
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
    return await Promise.allSettled(strings.map(url => this._asyncWrite(url)))
  }

  // we don't want to run _findAvailableFont before initial fonts are loaded
  // because it could duplicate fonts
  _loadedInitialFonts = false
  async _loadInitialFonts (fontOrURLs: Array<Uint8Array | string>) {
    await this.addFonts(fontOrURLs)
    this._loadedInitialFonts = true
  }

  _getFont
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
      const font = this._availableFonts[key] ?? this._availableFonts[fontName] ?? await this._queryLocalFont(fontName, weight) ?? await this._queryRemoteFont(fontName, key)
      if (font) return await this.addFonts([font])
    } catch (e) {
      console.warn('Error querying font', fontName, weight, e)
    }
  }

  queryFonts
  async _queryLocalFont (fontName: string, weight: WeightValue) {
    if (!this.queryFonts) return
    return await this._getFont(fontName, weight)
  }

  async _queryRemoteFont (fontName: string, postscriptName: string) {
    if (this.queryFonts !== 'localandremote') return

    const fontData = await queryRemoteFonts({ postscriptNames: [postscriptName, fontName] })
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
    await this._ready
    this._wasm.quitLibrary()
    this._gpurender.destroy()
    // @ts-expect-error force GC
    this._wasm = null
    // @ts-expect-error force GC
    this._gpurender = null
    this._availableFonts = {}
  }

  _draw (time: number, repaint = false) {
    if (!this._offCanvas || !this._gpurender) return

    const result = this._wasm.rawRender(time, Number(repaint))!
    if (this._wasm.changed === 0 && !repaint) return

    const bitmaps: ASSImage[] = []

    for (let image = result, i = 0; i < this._wasm.count; image = image.next!, ++i) {
      // @ts-expect-error internal emsc types
      bitmaps.push({
        bitmap: image.bitmap,
        color: image.color,
        dst_x: image.dst_x,
        dst_y: image.dst_y,
        h: image.h,
        stride: image.stride,
        w: image.w
      })
    }
    this._gpurender.render(bitmaps, self.HEAPU8RAW)
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
