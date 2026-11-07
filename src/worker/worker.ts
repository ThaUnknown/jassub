import { finalizer } from 'abslink'
import { expose } from 'abslink/w3c'
import { queryRemoteFonts } from 'lfa-ponyfill'

import { COLOR_CONVERSIONS, IDENTITY_MATRIX, LIBASS_YCBCR_MATRIX, WEB_MATRIX_COEFFICIENTS, type ColorSpace, type WebMatrixCoefficients } from './color-conversions.ts'
import { Canvas2DRenderer } from './renderers/2d-renderer.ts'
import { WebGL1Renderer } from './renderers/webgl1-renderer.ts'
import { WebGL2Renderer } from './renderers/webgl2-renderer.ts'
// import { WebGPURenderer } from './renderers/webgpu-renderer.ts'
import { fetchok, fetchtext, THREAD_COUNT, WEIGHT_MAP, type ASSEvent, type ASSImage, type ASSStyle, type WeightValue } from './util.ts'

import type { JASSUB, MainModule } from '../wasm/types.d.ts'

declare const self: DedicatedWorkerGlobalScope &
  typeof globalThis & {
    HEAPU8RAW: Uint8Array<ArrayBuffer>
  }

interface opts {
  wasmUrl: string
  wasmWorkerUrl: string
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

function readImages (view: Int32Array) {
  const images: ASSImage[] = []
  for (let i = 0; i < view.length; i += 8) {
    images.push({
      w: view[i]!,
      h: view[i + 1]!,
      dst_x: view[i + 2]!,
      dst_y: view[i + 3]!,
      // bitmap, color and cache_id are unsigned in C
      bitmap: view[i + 4]! >>> 0,
      color: view[i + 5]! >>> 0,
      stride: view[i + 6]!,
      cache_id: view[i + 7]! >>> 0
    })
  }
  return images
}

function renderError (e: unknown) {
  if (e instanceof Error) return e
  if (e === 'unwind') return new Error('JASSUB: a render thread crashed, the WASM heap probably could not grow')
  if (!e) return new Error('JASSUB: rendering aborted, the WASM heap probably could not grow')
  return new Error(`JASSUB: rendering failed: ${JSON.stringify(e)}`)
}

const NO_TRACK = 'JASSUB: no track is loaded'
const INVALID_TRACK = 'JASSUB: libass rejected the subtitle content, it is not a valid SSA/ASS track'

const WEIGHT_SUFFIX = new RegExp(`^(.+)\\s+(${WEIGHT_MAP.join('|')})$`)

export class ASSRenderer {
  _wasm!: JASSUB
  // undefined: no conversion
  _videoColorSpace?: ColorSpace
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

    // the WebGPU device request is async, so it runs while the WASM loads
    // const webgpu = WebGPURenderer.isSupported(ctrl)
    // WebGL2 is barely faster than WebGL1 in most cases,
    // in rare cases the better texture-dedupe, drawing everything in one call, no fake stride and no page ordering
    // can help its performance, but those cases are rare
    this._gpurender = WebGL2Renderer.isSupported(ctrl) ?? WebGL1Renderer.isSupported(ctrl) ?? new Canvas2DRenderer(ctrl)

    ctrl.addEventListener('webglcontextrestored', () => {
      if (this._lastDrawTime) this._draw(this._lastDrawTime, true)
    })

    this._loadedInitialFonts = !data.fonts.length

    const { default: WASM } = await import(/* @vite-ignore */ /* webpackIgnore: true */ data.wasmWorkerUrl) as { default: (moduleArg: object) => Promise<MainModule> }
    // Emscripten pre-spawns pthread workers from this pool size.
    // A pool size of 0 pre-spawns no workers.
    // libass reads 0 as auto, but emscripten does not.
    // THREAD_COUNT is 1 when rendering is serial. Pass 0 in that case.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { _malloc, JASSUB } = await WASM({ __url: data.wasmUrl, __workerUrl: data.wasmWorkerUrl, __poolSize: THREAD_COUNT > 1 ? THREAD_COUNT : 0, __out: (log: string) => this._log(log) })
    // lfa-ponyfill uses the global fetch.
    globalThis.fetch = _fetch
    this._malloc = _malloc

    this._wasm = new JASSUB(data.width, data.height, this._defaultFont)
    this._wasm.setThreads(THREAD_COUNT)

    if (!this._loadedInitialFonts) await this._loadInitialFonts(data.fonts)

    if (!this._wasm.createTrackMem(data.subContent ?? await fetchtext(data.subUrl!))) throw new Error(INVALID_TRACK)

    if (data.libassMemoryLimit > 0 || data.libassGlyphLimit > 0) {
      this._wasm.setMemoryLimits(data.libassGlyphLimit || 0, data.libassMemoryLimit || 0)
    }
    this._checkColorSpace()

    return this
  }

  // this passes a string of track data to libass, be it styles, events etc, which it then processes and adds to the track
  // useful for streaming subtitles
  processData (events: string) {
    if (!this._wasm.processData(events)) throw new Error(NO_TRACK)
  }

  // processes a single subtitle packet with ReadOrder, timecode and duration
  // useful for streaming subtitles from Matroska-style demuxers
  processChunk (data: string, timecode: number, duration: number) {
    if (!this._wasm.processChunk(data, timecode, duration)) throw new Error(NO_TRACK)
  }

  // removes all events that ended before the deadline, in milliseconds
  pruneEvents (deadline: number) {
    if (!this._wasm.pruneEvents(deadline)) throw new Error(NO_TRACK)
  }

  // after every render, libass removes the events that ended more than delay milliseconds ago
  _pruneDelay = -1
  configurePrune (delay: number) {
    this._pruneDelay = delay
    this._wasm.configurePrune(delay)
  }

  // removes all events, but keeps the styles and the script info
  removeAllEvents () {
    if (!this._wasm.removeAllEvents()) throw new Error(NO_TRACK)
  }

  createEvent (event: ASSEvent) {
    if (!this._wasm.createEvent(event)) throw new Error(NO_TRACK)
  }

  getEvents (): Array<Partial<ASSEvent>> {
    return this._wasm.getEvents()
  }

  setEvent (event: ASSEvent, index: number) {
    if (!this._wasm.setEvent(index, event)) throw new RangeError(`JASSUB: no event at index ${index}`)
  }

  removeEvent (index: number) {
    if (!this._wasm.removeEvent(index)) throw new RangeError(`JASSUB: no event at index ${index}`)
  }

  createStyle (style: ASSStyle) {
    if (!this._wasm.createStyle(style)) throw new Error(NO_TRACK)
  }

  getStyles (): ASSStyle[] {
    return this._wasm.getStyles()
  }

  setStyle (style: ASSStyle, index: number) {
    if (!this._wasm.setStyle(index, style)) throw new RangeError(`JASSUB: no style at index ${index}`)
  }

  removeStyle (index: number) {
    if (!this._wasm.removeStyle(index)) throw new RangeError(`JASSUB: no style at index ${index}`)
  }

  styleOverride (style: ASSStyle) {
    this._wasm.styleOverride(style)
  }

  disableStyleOverride () {
    this._wasm.disableStyleOverride()
  }

  setTrack (content: string) {
    if (!this._wasm.createTrackMem(content)) throw new Error(INVALID_TRACK)
    this._wasm.configurePrune(this._pruneDelay)

    this._checkColorSpace()
  }

  freeTrack () {
    this._wasm.removeTrack()
  }

  async setTrackByUrl (url: string) {
    this.setTrack(await fetchtext(url))
  }

  _checkColorSpace () {
    const subtitle = LIBASS_YCBCR_MATRIX[this._wasm.trackColorSpace]
    this._gpurender.setColorConversion(new Float32Array(
      (subtitle && this._videoColorSpace && COLOR_CONVERSIONS[subtitle][this._videoColorSpace]) ?? IDENTITY_MATRIX
    ))
    if (this._lastDrawTime) this._draw(this._lastDrawTime, true)
  }

  _defaultFont!: string
  setDefaultFont (fontName: string) {
    this._defaultFont = fontName.trim().toLowerCase()
    this._wasm.setDefaultFont(this._defaultFont)
  }

  async _log (log: string) {
    console.debug(log)
    const match = log.match(/JASSUB: fontselect:[^(]+: \(([^,]*), (\d{1,4}), \d+\)/)
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
    const results = await Promise.allSettled(strings.map(url => this._asyncWrite(url)))
    for (const result of results) {
      if (result.status === 'rejected') console.warn('JASSUB: failed to load font', result.reason)
    }
    return true
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
    // Roboto Medium, Bold -> Roboto, Medium
    // Roboto, null -> Roboto, Regular
    // italic is not handled I guess
    const match = fontName.match(WEIGHT_SUFFIX)
    if (match) {
      fontName = match[1]!
      weight = match[2] as WeightValue
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
    const res = await fetchok(font)
    this._allocFonts([new Uint8Array(await res.arrayBuffer())])
  }

  _fontId = 0
  _allocFonts (uint8s: Uint8Array[]) {
    // TODO: this should re-draw last frame!
    for (const uint8 of uint8s) {
      const ptr = this._malloc(uint8.byteLength) >>> 0
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

  _lastDrawTime?: number
  _draw (time: number, repaint = false) {
    this._lastDrawTime = time
    try {
      const view = this._wasm.rawRender(time, Number(repaint)) as Int32Array | null
      if (!view) return

      this._gpurender.render(readImages(view), self.HEAPU8RAW)
    } catch (e) {
      throw renderError(e)
    }
  }

  // single-frame readback for tests
  _drawCapture (time: number) {
    const view = this._wasm.rawRender(time, 1) as Int32Array | null
    this._gpurender.render(view ? readImages(view) : [], self.HEAPU8RAW)

    const canvas = this._gpurender.canvas
    if (!canvas) return
    const { width, height } = canvas
    const surface = new OffscreenCanvas(width, height)
    const ctx = surface.getContext('2d')
    if (!ctx) return
    ctx.drawImage(canvas, 0, 0)
    return { data: ctx.getImageData(0, 0, width, height).data, width, height }
  }

  _setColorSpace (matrix?: WebMatrixCoefficients | null, fullRange?: boolean | null) {
    this._videoColorSpace = matrix && matrix !== 'rgb' ? `${WEB_MATRIX_COEFFICIENTS[matrix]} ${fullRange ? 'PC' : 'TV'}` : undefined
    this._checkColorSpace()
  }
}

if (self.name === 'jassub-worker') {
  expose(ASSRenderer)
}
