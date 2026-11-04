// fallback for browsers that don't support GPU acceleration
import { CanvasRendererBase } from './canvas-base.ts'

import type { ASSImage } from '../util.ts'

// clamp to 0-255 with rounding, matching rgba8unorm GPU behaviour
const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 255 : Math.round(v * 255))

const CTX_OPTS = {
  alpha: true,
  desynchronized: true,
  willReadFrequently: false
}

export class Canvas2DRenderer extends CanvasRendererBase {
  ctx
  bufferCtx
  bufferCanvas = new OffscreenCanvas(1, 1)

  constructor (canvas: OffscreenCanvas) {
    super(canvas)
    const ctx = canvas.getContext('2d', CTX_OPTS)
    const bufferCtx = this.bufferCanvas.getContext('2d', CTX_OPTS)

    if (!ctx || !bufferCtx) throw new Error('Could not get 2D context')
    this.ctx = ctx
    this.bufferCtx = bufferCtx
  }

  // this should be an svg filter which is cheaper, but not supported
  // https://issues.chromium.org/u/1/issues/40910142
  setColorConversion (matrix: Float32Array) {
    this.colorMatrix = matrix
  }

  // this is horribly inefficient, but it's a fallback for systems without a GPU, this is the least of their problems
  render (images: ASSImage[], heap: Uint8Array): void {
    this.applyScheduledResize()

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)

    for (const img of images) {
      const imageData = new ImageData(img.w, img.h)
      const pixels = new Uint32Array(imageData.data.buffer)

      // libass 0xRRGGBBAA → ImageData little-endian RGBA, convert the color per image
      const m = this.colorMatrix
      const r = ((img.color >>> 24) & 0xff) / 255
      const g = ((img.color >>> 16) & 0xff) / 255
      const bl = ((img.color >>> 8) & 0xff) / 255
      const cr = clamp(m[0]! * r + m[3]! * g + m[6]! * bl + m[9]!)
      const cg = clamp(m[1]! * r + m[4]! * g + m[7]! * bl + m[10]!)
      const cb = clamp(m[2]! * r + m[5]! * g + m[8]! * bl + m[11]!)
      const color = (cb << 16) | (cg << 8) | cr
      const alpha = (255 - (img.color & 255)) / 255

      const stride = img.stride
      const h = img.h
      const w = img.w

      for (let y = h + 1, pos = img.bitmap, res = 0; --y; pos += stride) {
        for (let z = 0; z < w; ++z, ++res) {
          const k = heap[pos + z]!
          if (k !== 0) pixels[res] = (Math.round(alpha * k) << 24) | color
        }
      }

      this.bufferCanvas.width = w
      this.bufferCanvas.height = h
      this.bufferCtx.putImageData(imageData, 0, 0)
      this.ctx.drawImage(this.bufferCanvas, img.dst_x, img.dst_y)
    }
  }

  destroy () {
    this.ctx = this.bufferCtx = this.bufferCanvas = null!
  }
}
