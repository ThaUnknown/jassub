// fallback for browsers that don't support GPU acceleration
import { CanvasRendererBase, type AtlasItem } from './canvas-base.ts'

import type { ASSImage } from '../util.ts'

declare const self: typeof globalThis & { HEAPU32RAW: Uint32Array }

// clamp to 0-255 with rounding, matching rgba8unorm GPU behaviour
const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 255 : Math.round(v * 255))

const CTX_OPTS = {
  alpha: true,
  desynchronized: true,
  willReadFrequently: false
}
const MIN_PAGE_SIZE = 1024

export class Canvas2DRenderer extends CanvasRendererBase {
  ctx
  bufferCtx
  bufferCanvas = new OffscreenCanvas(MIN_PAGE_SIZE, MIN_PAGE_SIZE)
  // the pixel value for each mask value of one image
  colorTable = new Uint32Array(256)

  pagePixels = new Uint32Array(MIN_PAGE_SIZE * MIN_PAGE_SIZE)
  pageImageData = new ImageData(new Uint8ClampedArray(this.pagePixels.buffer), MIN_PAGE_SIZE, MIN_PAGE_SIZE)

  constructor (canvas: OffscreenCanvas) {
    super(canvas)
    const ctx = canvas.getContext('2d', CTX_OPTS)
    const bufferCtx = this.bufferCanvas.getContext('2d', CTX_OPTS)

    if (!ctx || !bufferCtx) throw new Error('Could not get 2D context')
    this.ctx = ctx
    this.bufferCtx = bufferCtx
    this.ctx.imageSmoothingEnabled = false
  }

  // this should be an svg filter which is cheaper, but not supported
  // https://issues.chromium.org/u/1/issues/40910142
  setColorConversion (matrix: Float32Array) {
    this.colorMatrix = matrix
  }

  render (images: ASSImage[], heap: Uint8Array): void {
    if (this.applyScheduledResize()) this.ctx.imageSmoothingEnabled = false

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)

    const items: AtlasItem[] = []
    let maxWidth = 0
    let maxHeight = 0
    for (const img of images) {
      items.push({ img, sourceKey: 0, x: 0, y: 0, layer: 0 })
      maxWidth = Math.max(maxWidth, img.w)
      maxHeight = Math.max(maxHeight, img.h)
    }

    const canvas = this.bufferCanvas
    if (maxWidth > canvas.width || maxHeight > canvas.height) {
      // a resize clears the canvas, so only resize the side that grows
      if (maxWidth > canvas.width) canvas.width = maxWidth
      if (maxHeight > canvas.height) canvas.height = maxHeight
      this.pagePixels = new Uint32Array(canvas.width * canvas.height)
      this.pageImageData = new ImageData(new Uint8ClampedArray(this.pagePixels.buffer), canvas.width, canvas.height)
    }

    const { width, height } = canvas
    const pixels = this.pagePixels
    const table = this.colorTable
    const words = self.HEAPU32RAW
    const m = this.colorMatrix

    const pageCount = this.packAtlas(items, width, 0, false, height)
    for (let page = 0, start = 0; page < pageCount; page++) {
      let end = start
      let drawWidth = 0
      let drawHeight = 0
      for (; end < items.length && items[end]!.layer === page; end++) {
        const { img, x, y } = items[end]!
        const { w, h, stride } = img

        // libass 0xRRGGBBAA → ImageData little-endian RGBA, convert the color per image
        const r = ((img.color >>> 24) & 0xff) / 255
        const g = ((img.color >>> 16) & 0xff) / 255
        const bl = ((img.color >>> 8) & 0xff) / 255
        const cr = clamp(m[0]! * r + m[3]! * g + m[6]! * bl + m[9]!)
        const cg = clamp(m[1]! * r + m[4]! * g + m[7]! * bl + m[10]!)
        const cb = clamp(m[2]! * r + m[5]! * g + m[8]! * bl + m[11]!)
        const color = (cb << 16) | (cg << 8) | cr
        const alpha = (255 - (img.color & 255)) / 255

        for (let k = 1; k < 256; k++) table[k] = (Math.round(alpha * k) << 24) | color

        const offset = y * width + x
        // read the head bytes up to a 4 byte boundary, then 4 mask values at a time, then the tail bytes, the heap is little-endian like the pixels
        // libass clips an image on the left by moving its bitmap pointer, so a row does not always start aligned
        for (let row = 0, pos = img.bitmap, out = offset; row < h; row++, pos += stride, out += width) {
          const head = Math.min(-pos & 3, w)
          const tail = head + ((w - head) & ~3)
          for (let column = 0; column < head; column++) pixels[out + column] = table[heap[pos + column]!]!
          for (let word = (pos + head) >>> 2, last = (pos + tail) >>> 2, o = out + head; word < last; word++, o += 4) {
            const value = words[word]!
            pixels[o] = table[value & 0xff]!
            pixels[o + 1] = table[(value >>> 8) & 0xff]!
            pixels[o + 2] = table[(value >>> 16) & 0xff]!
            pixels[o + 3] = table[value >>> 24]!
          }
          for (let column = tail; column < w; column++) pixels[out + column] = table[heap[pos + column]!]!
        }

        drawWidth = Math.max(drawWidth, x + w)
        drawHeight = Math.max(drawHeight, y + h)
      }

      this.bufferCtx.putImageData(this.pageImageData, 0, 0, 0, 0, drawWidth, drawHeight)
      for (let i = start; i < end; i++) {
        const { img, x, y } = items[i]!
        this.ctx.drawImage(canvas, x, y, img.w, img.h, img.dst_x, img.dst_y, img.w, img.h)
      }
      start = end
    }
  }

  destroy () {
    this.ctx = this.bufferCtx = this.bufferCanvas = null!
  }
}
