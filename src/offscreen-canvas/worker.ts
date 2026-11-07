import { transferHandlers, type Endpoint, type TransferHandler } from 'abslink'

import { CANVAS_TRANSFER_HANDLER, CLEAR_BLIT, type RemoteCanvasBlitFrame, type RemoteCanvasInit, type RemoteCanvasPage } from './protocol.ts'

type CanvasTransport = 'pages' | 'bitmap'

let transport: CanvasTransport = 'pages'

function canCreateBitmaps () {
  const global = self as unknown as { createImageBitmap?: unknown, ImageData?: unknown }
  return typeof global.createImageBitmap === 'function' && typeof global.ImageData === 'function' && global.ImageData !== SoftwareImageData
}

export function chooseCanvasTransport () {
  transport = canCreateBitmaps() ? 'bitmap' : 'pages'
  return transport
}

export class SoftwareImageData {
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number
  readonly colorSpace = 'srgb'

  constructor (dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
    if (typeof dataOrWidth === 'number') {
      this.width = dataOrWidth
      this.height = widthOrHeight
      this.data = new Uint8ClampedArray(this.width * this.height * 4)
    } else {
      this.data = dataOrWidth
      this.width = widthOrHeight
      this.height = height ?? dataOrWidth.length / 4 / widthOrHeight
    }
  }
}

interface ImageDataLike {
  data: Uint8ClampedArray
  width: number
  height: number
}

// The last page a canvas received, either as pixels or as a bitmap in the making.
interface Page {
  width: number
  height: number
  pixels: ArrayBuffer | null
  bitmap: Promise<ImageBitmap> | null
  // Where the page sits on its canvas. drawImage coordinates are relative to the canvas.
  x: number
  y: number
}

export class SoftwareCanvasContext2D {
  readonly canvas: SoftwareOffscreenCanvas
  imageSmoothingEnabled = true

  constructor (canvas: SoftwareOffscreenCanvas) {
    this.canvas = canvas
  }

  clearRect (x: number, y: number, w: number, h: number) {
    this.canvas.record(CLEAR_BLIT, 0, 0, 0, 0, x, y, w, h)
  }

  putImageData (image: ImageDataLike, dx: number, dy: number, dirtyX = 0, dirtyY = 0, dirtyW = image.width, dirtyH = image.height) {
    const rows = Math.min(image.height, dirtyY + dirtyH)
    const canvas = this.canvas
    const page: Page = canvas.page = {
      width: image.width,
      height: rows,
      pixels: transport === 'bitmap' ? null : image.data.buffer.slice(image.data.byteOffset, image.data.byteOffset + image.width * rows * 4) as ArrayBuffer,
      bitmap: transport === 'bitmap' ? createImageBitmap(image as ImageData, 0, 0, image.width, rows) : null,
      x: dx,
      y: dy
    }
    canvas.record(0, dirtyX, dirtyY, dirtyW, dirtyH, dx + dirtyX, dy + dirtyY, dirtyW, dirtyH, page)
  }

  drawImage (source: SoftwareOffscreenCanvas, ...args: number[]) {
    const page = source.page
    if (!page) return
    let sx = 0; let sy = 0; let sw = source.width; let sh = source.height
    let dx: number; let dy: number; let dw: number; let dh: number
    if (args.length >= 8) {
      [sx, sy, sw, sh, dx, dy, dw, dh] = args as [number, number, number, number, number, number, number, number]
    } else if (args.length >= 4) {
      [dx, dy, dw, dh] = args as [number, number, number, number]
    } else {
      [dx, dy] = args as [number, number]
      dw = sw
      dh = sh
    }
    this.canvas.record(0, sx - page.x, sy - page.y, sw, sh, dx, dy, dw, dh, page)
  }

  getImageData (_x: number, _y: number, w: number, h: number) {
    return new SoftwareImageData(w, h)
  }
}

interface RemoteTransport {
  id: number
  ep: Endpoint
}

export class SoftwareOffscreenCanvas {
  _width: number
  _height: number
  _context: SoftwareCanvasContext2D | null = null
  _transport: RemoteTransport | null = null

  // As a source: the last page written with putImageData.
  page: Page | null = null

  // As a target: the frame being recorded.
  _clearAll = false
  _pages: Page[] = []
  _blits: number[] = []
  _flushScheduled = false
  // One flush at a time. jassub clears the canvas first in every frame, so a render that happens
  // while a frame is on its way collapses into the newest frame and nothing queues up.
  _flushing = false

  constructor (width: number, height: number) {
    this._width = width
    this._height = height
  }

  get width () { return this._width }
  set width (value: number) { this._resize(value, this._height) }
  get height () { return this._height }
  set height (value: number) { this._resize(this._width, value) }

  _resize (width: number, height: number) {
    this._width = width
    this._height = height
    this.record(CLEAR_BLIT, 0, 0, 0, 0, 0, 0, width, height)
  }

  getContext (type: string, _options?: unknown) {
    if (type !== '2d') return null
    this._context ??= new SoftwareCanvasContext2D(this)
    return this._context
  }

  addEventListener () {}
  removeEventListener () {}
  dispatchEvent () { return true }

  attach (transport: RemoteTransport) {
    this._transport = transport
  }

  record (pageOrClear: number, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number, page?: Page) {
    if (!this._transport) return
    if (page) {
      pageOrClear = this._pages.indexOf(page)
      if (pageOrClear === -1) pageOrClear = this._pages.push(page) - 1
    } else if (dx <= 0 && dy <= 0 && dx + dw >= this._width && dy + dh >= this._height) {
      this._clearAll = true
      this._blits.length = 0
      for (const dropped of this._pages) dropped.bitmap?.then(bitmap => bitmap.close())
      this._pages.length = 0
      this._scheduleFlush()
      return
    }
    this._blits.push(pageOrClear, sx, sy, sw, sh, dx, dy, dw, dh)
    this._scheduleFlush()
  }

  // A render is synchronous, so one microtask after the first call captures the whole frame.
  _scheduleFlush () {
    if (this._flushScheduled || this._flushing) return
    this._flushScheduled = true
    Promise.resolve().then(() => this._flush())
  }

  async _flush () {
    this._flushScheduled = false
    const { ep, id } = this._transport!
    const pages = this._pages
    const frame: RemoteCanvasBlitFrame = { remoteCanvasBlits: id, width: this._width, height: this._height, clearAll: this._clearAll, pages: [], blits: Int32Array.from(this._blits) }
    this._clearAll = false
    this._pages = []
    this._blits = []

    this._flushing = true
    try {
      const transfer: Transferable[] = [frame.blits.buffer]
      for (const page of pages) {
        const sent: RemoteCanvasPage = { width: page.width, height: page.height, pixels: page.pixels, bitmap: page.bitmap ? await page.bitmap : null }
        frame.pages.push(sent)
        transfer.push(sent.bitmap ?? sent.pixels!)
      }
      ep.postMessage(frame, transfer)
    } catch (error) {
      // createImageBitmap failed, or the browser cannot transfer bitmaps (Chrome 50 and 51). This frame is lost.
      console.warn('jassub-legacy: bitmap frame failed, switching to the pages transport', error)
      transport = 'pages'
    } finally {
      this._flushing = false
    }
    if (this._clearAll || this._blits.length) this._scheduleFlush()
  }
}

const handler: TransferHandler<SoftwareOffscreenCanvas, RemoteCanvasInit> = {
  canHandle: (value): value is SoftwareOffscreenCanvas => false,
  serialize () {
    throw new Error('jassub-legacy: a software canvas cannot leave the worker')
  },
  deserialize (init, ep) {
    const canvas = new SoftwareOffscreenCanvas(init.width, init.height)
    canvas.attach({ id: init.id, ep })
    return canvas
  }
}

export function registerRemoteCanvasHandler () {
  transferHandlers.set(CANVAS_TRANSFER_HANDLER, handler)
}
