import 'rvfc-polyfill'

import { proxy, releaseProxy } from 'abslink'
import { wrap } from 'abslink/w3c'

import { Debug } from './debug.ts'

import type { WeightValue } from './worker/util.ts'
import type { ASSRenderer } from './worker/worker'
import type { Remote } from 'abslink'
import type { queryRemoteFonts } from 'lfa-ponyfill'

declare const self: typeof globalThis & {
  queryLocalFonts: (opts?: { postscriptNames?: string[] }) => ReturnType<typeof queryRemoteFonts>
}

const webYCbCrMap = {
  rgb: 'RGB',
  bt709: 'BT709',
  // these might not be exactly correct? oops?
  bt470bg: 'BT601', // alias BT.601 PAL... whats the difference?
  smpte170m: 'BT601'// alias BT.601 NTSC... whats the difference?
} as const

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
} & ({
  video: HTMLVideoElement
  canvas?: HTMLCanvasElement
} | {
  video?: HTMLVideoElement
  canvas: HTMLCanvasElement
}) & ({
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
  renderer!: Remote<ASSRenderer>
  ready
  busy = false
  _video
  _videoWidth = 0
  _videoHeight = 0
  _videoColorSpace: string | null = null
  _canvas
  _canvasParent
  _ctrl = new AbortController()
  _ro = new ResizeObserver(async () => {
    await this.ready
    this.resize()
  })

  _destroyed = false
  _lastDemandTime!: VideoFrameCallbackMetadata
  _skipped = false
  _worker
  constructor (opts: JASSUBOptions) {
    if (!globalThis.Worker) throw new Error('Worker not supported')
    if (!opts) throw new Error('No options provided')
    if (!opts.video && !opts.canvas) throw new Error('You should give video or canvas in options.')

    JASSUB._test()

    this.timeOffset = opts.timeOffset ?? 0
    this._video = opts.video
    this._canvas = opts.canvas ?? document.createElement('canvas')
    if (this._video && !opts.canvas) {
      this._canvasParent = document.createElement('div')
      this._canvasParent.className = 'JASSUB'
      this._canvasParent.style.position = 'relative'

      this._canvas.style.display = 'block'
      this._canvas.style.position = 'absolute'
      this._canvas.style.pointerEvents = 'none'
      this._canvasParent.appendChild(this._canvas)

      this._video.insertAdjacentElement('afterend', this._canvasParent)
    }

    const ctrl = this._canvas.transferControlToOffscreen()

    this.debug = opts.debug ? new Debug() : null

    this.prescaleFactor = opts.prescaleFactor ?? 1.0
    this.prescaleHeightLimit = opts.prescaleHeightLimit ?? 1080
    this.maxRenderHeight = opts.maxRenderHeight ?? 0 // 0 - no limit.

    // yes this is awful, but bundlers check for new Worker(new URL()) patterns, so can't use new Worker(workerUrl ?? new URL(...)) ... bruh
    this._worker = opts.workerUrl
      ? new Worker(opts.workerUrl, { name: 'jassub-worker', type: 'module' })
      : new Worker(new URL('./worker/worker.js', import.meta.url), { name: 'jassub-worker', type: 'module' })

    const Renderer = wrap<typeof ASSRenderer>(this._worker)

    const modern = opts.modernWasmUrl ?? new URL('./wasm/jassub-worker-modern.wasm', import.meta.url).href
    const normal = opts.wasmUrl ?? new URL('./wasm/jassub-worker.wasm', import.meta.url).href

    const availableFonts = opts.availableFonts ?? {}
    if (!availableFonts['liberation sans'] && !opts.defaultFont) {
      availableFonts['liberation sans'] = new URL('./default.woff2', import.meta.url).href
    }

    this.ready = (async () => {
      this.renderer = await new Renderer({
        wasmUrl: JASSUB._supportsSIMD ? modern : normal,
        width: ctrl.width,
        height: ctrl.height,
        subUrl: opts.subUrl,
        subContent: opts.subContent ?? null,
        fonts: opts.fonts ?? [],
        availableFonts,
        defaultFont: opts.defaultFont ?? 'liberation sans',
        debug: !!opts.debug,
        libassMemoryLimit: opts.libassMemoryLimit ?? 0,
        libassGlyphLimit: opts.libassGlyphLimit ?? 0,
        queryFonts: opts.queryFonts ?? 'local'
      }, proxy(font => this._getLocalFont(font))) as unknown as Remote<ASSRenderer>

      await this.renderer.ready()
    })()

    if (this._video) this.setVideo(this._video)
    this._worker.postMessage({ name: 'offscreenCanvas', ctrl }, [ctrl])
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

  async resize (forceRepaint = !!this._video?.paused, width = 0, height = 0, top = 0, left = 0) {
    if ((!width || !height) && this._video) {
      const videoSize = this._getVideoPosition()
      let renderSize = null
      // support anamorphic video
      if (this._videoWidth) {
        const widthRatio = this._video.videoWidth / this._videoWidth
        const heightRatio = this._video.videoHeight / this._videoHeight
        renderSize = this._computeCanvasSize((videoSize.width || 0) / widthRatio, (videoSize.height || 0) / heightRatio)
      } else {
        renderSize = this._computeCanvasSize(videoSize.width || 0, videoSize.height || 0)
      }
      width = renderSize.width
      height = renderSize.height
      if (this._canvasParent) {
        top = videoSize.y - (this._canvasParent.getBoundingClientRect().top - this._video.getBoundingClientRect().top)
        left = videoSize.x
      }
      this._canvas.style.width = videoSize.width + 'px'
      this._canvas.style.height = videoSize.height + 'px'
    }

    if (this._canvasParent) {
      this._canvas.style.top = top + 'px'
      this._canvas.style.left = left + 'px'
    }

    await this.renderer._resizeCanvas(
      width,
      height,
      (this._videoWidth || this._video?.videoWidth) ?? width,
      (this._videoHeight || this._video?.videoHeight) ?? height
    )

    if (this._lastDemandTime) await this._demandRender(forceRepaint)
  }

  _getVideoPosition (width = this._video!.videoWidth, height = this._video!.videoHeight) {
    const videoRatio = width / height
    const { offsetWidth, offsetHeight } = this._video!
    const elementRatio = offsetWidth / offsetHeight
    width = offsetWidth
    height = offsetHeight
    if (elementRatio > videoRatio) {
      width = Math.floor(offsetHeight * videoRatio)
    } else {
      height = Math.floor(offsetWidth / videoRatio)
    }

    const x = (offsetWidth - width) / 2
    const y = (offsetHeight - height) / 2

    return { width, height, x, y }
  }

  _computeCanvasSize (width = 0, height = 0) {
    const scalefactor = this.prescaleFactor <= 0 ? 1.0 : this.prescaleFactor
    const ratio = self.devicePixelRatio || 1

    if (height <= 0 || width <= 0) {
      width = 0
      height = 0
    } else {
      const sgn = scalefactor < 1 ? -1 : 1
      let newH = height * ratio
      if (sgn * newH * scalefactor <= sgn * this.prescaleHeightLimit) {
        newH *= scalefactor
      } else if (sgn * newH < sgn * this.prescaleHeightLimit) {
        newH = this.prescaleHeightLimit
      }

      if (this.maxRenderHeight > 0 && newH > this.maxRenderHeight) newH = this.maxRenderHeight

      width *= newH / height
      height = newH
    }

    return { width, height }
  }

  async setVideo (video: HTMLVideoElement) {
    if (video instanceof HTMLVideoElement) {
      this._removeListeners()
      this._video = video
      await this.ready
      this._video.requestVideoFrameCallback((now, data) => this._handleRVFC(data))
      // everything else is unreliable for this, loadedmetadata and loadeddata included.
      if ('VideoFrame' in globalThis) {
        video.addEventListener('loadedmetadata', () => this._updateColorSpace(), this._ctrl)
        if (video.readyState > 2) this._updateColorSpace()
      }
      if (video.videoWidth > 0) this.resize()
      this._ro.observe(video)
    } else {
      throw new Error('Video element invalid!')
    }
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

  _handleRVFC (data: VideoFrameCallbackMetadata) {
    if (this._destroyed) return

    this._lastDemandTime = data
    this._demandRender()

    this._video!.requestVideoFrameCallback((now, data) => this._handleRVFC(data))
  }

  async _demandRender (repaint = false) {
    const { mediaTime, width, height } = this._lastDemandTime
    if (width !== this._videoWidth || height !== this._videoHeight) {
      this._videoWidth = width
      this._videoHeight = height
      return await this.resize(repaint)
    }

    if (this.busy) {
      this._skipped = true
      this.debug?._drop()
      return
    }

    this.busy = true
    this._skipped = false

    this.debug?._startFrame()
    await this.renderer._draw(mediaTime + this.timeOffset, repaint)
    this.debug?._endFrame(this._lastDemandTime)

    this.busy = false
    if (this._skipped) await this._demandRender()
  }

  async _updateColorSpace () {
    await this.ready
    this._video!.requestVideoFrameCallback(async () => {
      try {
        const frame = new VideoFrame(this._video!)
        frame.close()
        await this.renderer._setColorSpace(webYCbCrMap[frame.colorSpace.matrix!])
      } catch (e) {
        // sources can be tainted
        console.warn(e)
      }
    })
  }

  _removeListeners () {
    if (this._video) {
      if (this._ro) this._ro.unobserve(this._video)
      this._ctrl.abort()
      this._ctrl = new AbortController()
    }
  }

  async destroy () {
    if (this._destroyed) return
    this._destroyed = true
    if (this._video && this._canvasParent) this._video.parentNode?.removeChild(this._canvasParent)
    this._removeListeners()
    await this.renderer?.[releaseProxy]()
    this._worker.terminate()
  }
}
