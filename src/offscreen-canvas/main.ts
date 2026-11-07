import { transferHandlers, type Endpoint, type TransferHandler } from 'abslink'

import { BLIT_STRIDE, CANVAS_TRANSFER_HANDLER, CLEAR_BLIT, isRemoteCanvasBlitFrame, type RemoteCanvasBlitFrame, type RemoteCanvasInit } from './protocol.ts'

let nextId = 1

function toImageData (ctx: CanvasRenderingContext2D, bytes: Uint8ClampedArray<ArrayBuffer>, width: number, height: number) {
  if (typeof ImageData === 'function') {
    try {
      return new ImageData(bytes, width, height)
    } catch {
      // Safari 9 and IE have ImageData without the constructor.
    }
  }
  const image = ctx.createImageData(width, height)
  image.data.set(bytes)
  return image
}

export class RemoteCanvasHandle {
  readonly id = nextId++
  readonly canvas: HTMLCanvasElement
  readonly width: number
  readonly height: number
  _scratch: HTMLCanvasElement[] = []

  constructor (canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.width = canvas.width
    this.height = canvas.height
  }

  // Replay the calls of the worker on the real canvas.
  paint (frame: RemoteCanvasBlitFrame) {
    const canvas = this.canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (canvas.width !== frame.width || canvas.height !== frame.height) {
      // A size change clears the canvas.
      canvas.width = frame.width
      canvas.height = frame.height
      ctx.imageSmoothingEnabled = false
    } else if (frame.clearAll) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }

    const sources = frame.pages.map((page, index) => {
      // The bitmap transport already has the page cropped to its used rows.
      if (page.bitmap) return page.bitmap
      const scratch = this._scratch[index] ??= document.createElement('canvas')
      if (scratch.width < page.width || scratch.height < page.height) {
        scratch.width = Math.max(scratch.width, page.width)
        scratch.height = Math.max(scratch.height, page.height)
      }
      const scratchCtx = scratch.getContext('2d')!
      scratchCtx.putImageData(toImageData(scratchCtx, new Uint8ClampedArray(page.pixels!), page.width, page.height), 0, 0)
      return scratch
    })

    const blits = frame.blits
    for (let i = 0; i < blits.length; i += BLIT_STRIDE) {
      const page = blits[i]!
      if (page === CLEAR_BLIT) ctx.clearRect(blits[i + 5]!, blits[i + 6]!, blits[i + 7]!, blits[i + 8]!)
      else ctx.drawImage(sources[page]!, blits[i + 1]!, blits[i + 2]!, blits[i + 3]!, blits[i + 4]!, blits[i + 5]!, blits[i + 6]!, blits[i + 7]!, blits[i + 8]!)
    }

    for (const page of frame.pages) page.bitmap?.close()
  }
}

const handler: TransferHandler<RemoteCanvasHandle, RemoteCanvasInit> = {
  canHandle: (value): value is RemoteCanvasHandle => value instanceof RemoteCanvasHandle,
  serialize (handle, ep: Endpoint) {
    ep.on('message', (data: unknown) => {
      if (isRemoteCanvasBlitFrame(data) && data.remoteCanvasBlits === handle.id) handle.paint(data)
    })
    return [{ id: handle.id, width: handle.width, height: handle.height }, []]
  },
  deserialize () {
    throw new Error('jassub-legacy: a remote canvas can only be received in a worker')
  }
}

export function installRemoteCanvas () {
  const proto = HTMLCanvasElement.prototype as unknown as { transferControlToOffscreen?: () => unknown }
  if (typeof proto.transferControlToOffscreen === 'function') return

  transferHandlers.set(CANVAS_TRANSFER_HANDLER, handler)
  proto.transferControlToOffscreen = function (this: HTMLCanvasElement) {
    return new RemoteCanvasHandle(this)
  }
}
