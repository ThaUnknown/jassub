import type { ASSImage } from '../jassub'

const IDENTITY_MATRIX = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0
])

// Color matrix conversion map - mat3x3 pre-padded (each column padded to vec4f)
// Each matrix converts FROM the key color space TO the nested key color space
export const colorMatrixConversionMap = {
  BT601: {
    BT709: new Float32Array([
      1.0863, 0.0965, -0.0141, 0,
      -0.0723, 0.8451, -0.0277, 0,
      -0.014, 0.0584, 1.0418, 0
    ]),
    BT601: IDENTITY_MATRIX
  },
  BT709: {
    BT601: new Float32Array([
      0.9137, -0.1049, 0.0096, 0,
      0.0784, 1.1722, 0.0322, 0,
      0.0079, -0.0671, 0.9582, 0
    ]),
    BT709: IDENTITY_MATRIX
  },
  FCC: {
    BT709: new Float32Array([
      1.0873, 0.0974, -0.0127, 0,
      -0.0736, 0.8494, -0.0251, 0,
      -0.0137, 0.0531, 1.0378, 0
    ]),
    BT601: new Float32Array([
      1.001, 0.0009, 0.0013, 0,
      -0.0008, 1.005, 0.0027, 0,
      -0.0002, -0.006, 0.996, 0
    ])
  },
  SMPTE240M: {
    BT709: new Float32Array([
      0.9993, -0.0004, -0.0034, 0,
      0.0006, 0.9812, -0.0114, 0,
      0.0001, 0.0192, 1.0148, 0
    ]),
    BT601: new Float32Array([
      0.913, -0.1051, 0.0063, 0,
      0.0774, 1.1508, 0.0207, 0,
      0.0096, -0.0456, 0.973, 0
    ])
  }
} as const

export { IDENTITY_MATRIX }

export type ColorSpace = keyof typeof colorMatrixConversionMap

/**
 * Common interface for subtitle renderers.
 * Implementations must handle async initialization via the ready() method.
 */
export interface Renderer {
  /**
   * Returns a promise that resolves when the renderer is fully initialized.
   */
  ready(): Promise<void>

  /**
   * Configure the canvas for rendering.
   * @param canvas - OffscreenCanvas to render to
   * @param width - Canvas width in pixels
   * @param height - Canvas height in pixels
   */
  setCanvas(canvas: OffscreenCanvas, width: number, height: number): Promise<void>

  /**
   * Set the color matrix for color space conversion.
   * Pass undefined to use identity (no conversion).
   * @param matrix - Pre-padded Float32Array with 12 values (3 columns × 4 floats each)
   */
  setColorMatrix(matrix?: Float32Array<ArrayBuffer>): Promise<void>

  /**
   * Render subtitle images to the canvas.
   * @param images - Array of subtitle images from libass
   * @param heap - WASM heap containing bitmap data
   */
  render(images: ASSImage[], heap: Uint8Array): void

  /**
   * Clean up resources.
   */
  destroy(): void
}

/**
 * Detect which renderer to use based on available APIs.
 * Returns 'webgpu' if WebGPU is available, otherwise 'webgl2'.
 */
export async function detectRenderer (): Promise<'webgpu' | 'webgl2'> {
  // DEBUG: Force WebGL2 to test Firefox compatibility
  console.log('JASSUB: DEBUG - Forcing WebGL2 renderer for testing')
  return 'webgl2'

  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (adapter) return 'webgpu'
    } catch {
      // WebGPU not available
    }
  }
  return 'webgl2'
}
