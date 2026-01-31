// fallback for browsers that don't support GPU acceleration
import type { ASSImage } from '../util.ts'

export class Canvas2DRenderer {
  canvas: OffscreenCanvas | null = null
  ctx: OffscreenCanvasRenderingContext2D | null = null
  bufferCanvas = new OffscreenCanvas(1, 1)
  bufferCtx = this.bufferCanvas.getContext('2d', {
    alpha: true,
    desynchronized: true,
    willReadFrequently: false
  })

  _scheduledResize?: { width: number, height: number }

  resizeCanvas (width: number, height: number) {
    if (width <= 0 || height <= 0) return

    this._scheduledResize = { width, height }
  }

  setCanvas (canvas: OffscreenCanvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d', {
      alpha: true,
      desynchronized: true,
      willReadFrequently: false
    })

    if (!this.ctx) throw new Error('Could not get 2D context')
  }

  setColorMatrix (subtitleColorSpace?: 'BT601' | 'BT709' | 'SMPTE240M' | 'FCC', videoColorSpace?: 'BT601' | 'BT709') {}

  // this is horribly inefficient, but it's a fallback for systems without a GPU, this is the least of their problems
  render (images: ASSImage[], heap: Uint8Array): void {
    if (!this.ctx || !this.canvas) return

    if (this._scheduledResize) {
      const { width, height } = this._scheduledResize
      this._scheduledResize = undefined
      this.canvas.width = width
      this.canvas.height = height
    } else {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    }

    for (const img of images) {
      if (img.w <= 0 || img.h <= 0) continue
      const imageData = new ImageData(img.w, img.h)
      const pixels = new Uint32Array(imageData.data.buffer)

      const color = ((img.color << 8) & 0xff0000) | ((img.color >> 8) & 0xff00) | ((img.color >> 24) & 0xff)
      const alpha = (255 - (img.color & 255)) / 255

      const stride = img.stride
      const h = img.h
      const w = img.w

      for (let y = h + 1, pos = img.bitmap, res = 0; --y; pos += stride) {
        for (let z = 0; z < w; ++z, ++res) {
          const k = heap[pos + z]!
          if (k !== 0) pixels[res] = ((alpha * k) << 24) | color
        }
      }

      // Draw the ImageData to canvas at the destination position
      this.bufferCanvas.width = w
      this.bufferCanvas.height = h
      this.bufferCtx!.putImageData(imageData, 0, 0)
      this.ctx.drawImage(this.bufferCanvas, img.dst_x, img.dst_y)
    }
  }

  destroy () {
    this.ctx = null
    this.canvas = null
    this.bufferCtx = null!
    this.bufferCanvas = null!
  }
}
