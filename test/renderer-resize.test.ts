import { expect, test } from 'vitest'

import { Canvas2DRenderer } from '../src/worker/renderers/2d-renderer.ts'
import { WebGL1Renderer } from '../src/worker/renderers/webgl1-renderer.ts'
import { WebGL2Renderer } from '../src/worker/renderers/webgl2-renderer.ts'

// Issue #71: a same-size resize must not be scheduled, and render() must clear
// the buffer on every draw (including the resize branch). Otherwise translucent
// blur/border edges accumulate alpha across repaints.

const RENDERERS = { WebGL2Renderer, WebGL1Renderer, Canvas2DRenderer }

test('resizeCanvas ignores a same-size resize and schedules a real one', () => {
  for (const [name, Renderer] of Object.entries(RENDERERS)) {
    const canvas = new OffscreenCanvas(300, 150)
    const renderer: any = new Renderer()
    renderer.setCanvas(canvas)

    renderer.resizeCanvas(300, 150)
    expect(renderer._scheduledResize, `${name} same size`).toBeUndefined()

    renderer.resizeCanvas(301, 150)
    expect(renderer._scheduledResize, `${name} new size`).toEqual({ width: 301, height: 150 })
  }
})

test('render clears the buffer on every draw, including after a resize', () => {
  // The WebGL renderers read these worker globals while rendering.
  const glob = self as any
  const prevHeap = glob.HEAPU8RAW
  const prevMemory = glob.WASMMEMORY

  try {
    glob.HEAPU8RAW = new Uint8Array(0)
    glob.WASMMEMORY = { buffer: new ArrayBuffer(0) }

    for (const [name, Renderer] of Object.entries(RENDERERS)) {
      const canvas = new OffscreenCanvas(300, 150)
      const renderer: any = new Renderer()
      renderer.setCanvas(canvas)

      let clears = 0
      if (Renderer === Canvas2DRenderer) {
        const ctx = renderer.ctx
        const original = ctx.clearRect.bind(ctx)
        ctx.clearRect = (...args: number[]) => { clears++; original(...args) }
      } else {
        const gl = renderer.gl
        const original = gl.clear.bind(gl)
        gl.clear = (mask: number) => { clears++; original(mask) }
      }

      // The resize branch must clear too, not only the else branch.
      renderer.resizeCanvas(301, 151)
      renderer.render([], new Uint8Array(0))
      expect(clears, `${name} clears after a scheduled resize`).toBe(1)

      // A plain repaint still clears.
      renderer.render([], new Uint8Array(0))
      expect(clears, `${name} clears on a plain repaint`).toBe(2)
    }
  } finally {
    if (prevHeap === undefined) delete glob.HEAPU8RAW
    else glob.HEAPU8RAW = prevHeap
    if (prevMemory === undefined) delete glob.WASMMEMORY
    else glob.WASMMEMORY = prevMemory
  }
})
