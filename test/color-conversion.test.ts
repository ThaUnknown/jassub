import { describe, expect, test } from 'vitest'

import JASSUB from '../src/jassub.ts'
import { COLOR_CONVERSIONS, IDENTITY_MATRIX } from '../src/worker/color-conversions.ts'

import { LATO } from './support/fonts.ts'
import { EMPTY_ASS } from './support/harness.ts'

// [KR, KB] from ITU-T H.273, table 4.
const LUMA: Record<string, [number, number]> = {
  'BT.601': [0.299, 0.114],
  'BT.709': [0.2126, 0.0722],
  'BT.2020': [0.2627, 0.0593],
  SMPTE240M: [0.212, 0.087],
  FCC: [0.30, 0.11]
}

const luma = (matrix: string, [r, g, b]: number[]) => {
  const [kr, kb] = LUMA[matrix]!
  return kr * r! + (1 - kr - kb) * g! + kb * b!
}

// The renderers read the conversion in this order.
const apply = (m: ArrayLike<number>, [r, g, b]: number[]) => [
  m[0]! * r! + m[3]! * g! + m[6]! * b! + m[9]!,
  m[1]! * r! + m[4]! * g! + m[7]! * b! + m[10]!,
  m[2]! * r! + m[5]! * g! + m[8]! * b! + m[11]!
]

const COLORS = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1], [0.2, 0.6, 0.9]]

// The conversion that the renderer gets for a YCbCr Matrix header and the colorSpace of a VideoFrame.
async function conversion (header: string | undefined, matrix: string | null, fullRange: boolean | null) {
  const subContent = header === undefined ? EMPTY_ASS : EMPTY_ASS.replace('[Script Info]', `[Script Info]\nYCbCr Matrix: ${header}`)
  const jassub = new JASSUB({ canvas: document.createElement('canvas'), subContent, fonts: [LATO], defaultFont: 'Lato', queryFonts: false })
  jassub._ro.disconnect()
  try {
    await jassub.ready
    const renderer: any = jassub.renderer
    await renderer._setColorSpace(matrix, fullRange)
    return Array.from(await renderer._gpurender.colorMatrix as Float32Array)
  } finally {
    await jassub.destroy()
  }
}

const IDENTITY = Array.from(IDENTITY_MATRIX)

describe('color conversion of the worker', () => {
  test('a missing header is TV.601, the classic VSFilter mangling', async () => {
    const missing = await conversion(undefined, 'bt709', false)
    expect(missing).toEqual(await conversion('TV.601', 'bt709', false))
    expect(missing).not.toEqual(IDENTITY)
  })

  test('None and an unknown header do not change the colors', async () => {
    expect(await conversion('None', 'bt709', false)).toEqual(IDENTITY)
    expect(await conversion('TV.999', 'bt709', false)).toEqual(IDENTITY)
  })

  test('RGB video and a video color space that WebCodecs does not know do not change the colors', async () => {
    expect(await conversion('TV.601', 'rgb', false)).toEqual(IDENTITY)
    expect(await conversion('TV.601', null, null)).toEqual(IDENTITY)
  })

  test('BT.601 PAL and NTSC video use the same matrix', async () => {
    expect(await conversion('TV.709', 'bt470bg', false)).toEqual(await conversion('TV.709', 'smpte170m', false))
  })

  test('an unknown range is TV range', async () => {
    expect(await conversion('TV.601', 'bt709', null)).toEqual(await conversion('TV.601', 'bt709', false))
  })

  test('TV levels on a full range video lift black', async () => {
    apply(await conversion('TV.709', 'bt709', true), [0, 0, 0]).forEach(value => expect(value).toBeCloseTo(16 / 255, 5))
  })

  test('the same color space does not change the colors', async () => {
    expect(await conversion('TV.709', 'bt709', false)).toEqual(IDENTITY)
  })
})

describe('COLOR_CONVERSIONS', () => {
  // VSFilter writes the subtitle into the video as YCbCr of the header, the video is decoded with its own matrix.
  // With the same levels the luma must not change. A transposed matrix does change it.
  test('with the same levels, the luma of the subtitle is the luma of the video', () => {
    for (const [subtitle, videos] of Object.entries(COLOR_CONVERSIONS)) {
      for (const [video, values] of Object.entries(videos ?? {})) {
        if (subtitle.slice(-2) !== video.slice(-2)) continue
        for (const color of COLORS) {
          expect(luma(video.slice(0, -3), apply(values!, color))).toBeCloseTo(luma(subtitle.slice(0, -3), color), 4)
        }
      }
    }
  })
})
