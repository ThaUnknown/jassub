import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { countNonZero, parseAss, sampleCues, type CorpusCue } from './support/ass.ts'
import { dumpDiff } from './support/dump.ts'
import { CORPUS_FONTS } from './support/fonts.ts'
import { createPair, diff, type Frame, type Renderer } from './support/harness.ts'
import { logTolerance } from './support/log.ts'

// Real-world subtitles, copied into the suite. Add more .ass files under
// test/fixtures/subtitles/ to extend the check.
const FILES = import.meta.glob('/test/fixtures/subtitles/**/*.ass', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

// The blurred mask differs a little between libass versions. Allow more than the
// controlled cases, but keep the bounds tight enough to catch a color or
// content change.
const TOL = 8
const MIN_WITHIN = 0.95
const MAX_MEAN_ABS = 2
const PER_STYLE = 5
const MAX_CUES = 150

// Dump the frames only when the differing pixel fraction is above this.
// 0.004 gives a dump for a difference larger than 0.4%.
const DUMP_DIFF = 0.001

let modern: Renderer
let old: Renderer

beforeAll(async () => {
  ({ modern, old } = await createPair(CORPUS_FONTS))
})

afterAll(async () => {
  await modern.destroy()
  await old.destroy()
})

describe('real subtitles vs jassub@1.8.8', () => {
  const entries = Object.entries(FILES).sort(([a], [b]) => a.localeCompare(b))
  if (!entries.length) test.skip('no subtitle fixtures found', () => {})

  for (const [path, content] of entries) {
    const cues = sampleCues(parseAss(content), { perStyle: PER_STYLE, max: MAX_CUES })
    if (!cues.length) {
      test.skip(`${path} (no visible cues)`, () => {})
      continue
    }

    test(path, async () => {
      await modern.setTrack(content)
      await old.setTrack(content)
      let nonEmpty = 0
      let worstWithin = 1
      let worstMeanAbs = 0
      let worstMax = 0
      let worstCue: CorpusCue | undefined
      let worstCaptured: Frame | undefined
      let worstReference: Frame | undefined
      for (const cue of cues) {
        const captured = await modern.captureAt(cue.time)
        const reference = await old.captureAt(cue.time)
        const d = diff(captured, reference, TOL)
        if (d.within < worstWithin) {
          worstWithin = d.within
          worstCue = cue
          worstCaptured = captured
          worstReference = reference
        }
        worstMeanAbs = Math.max(worstMeanAbs, d.meanAbs)
        worstMax = Math.max(worstMax, d.maxDelta)
        if (countNonZero(captured.data) > 50) nonEmpty++
      }
      const pass = nonEmpty > 0 && worstWithin >= MIN_WITHIN && worstMeanAbs <= MAX_MEAN_ABS
      const label = path.split('/').pop() ?? path
      logTolerance(label, { within: worstWithin, meanAbs: worstMeanAbs, max: worstMax }, pass)
      if (1 - worstWithin > DUMP_DIFF && worstCaptured && worstReference) {
        const dumpPath = await dumpDiff(label, worstCaptured, worstReference)
        console.log(`dumped ${worstCue?.style} @ ${worstCue?.time} to ${dumpPath}*`)
      }

      expect(nonEmpty, `${path} renders content`).toBeGreaterThan(0)
      expect(worstWithin, `${path} matching pixel fraction`).toBeGreaterThanOrEqual(MIN_WITHIN)
      expect(worstMeanAbs, `${path} mean channel difference`).toBeLessThanOrEqual(MAX_MEAN_ABS)
    })
  }
})
