import { describe, expect, test } from 'vitest'

import { createModern, diff, stats } from './support/harness.ts'
import { logInfo } from './support/log.ts'

const HEADER = `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Lato,72,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,2,2,20,20,20,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`

function animatedTrack (count = 40) {
  let text = ''
  for (let i = 0; i < count; i++) {
    const start = (i * 0.25).toFixed(2).padStart(5, '0')
    const end = (i * 0.25 + 4).toFixed(2).padStart(5, '0')
    const x1 = (i * 97) % 1100
    const y1 = (i * 53) % 600
    const x2 = (i * 193) % 1100
    const y2 = (i * 71) % 600
    const color = ((i * 0x0F0F0F) & 0xFFFFFF).toString(16).padStart(6, '0').toUpperCase()
    text += `Dialogue: ${i % 100},0:00:${start},0:00:${end},Default,,0,0,0,,{\\an5\\pos(${x1},${y1})\\move(${x1},${y1},${x2},${y2},0,4000)\\t(0,4000,\\frz360)\\1c&H${color}&\\fad(200,200)}Animated sign ${i}\n`
  }
  return HEADER + text
}

const FRAMES = 90
const STEP = 1 / 30
const START = 0.5

// The test prints the timing only. It does not assert a time. Compare the values
// between builds.
describe('performance', () => {
  test('animated playback', async () => {
    const renderer = await createModern(animatedTrack(), { width: 1280, height: 720 })
    try {
      // The scene must change, or the timing is for a still frame.
      const first = await renderer.captureAt(START)
      const later = await renderer.captureAt(START + 2)
      expect(diff(first, later, 8).within).toBeLessThan(0.999)

      // Warm up the glyph cache and the JIT.
      for (let i = 0; i < 15; i++) await renderer.renderTimed(START + i * STEP)

      const times: number[] = []
      for (let i = 0; i < FRAMES; i++) times.push(await renderer.renderTimed(START + i * STEP))
      const s = stats(times)
      logInfo('animated playback', `avg=${s.avg}ms  p50=${s.p50}  p95=${s.p95}  max=${s.max}  n=${s.n}`)
    } finally {
      await renderer.destroy()
    }
  })
})
