
export const CANVAS_TRANSFER_HANDLER = 'jassub-legacy:remote-canvas'

export interface RemoteCanvasInit {
  id: number
  width: number
  height: number
}

export interface RemoteCanvasPage {
  width: number
  height: number
  pixels: ArrayBuffer | null
  bitmap: ImageBitmap | null
}

export interface RemoteCanvasBlitFrame {
  remoteCanvasBlits: number
  width: number
  height: number
  clearAll: boolean
  pages: RemoteCanvasPage[]
  blits: Int32Array
}

export const BLIT_STRIDE = 9
export const CLEAR_BLIT = -1

export function isRemoteCanvasBlitFrame (value: unknown): value is RemoteCanvasBlitFrame {
  return !!value && typeof (value as RemoteCanvasBlitFrame).remoteCanvasBlits === 'number'
}
