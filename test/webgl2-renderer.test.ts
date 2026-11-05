import { expect, test, vi } from 'vitest'

import { WebGL2Renderer } from '../src/worker/renderers/webgl2-renderer.ts'

const TILE = 64

// Each image has its own pixels (cache_id 0), so no image shares an atlas slot.
function images (count: number) {
  return Array.from({ length: count }, (_, i) => ({
    w: TILE,
    h: TILE,
    dst_x: (i % 2) * TILE,
    dst_y: Math.floor(i / 2) * TILE,
    stride: TILE,
    color: 0xFFFFFF00,
    bitmap: 0,
    cache_id: 0
  }))
}

const heap = new Uint8Array(TILE * TILE).fill(255)

function countOpaque (canvas: OffscreenCanvas) {
  const surface = new OffscreenCanvas(canvas.width, canvas.height)
  const ctx = surface.getContext('2d')!
  ctx.drawImage(canvas, 0, 0)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data

  let count = 0
  for (let i = 3; i < data.length; i += 4) if (data[i]) count++
  return count
}

test('WebGL2 drops a frame that needs more atlas memory than the limit', () => {
  // The limit is 128 screens of 8 x 8 pixels, which is 8192 bytes. That is 2 layers of TILE x TILE.
  const renderer = new WebGL2Renderer(new OffscreenCanvas(8, 8))
  // The layers are TILE wide, so the padding puts one image on one layer.
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  try {
    renderer.render(images(2), heap)
    expect(renderer.atlas?.depth).toBe(2)

    renderer.render(images(4), heap)
    expect(warn).toHaveBeenCalledWith('JASSUB: frame exceeds texture array capacity')
    expect(renderer.atlas?.depth, 'the atlas does not grow past the limit').toBe(2)
  } finally {
    warn.mockRestore()
    renderer.destroy()
  }
})

test('WebGL2 rounds the atlas layer size to 64, not to a power of 2', () => {
  const renderer = new WebGL2Renderer(new OffscreenCanvas(256, 64))
  const wide = { w: 130, h: 10, dst_x: 0, dst_y: 0, stride: 130, color: 0xFFFFFF00, bitmap: 0, cache_id: 0 }

  try {
    renderer.render([wide], new Uint8Array(130 * 10).fill(255))
    expect(renderer.atlas?.size, 'a power of 2 would be 256').toBe(192)
    expect(countOpaque(renderer.canvas)).toBe(130 * 10)
  } finally {
    renderer.destroy()
  }
})

test('WebGL2 frees atlas layers that no frame used for a while', () => {
  const renderer = new WebGL2Renderer(new OffscreenCanvas(TILE * 2, TILE * 2))
  let now = 1000
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)

  try {
    renderer.render(images(4), heap)
    expect(renderer.atlas?.depth).toBe(4)

    now += 1000
    renderer.render(images(1), heap)
    expect(renderer.atlas?.depth, 'recently used layers stay').toBe(4)

    now += 30_000
    renderer.render(images(1), heap)
    expect(renderer.atlas?.depth, 'idle layers are freed').toBe(1)
    expect(countOpaque(renderer.canvas), 'the frame draws after the atlas shrinks').toBe(TILE * TILE)
  } finally {
    clock.mockRestore()
    renderer.destroy()
  }
})

test('WebGL2 waits for the last frame with finish() before the expensive work of a frame', () => {
  const finish = vi.spyOn(WebGL2RenderingContext.prototype, 'finish')
  const allocate = vi.spyOn(WebGL2RenderingContext.prototype, 'texImage3D')
  const renderer = new WebGL2Renderer(new OffscreenCanvas(TILE * 2, TILE * 2))

  try {
    renderer.render([], heap)
    expect(finish, 'a frame without images has nothing to wait for').not.toHaveBeenCalled()

    renderer.render(images(1), heap)
    expect(finish).toHaveBeenCalledTimes(1)
    // After the allocation and uploads, the wait would not stop the new work from queuing behind the last frame.
    expect(finish.mock.invocationCallOrder[0]).toBeLessThan(allocate.mock.invocationCallOrder[0]!)
  } finally {
    finish.mockRestore()
    allocate.mockRestore()
    renderer.destroy()
  }
})
