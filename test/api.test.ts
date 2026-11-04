import { describe, expect, test, vi } from 'vitest'

import JASSUB from '../src/jassub.ts'

import { LATO } from './support/fonts.ts'
import { diff, EMPTY_ASS } from './support/harness.ts'

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

  test('setTrack applies the color space of the new track', async () => {
    const text = 'Default,,0,0,0,,{\\1c&H0000FF&}red {\\1c&H00FF00&}green {\\1c&HFF0000&}blue'
    const plain = track({ events: [text] })
    const converted = track({ scriptInfo: 'YCbCr Matrix: TV.601', events: [text] })

    const expected = await create(plain)
    const changed = await create(converted)
    try {
      await expected.renderer._setColorSpace('BT709')
      await changed.renderer._setColorSpace('BT709')

      // The test is only valid if the first track changes the colors.
      expect(diff(await changed.capture(), await expected.capture(), 0).maxDelta, 'TV.601 track is converted').toBeGreaterThan(0)

      await changed.renderer.setTrack(plain)
      expect(diff(await changed.capture(), await expected.capture(), 0).maxDelta, 'track without a matrix is not converted').toBe(0)
    } finally {
      await expected.jassub.destroy()
      await changed.jassub.destroy()
    }
  })
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

  test('the API is safe to call after freeTrack', async () => {
    const { jassub, renderer, capture } = await create(track({ events: ['Default,,0,0,0,,text'] }))
    try {
      await renderer.freeTrack()
      expect(await renderer.getEvents()).toEqual([])
      expect(await renderer.getStyles()).toEqual([])
      await expect(renderer.processData('Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,text')).rejects.toThrow(/no track is loaded/)
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
