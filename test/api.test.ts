import { describe, expect, test, vi } from 'vitest'

import JASSUB from '../src/jassub.ts'

import { LATO } from './support/fonts.ts'
import { diff, EMPTY_ASS } from './support/harness.ts'

import COLLISIONS from './fixtures/subtitles/perf/collisions-1000.ass?raw'

const WIDTH = 640
const HEIGHT = 360
const FRAME = { mediaTime: 1, width: WIDTH, height: HEIGHT, expectedDisplayTime: 0 }

const STYLE_FORMAT = 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding'
const EVENT_FORMAT = 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'

function track ({ scriptInfo = '', styles = ['Default,Lato,48,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,20,1'], events = [] as string[] } = {}) {
  return `[Script Info]
ScriptType: v4.00+
${scriptInfo}

[V4+ Styles]
${STYLE_FORMAT}
${styles.map(style => `Style: ${style}`).join('\n')}

[Events]
${EVENT_FORMAT}
${events.map(text => `Dialogue: 0,0:00:00.00,0:00:05.00,${text}`).join('\n')}
`
}

const RED = 'Red,Lato,48,&H000000FF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,20,1'
const DEFAULT = 'Default,Lato,48,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,20,1'

async function create (subContent: string) {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  document.body.appendChild(canvas)
  const jassub = new JASSUB({ canvas, subContent, fonts: [LATO], defaultFont: 'Lato', queryFonts: false })
  // The observer resizes and draws at a random time. The tests draw each frame themselves.
  jassub._ro.disconnect()
  await jassub.ready
  const renderer: any = jassub.renderer
  return {
    jassub,
    renderer,
    capture: async () => {
      await jassub.manualRender(FRAME)
      return await renderer._drawCapture(FRAME.mediaTime)
    }
  }
}

function opaquePixels (frame: { data: Uint8ClampedArray }) {
  let count = 0
  for (let i = 3; i < frame.data.length; i += 4) if (frame.data[i]) count++
  return count
}

describe('client', () => {
  test('a failed draw does not stop later frames', async () => {
    const { jassub, renderer } = await create(EMPTY_ASS)
    try {
      let draws = 0
      jassub.renderer = new Proxy(renderer, {
        get (target, key) {
          if (key !== '_draw') return Reflect.get(target, key)
          return async (...args: unknown[]) => {
            if (++draws === 1) throw new Error('draw failed')
            return await target._draw(...args)
          }
        }
      })

      await expect(jassub.manualRender(FRAME)).rejects.toThrow('draw failed')
      await jassub.manualRender(FRAME)
      expect(draws, 'the frame after the failure is drawn').toBe(2)
    } finally {
      jassub.renderer = renderer
      await jassub.destroy()
    }
  })

  test('libassMemoryLimit defaults to a smaller cache on low-memory devices', async () => {
    const findKey = (value: unknown, key: string, depth = 0): unknown => {
      if (!value || typeof value !== 'object' || depth > 6) return undefined
      if (key in value) return (value as Record<string, unknown>)[key]
      for (const child of Object.values(value)) {
        const found = findKey(child, key, depth + 1)
        if (found !== undefined) return found
      }
    }

    const sent: unknown[] = []
    const postMessage = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (this: Worker, ...args: Parameters<Worker['postMessage']>) {
      sent.push(args[0])
      return postMessage.apply(this, args as [unknown, Transferable[]])
    }
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'deviceMemory')

    const sentLimit = async (deviceMemory: number | undefined, libassMemoryLimit?: number) => {
      Object.defineProperty(navigator, 'deviceMemory', { value: deviceMemory, configurable: true })
      sent.length = 0
      const jassub = new JASSUB({ canvas: document.createElement('canvas'), subContent: EMPTY_ASS, fonts: [LATO], queryFonts: false, libassMemoryLimit })
      jassub._ro.disconnect()
      await jassub.ready
      await jassub.destroy()
      return findKey(sent, 'libassMemoryLimit')
    }

    try {
      expect(await sentLimit(8), 'high memory').toBe(64)
      expect(await sentLimit(2), 'low memory').toBe(32)
      expect(await sentLimit(undefined), 'no deviceMemory API').toBe(64)
      expect(await sentLimit(2, 128), 'explicit limit wins').toBe(128)
      expect(await sentLimit(8, 0), 'explicit 0 keeps the libass default').toBe(0)
    } finally {
      Worker.prototype.postMessage = postMessage
      if (descriptor) Object.defineProperty(navigator, 'deviceMemory', descriptor)
      else delete (navigator as { deviceMemory?: number }).deviceMemory
    }
  })

  test('the render size is limited to 4K by default', async () => {
    const make = (maxRenderHeight?: number) => new JASSUB({ canvas: document.createElement('canvas'), subContent: EMPTY_ASS, fonts: [LATO], queryFonts: false, maxRenderHeight })
    const limited = make()
    const unlimited = make(0)
    const descriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
    try {
      expect(limited._computeRenderSize(7680, 4320), '8K is limited').toEqual({ width: 3840, height: 2160 })
      expect(limited._computeRenderSize(3840, 2160), '4K is unchanged').toEqual({ width: 3840, height: 2160 })
      expect(limited._computeRenderSize(1920, 1080), '1080p is unchanged').toEqual({ width: 1920, height: 1080 })
      expect(unlimited._computeRenderSize(7680, 4320), 'explicit 0 has no limit').toEqual({ width: 7680, height: 4320 })
    } finally {
      if (descriptor) Object.defineProperty(window, 'devicePixelRatio', descriptor)
      else delete (window as { devicePixelRatio?: number }).devicePixelRatio
      await limited.destroy()
      await unlimited.destroy()
    }
  })

  test('setVideo stops the frame loop of the old video', async () => {
    const { jassub } = await create(EMPTY_ASS)
    // Do not render. This test checks only the frame loop.
    const manualRender = vi.spyOn(jassub, 'manualRender').mockResolvedValue(undefined)

    const fakeVideo = () => {
      const video = document.createElement('video')
      const callbacks: VideoFrameRequestCallback[] = []
      video.requestVideoFrameCallback = callback => callbacks.push(callback)
      const flush = () => {
        for (const callback of callbacks.splice(0)) callback(performance.now(), FRAME as VideoFrameCallbackMetadata)
      }
      return { video, callbacks, flush }
    }

    try {
      const first = fakeVideo()
      const second = fakeVideo()
      await jassub.setVideo(first.video)
      await jassub.setVideo(second.video)

      first.flush()
      second.flush()

      expect(first.callbacks.length, 'loops on the old video').toBe(0)
      expect(second.callbacks.length, 'loops on the new video').toBe(1)
      expect(manualRender, 'renders per frame').toHaveBeenCalledTimes(1)
    } finally {
      manualRender.mockRestore()
      await jassub.destroy()
    }
  })
})

describe('worker', () => {
  test('a subtitle URL with an HTTP error rejects ready', async () => {
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    const jassub = new JASSUB({ canvas, subUrl: '/missing-subtitle.ass', fonts: [LATO], queryFonts: false })
    try {
      await expect(jassub.ready).rejects.toThrow(/HTTP 404/)
    } finally {
      // destroy() awaits ready again, which rejects with the same error.
      await jassub.destroy().catch(() => {})
    }
  })

  test('a restored WebGL context draws the last frame again', async () => {
    const { jassub, renderer } = await create(track({ events: ['Default,,0,0,0,,paused'] }))
    try {
      await jassub.manualRender(FRAME)
      // Run code in the worker scope. _malloc is a plain function, so its constructor is Function.
      const inWorker = async (code: string) => await (await new renderer._malloc.constructor(code))()
      const isLost = async () => {
        try {
          return !!(await renderer._gpurender.gl.isContextLost())
        } catch {
          // The renderer sets gl to null while the context is lost.
          return true
        }
      }

      // Chrome loses the oldest WebGL context of a thread when the thread has too many.
      await inWorker("self.extraContexts = Array.from({ length: 20 }, () => new OffscreenCanvas(1, 1).getContext('webgl2'))")
      expect(await isLost(), 'the JASSUB context is lost').toBe(true)

      // Chrome restores the context when the other contexts are gone.
      await inWorker("for (const gl of self.extraContexts) gl.getExtension('WEBGL_lose_context')?.loseContext(); self.extraContexts = []; self.gc?.()")
      await vi.waitFor(async () => expect(await isLost()).toBe(false), { timeout: 60_000, interval: 100 })

      // The restored context starts with an empty upload cache. The redraw fills it again.
      // A paused video sends no new frame, so without the redraw the canvas stays blank.
      expect(await renderer._gpurender.uploadCache.size, 'the last frame is drawn again').toBeGreaterThan(0)
    } finally {
      await jassub.destroy()
    }
  })

  test('setTrack applies the color space of the new track', async () => {
    const text = 'Default,,0,0,0,,{\\1c&H0000FF&}red {\\1c&H00FF00&}green {\\1c&HFF0000&}blue'
    const plain = track({ scriptInfo: 'YCbCr Matrix: None', events: [text] })
    const converted = track({ scriptInfo: 'YCbCr Matrix: TV.601', events: [text] })

    const expected = await create(plain)
    const changed = await create(converted)
    try {
      await expected.renderer._setColorSpace('bt709', false)
      await changed.renderer._setColorSpace('bt709', false)

      // The test is only valid if the first track changes the colors.
      expect(diff(await changed.capture(), await expected.capture(), 0).maxDelta, 'TV.601 track is converted').toBeGreaterThan(0)

      await changed.renderer.setTrack(plain)
      expect(diff(await changed.capture(), await expected.capture(), 0).maxDelta, 'a None track is not converted').toBe(0)
    } finally {
      await expected.jassub.destroy()
      await changed.jassub.destroy()
    }
  })
})

test('rawRender skips unchanged frames and clears when the subtitles end', async () => {
  const { jassub, renderer } = await create(track({ events: ['Default,,0,0,0,,static'] }))
  try {
    const frame = async (time: number, force = 0) => {
      const images: unknown[] | null = await renderer._wasm.rawRender(time, force)
      return images === null ? 'unchanged' : images.length ? 'images' : 'empty'
    }
    expect(await frame(1)).toBe('images')
    expect(await frame(2), 'the canvas still shows the same frame').toBe('unchanged')
    expect(await frame(2, 1), 'a repaint draws the frame again').toBe('images')
    expect(await frame(6), 'the event ended, so the canvas is cleared').toBe('empty')
    expect(await frame(7)).toBe('unchanged')
  } finally {
    await jassub.destroy()
  }
})

test('rawRender skips empty images', async () => {
  // Most lines collide and move off-screen, so libass clips them to zero size.
  const { jassub, renderer } = await create(COLLISIONS)
  try {
    await jassub.manualRender(FRAME)
    // 8 values per image, w and h come first, see JASSUB.cpp
    const view: Int32Array = await renderer._wasm.rawRender(FRAME.mediaTime, 1)
    const sizes = Array.from({ length: view.length / 8 }, (_, i) => ({ w: view[i * 8]!, h: view[i * 8 + 1]! }))
    expect(sizes.length).toBeGreaterThan(0)
    expect(sizes.filter(size => size.w <= 0 || size.h <= 0)).toHaveLength(0)
  } finally {
    await jassub.destroy()
  }
})

describe('event and style API', () => {
  test('removeEvent removes the event from the track', async () => {
    const both = await create(track({ events: ['Default,,0,0,0,,{\\an8}first', 'Default,,0,0,0,,{\\an2}second'] }))
    const expected = await create(track({ events: ['Default,,0,0,0,,{\\an2}second'] }))
    try {
      await both.renderer.removeEvent(0)

      const events = await both.renderer.getEvents()
      expect(events.map((event: { Text: string }) => event.Text)).toEqual(['{\\an2}second'])
      expect(diff(await both.capture(), await expected.capture(), 0).maxDelta).toBe(0)
    } finally {
      await both.jassub.destroy()
      await expected.jassub.destroy()
    }
  })

  test('removeStyle moves the events of the removed style to the default style', async () => {
    // Style indexes: 0 is the libass default, 1 is Red, 2 is Default.
    const withRed = await create(track({ styles: [RED, DEFAULT], events: ['Default,,0,0,0,,{\\an8}default', 'Red,,0,0,0,,{\\an2}red'] }))
    const expected = await create(track({ styles: [DEFAULT], events: ['Default,,0,0,0,,{\\an8}default', 'Default,,0,0,0,,{\\an2}red'] }))
    try {
      await withRed.renderer.removeStyle(1)

      const styles = await withRed.renderer.getStyles()
      expect(styles.map((style: { Name: string }) => style.Name)).not.toContain('Red')
      const events = await withRed.renderer.getEvents()
      expect(events.map((event: { Style: number }) => event.Style), 'both events use Default').toEqual([1, 1])
      expect(diff(await withRed.capture(), await expected.capture(), 0).maxDelta).toBe(0)
    } finally {
      await withRed.jassub.destroy()
      await expected.jassub.destroy()
    }
  })

  test('an invalid index rejects and does not change the track', async () => {
    const { jassub, renderer } = await create(track({ events: ['Default,,0,0,0,,text'] }))
    try {
      const event = (await renderer.getEvents())[0]
      await expect(renderer.setEvent(event, 1)).rejects.toThrow(/no event at index 1/)
      await expect(renderer.removeEvent(-1)).rejects.toThrow(/no event at index -1/)
      await expect(renderer.setStyle({}, 99)).rejects.toThrow(/no style at index 99/)
      await expect(renderer.removeStyle(99)).rejects.toThrow(/no style at index 99/)
      expect(await renderer.getEvents()).toHaveLength(1)
    } finally {
      await jassub.destroy()
    }
  })

  const LATE_EVENT = 'Dialogue: 0,0:00:10.00,0:00:12.00,Default,,0,0,0,,late'
  const texts = async (renderer: any) => (await renderer.getEvents()).map((event: { Text: string }) => event.Text)

  test('pruneEvents removes only the events that ended before the deadline', async () => {
    const { jassub, renderer } = await create(track({ events: ['Default,,0,0,0,,early'] }))
    try {
      await renderer.processData(LATE_EVENT)
      await renderer.pruneEvents(5000)
      expect(await texts(renderer), 'an event that ends at the deadline is kept').toEqual(['early', 'late'])
      await renderer.pruneEvents(6000)
      expect(await texts(renderer)).toEqual(['late'])
    } finally {
      await jassub.destroy()
    }
  })

  test('configurePrune removes ended events after a render and applies to later tracks', async () => {
    const content = track({ events: ['Default,,0,0,0,,early'] })
    const { jassub, renderer } = await create(content)
    try {
      await renderer.processData(LATE_EVENT)
      await renderer._draw(11)
      expect(await texts(renderer), 'pruning is disabled by default').toEqual(['early', 'late'])

      await renderer.configurePrune(0)
      await renderer._draw(11)
      expect(await texts(renderer)).toEqual(['late'])

      await renderer.setTrack(content)
      await renderer.processData(LATE_EVENT)
      await renderer._draw(11)
      expect(await texts(renderer), 'the new track keeps the prune delay').toEqual(['late'])
    } finally {
      await jassub.destroy()
    }
  })

  test('setEvent can move an event to a time after a render', async () => {
    const { jassub, renderer } = await create(track({ events: ['Default,,0,0,0,,moved'] }))
    try {
      const frameAt = async (time: number) => opaquePixels(await renderer._drawCapture(time))
      expect(await frameAt(1), 'the event is visible at its first time').toBeGreaterThan(0)

      await renderer.setEvent({ Start: 10000, Duration: 2000 }, 0)
      expect(await frameAt(1), 'the event is gone from its first time').toBe(0)
      expect(await frameAt(11), 'the event is visible at its new time').toBeGreaterThan(0)
    } finally {
      await jassub.destroy()
    }
  })

  test('removeAllEvents keeps the styles', async () => {
    const { jassub, renderer, capture } = await create(track({ events: ['Default,,0,0,0,,text'] }))
    try {
      const styles = await renderer.getStyles()
      await renderer.removeAllEvents()
      expect(await renderer.getEvents()).toEqual([])
      expect(await renderer.getStyles()).toEqual(styles)
      expect(opaquePixels(await capture())).toBe(0)
    } finally {
      await jassub.destroy()
    }
  })

  test('the API is safe to call after freeTrack', async () => {
    const { jassub, renderer, capture } = await create(track({ events: ['Default,,0,0,0,,text'] }))
    try {
      await renderer.freeTrack()
      expect(await renderer.getEvents()).toEqual([])
      expect(await renderer.getStyles()).toEqual([])
      await expect(renderer.processData('Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,text')).rejects.toThrow(/no track is loaded/)
      await expect(renderer.pruneEvents(0)).rejects.toThrow(/no track is loaded/)
      await expect(renderer.removeAllEvents()).rejects.toThrow(/no track is loaded/)
      await renderer.configurePrune(0)
      expect(opaquePixels(await capture())).toBe(0)
    } finally {
      await jassub.destroy()
    }
  })

  test('styleOverride without FontName renders text', async () => {
    const { jassub, renderer, capture } = await create(track({ events: ['Default,,0,0,0,,override'] }))
    try {
      await renderer.styleOverride({ FontSize: 96, PrimaryColour: 0xFFFFFF00 })
      expect(opaquePixels(await capture())).toBeGreaterThan(0)
    } finally {
      await jassub.destroy()
    }
  })
})
