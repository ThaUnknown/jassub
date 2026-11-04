import { expect, test, vi } from 'vitest'

import { WebGL1Renderer } from '../src/worker/renderers/webgl1-renderer.ts'
import { WebGL2Renderer } from '../src/worker/renderers/webgl2-renderer.ts'

const IMAGE_SIZE = 4
const CANVAS_SIZE = 32

function makeImage () {
  const heap = new Uint8Array(IMAGE_SIZE * IMAGE_SIZE).fill(255)
  return {
    heap,
    img: {
      w: IMAGE_SIZE,
      h: IMAGE_SIZE,
      dst_x: 4,
      dst_y: 4,
      stride: IMAGE_SIZE,
      color: 0xFFFFFF00,
      bitmap: 0,
      cache_id: 1
    }
  }
}

function countOpaque (canvas: OffscreenCanvas) {
  const surface = new OffscreenCanvas(canvas.width, canvas.height)
  const ctx = surface.getContext('2d')!
  ctx.drawImage(canvas, 0, 0)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data

  let count = 0
  for (let i = 3; i < data.length; i += 4) if (data[i]) count++
  return count
}

function draw (renderer: WebGL1Renderer) {
  const canvas = renderer.canvas
  renderer.resizeCanvas(CANVAS_SIZE, CANVAS_SIZE)
  const { img, heap } = makeImage()
  renderer.render([img], heap)
  return countOpaque(canvas)
}

test('WebGL1 uses mediump when the fragment stage has no highp', () => {
  const proto = WebGLRenderingContext.prototype as any
  const shaderSource = proto.shaderSource
  const getShaderPrecisionFormat = proto.getShaderPrecisionFormat
  let renderer: WebGL1Renderer | undefined

  proto.shaderSource = function (shader: WebGLShader, source: string) {
    // Force the mediump branch of the fragment shader.
    shaderSource.call(this, shader, source.replace('#ifdef GL_FRAGMENT_PRECISION_HIGH', '#if 0'))
  }
  proto.getShaderPrecisionFormat = function (shaderType: number, precisionType: number) {
    if (precisionType === this.HIGH_FLOAT) return { precision: 0, rangeMin: 0, rangeMax: 0 }
    if (precisionType === this.MEDIUM_FLOAT) return { precision: 10, rangeMin: 15, rangeMax: 15 }
    return getShaderPrecisionFormat.call(this, shaderType, precisionType)
  }

  try {
    renderer = new WebGL1Renderer(new OffscreenCanvas(CANVAS_SIZE, CANVAS_SIZE))
    expect(renderer.maxAtlasSize).toBe(512)
    expect(draw(renderer)).toBe(IMAGE_SIZE * IMAGE_SIZE)
  } finally {
    proto.shaderSource = shaderSource
    proto.getShaderPrecisionFormat = getShaderPrecisionFormat
    renderer?.destroy()
  }
})

test('WebGL1 renders a bitmap whose last row ends at the end of the heap', () => {
  // libass guarantees only stride * (h - 1) + w bytes for a bitmap.
  const stride = IMAGE_SIZE * 2
  const heap = new Uint8Array(stride * (IMAGE_SIZE - 1) + IMAGE_SIZE).fill(255)
  const img = { ...makeImage().img, stride }
  const renderer = new WebGL1Renderer(new OffscreenCanvas(CANVAS_SIZE, CANVAS_SIZE))

  try {
    renderer.render([img], heap)
    expect(countOpaque(renderer.canvas)).toBe(IMAGE_SIZE * IMAGE_SIZE)
  } finally {
    renderer.destroy()
  }
})

test('WebGL1 frees atlas pages that no frame used for a while', () => {
  const tile = 64
  const heap = new Uint8Array(tile * tile).fill(255)
  const images = (count: number) => Array.from({ length: count }, (_, i) => ({ ...makeImage().img, w: tile, h: tile, stride: tile, dst_x: (i % 2) * tile, dst_y: Math.floor(i / 2) * tile, cache_id: 0 }))
  const renderer = new WebGL1Renderer(new OffscreenCanvas(tile * 2, tile * 2))
  // One image fills one page.
  renderer.maxAtlasSize = tile
  let now = 1000
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)

  try {
    renderer.render(images(4), heap)
    expect(renderer.atlasPages).toHaveLength(4)

    now += 1000
    renderer.render(images(1), heap)
    expect(renderer.atlasPages, 'recently used pages stay').toHaveLength(4)

    now += 30_000
    renderer.render(images(1), heap)
    expect(renderer.atlasPages, 'idle pages are freed').toHaveLength(1)
    expect(countOpaque(renderer.canvas)).toBe(tile * tile)
  } finally {
    clock.mockRestore()
    renderer.destroy()
  }
})

test('a WebGL2 renderer that failed to start ignores the context events of the canvas', () => {
  const canvas = new OffscreenCanvas(CANVAS_SIZE, CANVAS_SIZE)
  const proto = OffscreenCanvas.prototype as any
  const getContext = proto.getContext
  const initGL = vi.spyOn(WebGL2Renderer.prototype, '_initGL')
  let renderer: WebGL1Renderer | undefined

  // The worker tries WebGL2 first, then falls back to WebGL1 on the same canvas.
  proto.getContext = function (type: string, ...args: unknown[]) {
    return type === 'webgl2' ? null : getContext.call(this, type, ...args)
  }
  try {
    expect(WebGL2Renderer.isSupported(canvas)).toBeUndefined()
    proto.getContext = getContext
    renderer = new WebGL1Renderer(canvas)
    initGL.mockClear()

    // Headless Chrome does not restore a lost context here, so send the event directly.
    canvas.dispatchEvent(new Event('webglcontextrestored'))

    expect(initGL, 'the failed WebGL2 renderer does not try to start again').not.toHaveBeenCalled()
    expect(draw(renderer), 'the WebGL1 renderer still draws').toBe(IMAGE_SIZE * IMAGE_SIZE)
  } finally {
    proto.getContext = getContext
    initGL.mockRestore()
    renderer?.destroy()
  }
})

test('WebGL1 renders without ANGLE_instanced_arrays', () => {
  const proto = WebGLRenderingContext.prototype as any
  const getExtension = proto.getExtension
  let renderer: WebGL1Renderer | undefined

  proto.getExtension = function (name: string) {
    if (name === 'ANGLE_instanced_arrays') return null
    return getExtension.call(this, name)
  }

  try {
    renderer = new WebGL1Renderer(new OffscreenCanvas(CANVAS_SIZE, CANVAS_SIZE))
    expect(renderer.instancedArraysExt).toBeNull()
    expect(draw(renderer)).toBe(IMAGE_SIZE * IMAGE_SIZE)
  } finally {
    proto.getExtension = getExtension
    renderer?.destroy()
  }
})
