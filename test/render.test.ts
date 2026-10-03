import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { CASES } from './support/cases.ts'
import { dumpDiff } from './support/dump.ts'
import { CORPUS_FONTS } from './support/fonts.ts'
import { createPair, diff, type Frame, type Renderer } from './support/harness.ts'
import { logTolerance } from './support/log.ts'

// The reference build uses an older libass. Antialiasing at glyph edges never
// matches exactly, so allow a small difference. Cases can override the bounds.
const TOL = 1
const MIN_WITHIN = 0.995
const MAX_MEAN_ABS = 0.03

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

describe('render vs jassub@1.8.8', () => {
  for (const c of CASES) {
    test(c.name, async () => {
      // A case that loosens any tolerance must say why.
      const override = c.tol != null || c.minWithin != null || c.maxMeanAbs != null
      if (override) expect(c.tolReason, 'tolerance override needs a reason').toBeTruthy()

      await modern.setTrack(c.ass)
      let identity: Frame | undefined
      if (c.videoColorSpace) {
        identity = await modern.captureAt(c.time)
        await modern.setColorSpace(c.videoColorSpace)
      }
      const captured = await modern.captureAt(c.time)
      // The conversion must change the frame, or the comparison is trivial.
      if (identity) expect(diff(identity, captured, 8).meanAbs, 'color conversion changes the frame').toBeGreaterThan(0)

      if (c.modernOnly) {
        const again = await modern.captureAt(c.time)
        expect(diff(captured, again, 0).maxDelta).toBe(0)
        return
      }

      await old.setTrack(c.ass)
      if (c.videoColorSpace) await old.setColorSpace(c.videoColorSpace)
      const reference = await old.captureAt(c.time)
      expect(captured.width).toBe(reference.width)
      expect(captured.height).toBe(reference.height)

      const tol = c.tol ?? TOL
      const needWithin = c.minWithin ?? MIN_WITHIN
      const needMeanAbs = c.maxMeanAbs ?? MAX_MEAN_ABS
      const d = diff(captured, reference, tol)
      const pass = d.within >= needWithin && d.meanAbs <= needMeanAbs
      logTolerance(c.name, { within: d.within, meanAbs: d.meanAbs, max: d.maxDelta }, pass, c.tolReason)
      if (1 - d.within > DUMP_DIFF) await dumpDiff(c.name, captured, reference)

      expect(d.within, 'matching pixel fraction').toBeGreaterThanOrEqual(needWithin)
      expect(d.meanAbs, 'mean channel difference').toBeLessThanOrEqual(needMeanAbs)
    })
  }
})
