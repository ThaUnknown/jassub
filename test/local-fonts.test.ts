import { afterEach, describe, expect, test, vi } from 'vitest'

import JASSUB from '../src/jassub.ts'
import { LATO } from './support/fonts.ts'

const ASS = `[Script Info]
ScriptType: v4.00+
PlayResX: 64
PlayResY: 64

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Lato,20,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,1,0,2,5,5,5,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`

function makeCanvas () {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  canvas.style.width = '64px'
  canvas.style.height = '64px'
  document.body.appendChild(canvas)
  return canvas
}

function create () {
  return new JASSUB({ canvas: makeCanvas(), subContent: ASS, fonts: [LATO], queryFonts: 'local', debug: false })
}

type LocalFontAccess = { _getLocalFont: (font: string) => Promise<Uint8Array | undefined> }

afterEach(() => {
  vi.restoreAllMocks()
  delete (globalThis as Record<string, unknown>).queryLocalFonts
})

describe('local fonts', () => {
  test('returns bytes when permission is granted', async () => {
    const bytes = new Uint8Array(await (await fetch(LATO)).arrayBuffer())
    vi.spyOn(navigator.permissions, 'query').mockResolvedValue({ state: 'granted' } as PermissionStatus)
    ;(globalThis as Record<string, unknown>).queryLocalFonts = async () => [{
      family: 'Lato',
      style: 'regular',
      blob: async () => new Blob([bytes])
    }]

    const jassub = create()
    try {
      await jassub.ready
      const result = await (jassub as unknown as LocalFontAccess)._getLocalFont('lato')
      expect(result).toBeInstanceOf(Uint8Array)
      expect(result!.byteLength).toBe(bytes.byteLength)
    } finally {
      await jassub.destroy()
    }
  })

  test('returns undefined when permission is denied', async () => {
    vi.spyOn(navigator.permissions, 'query').mockResolvedValue({ state: 'denied' } as PermissionStatus)
    ;(globalThis as Record<string, unknown>).queryLocalFonts = async () => {
      throw new Error('queryLocalFonts must not run without permission')
    }

    const jassub = create()
    try {
      await jassub.ready
      const result = await (jassub as unknown as LocalFontAccess)._getLocalFont('lato')
      expect(result).toBeUndefined()
    } finally {
      await jassub.destroy()
    }
  })

  test('constructs without the Local Font Access API', async () => {
    delete (globalThis as Record<string, unknown>).queryLocalFonts
    const jassub = create()
    try {
      await jassub.ready
      expect(jassub.renderer).toBeDefined()
    } finally {
      await jassub.destroy()
    }
  })
})
