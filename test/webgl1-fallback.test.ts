import { expect, test } from 'vitest'

import { WebGL1Renderer } from '../src/worker/renderers/webgl1-renderer.ts'

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
