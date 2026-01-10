/* eslint-disable camelcase */
import { finalizer } from 'abslink'
import { expose } from 'abslink/w3c'

import WASM from '../wasm/jassub-worker.js'

import { libassYCbCrMap, read_, readAsync, _applyKeys } from './util'
import { colorMatrixConversionMap, detectRenderer, type Renderer } from './renderer'
import { WebGPURenderer } from './webgpu-renderer'
import { WebGL2Renderer } from './webgl2-renderer'

import type { ASSEvent, ASSImage, ASSStyle } from '../jassub'
import type { JASSUB, MainModule } from '../wasm/types.js'

declare const self: DedicatedWorkerGlobalScope &
  typeof globalThis & {
    HEAPU8RAW: Uint8Array<ArrayBuffer>
  }

interface opts {
  wasmUrl: string
  width: number
  height: number
  subUrl: string | undefined
  subContent: string | null
  fonts: Array<string | Uint8Array>
  availableFonts: Record<string, Uint8Array | string>
  fallbackFont: string
  debug: boolean
  libassMemoryLimit: number
  libassGlyphLimit: number
  useLocalFonts: boolean
}

export class ASSRenderer {
  _offCanvas?: OffscreenCanvas
  _wasm!: JASSUB
  _subtitleColorSpace?: 'BT601' | 'BT709' | 'SMPTE240M' | 'FCC' | null
  _videoColorSpace?: 'BT709' | 'BT601'
  _malloc!: (size: number) => number
  _renderer!: Renderer

  debug = false
  useLocalFonts = false
  _availableFonts: Record<string, Uint8Array | string> = {}
  _fontMap: Record<string, boolean> = {}
  _fontId = 0

  _ready
  _getFont

  constructor (data: opts, getFont: (font: string) => Promise<void>) {
    this._availableFonts = data.availableFonts
    this.debug = data.debug
    this.useLocalFonts = data.useLocalFonts
    this._getFont = getFont

    // hack, we want custom WASM URLs
    const _fetch = globalThis.fetch
    globalThis.fetch = _ => _fetch(data.wasmUrl)

    // TODO: abslink doesnt support transferables yet
    const handleMessage = ({ data }: MessageEvent) => {
      if (data.name === 'offscreenCanvas') {
        this._offCanvas = data.ctrl
        removeEventListener('message', handleMessage)
      }
    }
    addEventListener('message', handleMessage)

    this._ready = (async () => {
      // Detect and create appropriate renderer
      const rendererType = await detectRenderer()
      console.log(`JASSUB: Using ${rendererType.toUpperCase()} renderer`)
      this._renderer = rendererType === 'webgpu' ? new WebGPURenderer() : new WebGL2Renderer()
      await this._renderer.ready()
      console.log(`JASSUB: ${rendererType.toUpperCase()} renderer initialized successfully`)

      // Set canvas if already received
      if (this._offCanvas) {
        await this._renderer.setCanvas(this._offCanvas, this._offCanvas.width, this._offCanvas.height)
      }

      console.log('JASSUB: Loading WASM module...')
      console.log('JASSUB: crossOriginIsolated:', self.crossOriginIsolated)
      console.log('JASSUB: SharedArrayBuffer available:', typeof SharedArrayBuffer !== 'undefined')
      console.log('JASSUB: wasmUrl:', data.wasmUrl)
      console.log('JASSUB: userAgent:', navigator.userAgent)

      // Detect Firefox - has known bug with WebAssembly.instantiateStreaming hanging
      const isFirefox = navigator.userAgent.toLowerCase().includes('firefox')
      console.log('JASSUB: isFirefox:', isFirefox)

      // Firefox workaround: Replace instantiateStreaming with non-streaming version
      // See: https://github.com/emscripten-core/emscripten/issues/22685
      if (isFirefox) {
        console.log('JASSUB: Applying Firefox WebAssembly.instantiateStreaming polyfill')
        const originalInstantiateStreaming = WebAssembly.instantiateStreaming
        WebAssembly.instantiateStreaming = async (response, importObject) => {
          console.log('JASSUB: Firefox polyfill - using non-streaming instantiate')
          const source = await (await response).arrayBuffer()
          return WebAssembly.instantiate(source, importObject)
        }
      }

      let Module: MainModule
      try {
        console.log('JASSUB: Calling WASM loader...')
        // Add timeout to detect hanging
        const timeoutId = setTimeout(() => {
          console.error('JASSUB: WASM loading timeout (10s) - likely hanging')
        }, 10000)
        Module = await WASM({ __url: data.wasmUrl }) as MainModule
        clearTimeout(timeoutId)
        console.log('JASSUB: WASM module loaded')
      } catch (e) {
        console.error('JASSUB: WASM loading failed:', e)
        throw e
      }
      // eslint-disable-next-line @typescript-eslint/unbound-method
      this._malloc = Module._malloc

      const fallbackFont = data.fallbackFont.toLowerCase()
      this._wasm = new Module.JASSUB(data.width, data.height, fallbackFont)
      this._wasm.setThreads(self.crossOriginIsolated ? Math.min(Math.max(1, navigator.hardwareConcurrency - 2), 8) : 1)

      if (fallbackFont) this._findAvailableFonts(fallbackFont)

      const subContent = data.subContent ?? read_(data.subUrl!)

      for (const font of data.fonts) this._asyncWrite(font)

      this._wasm.createTrackMem(subContent)
      this._processAvailableFonts(subContent)

      this._subtitleColorSpace = libassYCbCrMap[this._wasm.trackColorSpace]

      if (data.libassMemoryLimit > 0 || data.libassGlyphLimit > 0) {
        this._wasm.setMemoryLimits(data.libassGlyphLimit || 0, data.libassMemoryLimit || 0)
      }
      this._checkColorSpace()
    })()
  }

  ready () {
    return this._ready
  }

  addFont (fontOrURL: Uint8Array | string) {
    this._asyncWrite(fontOrURL)
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

  setDefaultFont (fontName: string) {
    this._wasm.setDefaultFont(fontName)
  }

  setTrack (content: string) {
    this._wasm.createTrackMem(content)
    this._processAvailableFonts(content)

    this._subtitleColorSpace = libassYCbCrMap[this._wasm.trackColorSpace]!
  }

  freeTrack () {
    this._wasm.removeTrack()
  }

  setTrackByUrl (url: string) {
    this.setTrack(read_(url))
  }

  _checkColorSpace () {
    if (!this._subtitleColorSpace || !this._videoColorSpace) return
    this._renderer.setColorMatrix(colorMatrixConversionMap[this._subtitleColorSpace][this._videoColorSpace])
  }

  _findAvailableFonts (font: string) {
    font = font.trim().toLowerCase()

    if (font[0] === '@') font = font.substring(1)

    if (this._fontMap[font]) return

    this._fontMap[font] = true

    if (!this._availableFonts[font]) {
      if (this.useLocalFonts) this._getFont(font)
    } else {
      this._asyncWrite(this._availableFonts[font]!)
    }
  }

  _asyncWrite (font: Uint8Array | string) {
    if (typeof font === 'string') {
      readAsync(font, fontData => {
        this._allocFont(new Uint8Array(fontData))
      }, console.error)
    } else {
      this._allocFont(font)
    }
  }

  // TODO: this should re-draw last frame!
  _allocFont (uint8: Uint8Array) {
    const ptr = this._malloc(uint8.byteLength)
    self.HEAPU8RAW.set(uint8, ptr)
    this._wasm.addFont('font-' + (this._fontId++), ptr, uint8.byteLength)
    this._wasm.reloadFonts()
  }

  _processAvailableFonts (content: string) {
    if (!this._availableFonts) return

    for (const { FontName } of this.getStyles()) {
      this._findAvailableFonts(FontName)
    }

    const regex = /\\fn([^\\}]*?)[\\}]/g
    let matches
    while ((matches = regex.exec(content)) !== null) {
      this._findAvailableFonts(matches[1]!)
    }
  }

  _canvas (width: number, height: number, videoWidth: number, videoHeight: number) {
    if (this._offCanvas) this._renderer.setCanvas(this._offCanvas, width, height)

    this._wasm.resizeCanvas(width, height, videoWidth, videoHeight)
  }

  [finalizer] () {
    this._wasm.quitLibrary()
    this._renderer.destroy()
    // @ts-expect-error force GC
    this._wasm = null
    // @ts-expect-error force GC
    this._renderer = null
    this._availableFonts = {}
  }

  _draw (time: number, force = false) {
    if (!this._offCanvas) return

    const result: ASSImage = this._wasm.rawRender(time, Number(force))!
    if (this._wasm.changed === 0 && !force) return

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
    this._renderer.render(bitmaps, self.HEAPU8RAW)
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
