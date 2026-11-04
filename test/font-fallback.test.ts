import { afterEach, describe, expect, test } from 'vitest'

import JASSUB from '../src/jassub.ts'
import { GANDHI, LATO, ROBOTO } from './support/fonts.ts'
import { diff, type Frame } from './support/harness.ts'

// The style asks for a font that is not preloaded. The worker must load it at
// render time from availableFonts.
const ass = (fontName: string, bold: number, italic: number) => `[Script Info]
ScriptType: v4.00+
PlayResX: 256
PlayResY: 128

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},64,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,${bold},${italic},0,0,100,100,0,0,1,1,0,5,5,5,5,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,WWWW
`

const CASES = [
  { name: 'loads and applies a font added after the first frame', subContent: ass('Gandhi Sans', 1, 1), font: GANDHI, availableFonts: { 'gandhi sans': GANDHI } },
  // The weight in the font name wins over the Bold field.
  { name: 'finds a font by the weight in its name', subContent: ass('Roboto Medium', 0, 0), font: ROBOTO, availableFonts: { 'roboto medium': ROBOTO } }
]

const created: Array<{ destroy: () => Promise<void> | void }> = []
afterEach(async () => {
  while (created.length) await created.pop()!.destroy()
})

function make (opts: Record<string, unknown>) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  document.body.appendChild(canvas)
  const jassub: any = new JASSUB({ canvas, defaultFont: 'Lato', debug: false, ...opts })
  created.push(jassub)
  return jassub
}

async function captureAt (jassub: any, time: number): Promise<Frame> {
  await jassub.manualRender({ mediaTime: time, width: 256, height: 128, expectedDisplayTime: performance.now() })
  return await jassub.renderer._drawCapture(time)
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('font fallback', () => {
  test.each(CASES)('$name', async ({ subContent, font, availableFonts }) => {
    const preloaded = make({ subContent, fonts: [LATO, font], queryFonts: false })
    const lazy = make({ subContent, fonts: [LATO], availableFonts, queryFonts: false })
    const latoOnly = make({ subContent, fonts: [LATO], queryFonts: false })
    await Promise.all([preloaded.ready, lazy.ready, latoOnly.ready])

    const reference = await captureAt(preloaded, 1)
    const latoReference = await captureAt(latoOnly, 1)
    // Guard: the requested family must actually change the frame.
    expect(diff(reference, latoReference, 2).within, 'family changes the render').toBeLessThan(0.99)

    let best: Frame = await captureAt(lazy, 1)
    let bestWithin = 0
    const deadline = performance.now() + 15_000
    while (performance.now() < deadline) {
      await sleep(150)
      const frame = await captureAt(lazy, 1)
      const d = diff(frame, reference, 2)
      if (d.within > bestWithin) {
        bestWithin = d.within
        best = frame
      }
      if (d.within > 0.99) break
    }

    expect(bestWithin, 'lazy font matches the preloaded font').toBeGreaterThan(0.99)
    expect(diff(best, latoReference, 2).within, 'lazy font is not the fallback font').toBeLessThan(0.99)
  })
})
