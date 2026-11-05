import { IDENTITY_MATRIX } from '../color-conversions'

export class CanvasRendererBase {
  canvas
  _scheduledResize?: { width: number, height: number }
  colorMatrix: Float32Array = IDENTITY_MATRIX

  constructor (canvas: OffscreenCanvas) {
    this.canvas = canvas
  }

  static isSupported<T extends CanvasRendererBase> (this: new (canvas: OffscreenCanvas) => T, canvas: OffscreenCanvas) {
    try {
      return new this(canvas)
    } catch (e) {}
  }

  resizeCanvas (width: number, height: number) {
    // WebGL doesn't allow 0-sized canvases. A matching size cancels any pending
    // resize, otherwise a later draw would apply an older size to a newer frame.
    this._scheduledResize = !width || !height ||
      (this.canvas.width === width && this.canvas.height === height)
      ? undefined
      : { width, height }
  }

  applyScheduledResize () {
    // Apply a scheduled resize right before rendering, so the resize and the
    // first draw happen in one call and the resized buffer is never presented
    // on its own.
    if (!this._scheduledResize) return

    const resize = this._scheduledResize
    this._scheduledResize = undefined
    this.canvas.width = resize.width
    this.canvas.height = resize.height
    return resize
  }

  finish () {}

  destroy () {}
}
