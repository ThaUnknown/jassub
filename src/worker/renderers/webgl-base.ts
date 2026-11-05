import { CanvasRendererBase } from './canvas-base.ts'

import type { ASSImage } from '../util.ts'

export const MAX_ATLAS_SCREENS = 128
export const ATLAS_IDLE_MS = 20_000

interface Segment { x: number, y: number, w: number }
// the top edge of the used area of an atlas page, as segments from left to right
type Skyline = Segment[]

// the segment where a rectangle starts, and the y where it rests
interface Spot { index: number, y: number }

// find the lowest spot, then the leftmost, where a w x h rectangle fits, return false if it does not fit
// the result goes into spot, so a search does not allocate
function findSpot (segments: Skyline, w: number, h: number, limit: number, spot: Spot) {
  // a spot must be lower than bestY, so the first spot that fits wins a tie
  let bestY = limit - h + 1
  const count = segments.length
  for (let i = 0; i < count; i++) {
    const segment = segments[i]!
    const end = segment.x + w
    if (end > limit) break
    // the rectangle rests at least on this segment, so it cannot be lower than the best spot
    if (segment.y >= bestY) continue

    // the rectangle rests on the highest segment under it
    let y = segment.y
    for (let j = i + 1; j < count; j++) {
      const next = segments[j]!
      if (next.x >= end) break
      if (next.y > y) {
        y = next.y
        if (y >= bestY) break
      }
    }

    if (y < bestY) {
      bestY = y
      spot.index = i
      spot.y = y
    }
  }
  return bestY <= limit - h
}

// place a w x h rectangle at the spot, and return its x
function addSegment (segments: Skyline, { index, y }: Spot, w: number, h: number) {
  const x = segments[index]!.x
  const end = x + w
  const top = y + h

  // replace the segments under the rectangle, and shorten the one it covers in part
  let last = index
  while (last < segments.length && segments[last]!.x + segments[last]!.w <= end) last++
  if (last < segments.length && segments[last]!.x < end) {
    const partial = segments[last]!
    partial.w -= end - partial.x
    partial.x = end
  }
  segments.splice(index, last - index, { x, y: top, w })

  // merge the neighbours of the same height
  if (index + 1 < segments.length && segments[index + 1]!.y === top) {
    segments[index]!.w += segments[index + 1]!.w
    segments.splice(index + 1, 1)
  }
  if (index > 0 && segments[index - 1]!.y === top) {
    segments[index - 1]!.w += segments[index]!.w
    segments.splice(index, 1)
  }

  return x
}

// one number for a position in the atlas, so the upload cache does not build a string per image
// 14 bits for x and y fit a 16384 texture, and the result stays below 2^53 for 2^25 layers
export function atlasPosition (x: number, y: number, layer: number) {
  return (layer * 16384 + y) * 16384 + x
}

export interface AtlasItem {
  img: ASSImage
  packW?: number
  sourceKey: string | 0
  x: number
  y: number
  layer: number
}

export abstract class WebGLRendererBase<T extends WebGLRenderingContext | WebGL2RenderingContext> extends CanvasRendererBase {
  gl!: T
  program!: WebGLProgram

  // Uniform locations
  u_resolution: WebGLUniformLocation | null = null
  u_colorMatrix: WebGLUniformLocation | null = null
  u_colorOffset: WebGLUniformLocation | null = null

  ctrl = new AbortController()

  constructor (canvas: OffscreenCanvas) {
    super(canvas)

    canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault()
      this.gl = null!
    }, this.ctrl)
    canvas.addEventListener('webglcontextrestored', () => this._initGL(), this.ctrl)
  }

  abstract _initGL (): void
  abstract render (images: ASSImage[], heap: Uint8Array): void
  abstract destroy (): void

  // Skyline bottom-left packing, identical sources are placed once
  // anyPage lets an image go on any page, WebGL1 draws page by page, so it only fills the last page to keep the draw order
  packAtlas (items: AtlasItem[], size: number, padding = 0, anyPage = false) {
    const placed = new Map<string, AtlasItem>()
    const pages: Skyline[] = []
    const spot: Spot = { index: 0, y: 0 }
    // the padding goes after each image, so a page holds size + padding
    const limit = size + padding

    for (const item of items) {
      const { img, sourceKey } = item

      const cached = sourceKey && placed.get(sourceKey)
      if (cached) {
        item.x = cached.x
        item.y = cached.y
        item.layer = cached.layer
        continue
      }

      const w = (item.packW ?? img.w) + padding
      const h = img.h + padding

      let layer = anyPage ? 0 : Math.max(0, pages.length - 1)
      while (layer < pages.length && !findSpot(pages[layer]!, w, h, limit, spot)) layer++

      if (layer === pages.length) {
        // the callers size the page to the largest image, so it fits in the top left corner of a new page
        pages.push([{ x: 0, y: 0, w: limit }])
        if (!anyPage) placed.clear()
        spot.index = 0
        spot.y = 0
      }

      item.x = addSegment(pages[layer]!, spot, w, h)
      item.y = spot.y
      item.layer = layer
      if (sourceKey) placed.set(sourceKey, item)
    }

    return pages.length
  }

  createProgram (vertexSource: string, fragmentSource: string) {
    // Create shaders
    const vertexShader = this.createShader(this.gl.VERTEX_SHADER, vertexSource)
    const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fragmentSource)

    // Create program
    const program = this.gl.createProgram()
    if (!program) throw new Error('Failed to create program')

    this.gl.attachShader(program, vertexShader)
    this.gl.attachShader(program, fragmentShader)
    this.gl.linkProgram(program)

    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      const info = this.gl.getProgramInfoLog(program)
      this.gl.deleteProgram(program)
      throw new Error('Failed to link program: ' + info)
    }

    this.gl.deleteShader(vertexShader)
    this.gl.deleteShader(fragmentShader)
    this.program = program
  }

  createShader (type: number, source: string) {
    const shader = this.gl.createShader(type)

    if (!shader) throw new Error('Failed to create shader')

    this.gl.shaderSource(shader, source)
    this.gl.compileShader(shader)

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const info = this.gl.getShaderInfoLog(shader)
      this.gl.deleteShader(shader)
      throw new Error('Failed to compile shader: ' + info)
    }

    return shader
  }

  setColorConversion (matrix: Float32Array) {
    this.colorMatrix = matrix
    if (!this.gl) return
    this.gl.uniformMatrix3fv(this.u_colorMatrix, false, matrix.subarray(0, 9))
    this.gl.uniform3fv(this.u_colorOffset, matrix.subarray(9))
  }

  beginFrame (images: ASSImage[]) {
    const resize = this.applyScheduledResize()
    // Update viewport and resolution uniform
    if (resize) {
      this.gl.viewport(0, 0, resize.width, resize.height)
      this.gl.uniform2f(this.u_resolution, resize.width, resize.height)
    }

    // Clear canvas
    this.gl.clear(this.gl.COLOR_BUFFER_BIT)

    if (images.length === 0) {
      this.gl.flush()
      return false
    }

    return true
  }

  applyCommonState (textureUniform: WebGLUniformLocation | null) {
    // Set up blending for premultiplied alpha
    this.gl.enable(this.gl.BLEND)
    this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA)

    // Use the program
    this.gl.useProgram(this.program)

    // Set texture unit
    this.gl.uniform1i(textureUniform, 0)

    this.setColorConversion(this.colorMatrix)

    // Set one-time GL state
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1)
    this.gl.clearColor(0, 0, 0, 0)
    this.gl.activeTexture(this.gl.TEXTURE0)

    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    this.gl.uniform2f(this.u_resolution, this.canvas.width, this.canvas.height)
  }
}
