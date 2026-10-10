import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { LATO } from './support/fonts.ts'
import { createModern, diff, EMPTY_ASS } from './support/harness.ts'

const EMPTY = EMPTY_ASS

// Inputs libass accepts. The build must stay alive and render a stable frame.
const TOLERATED: Array<[string, string]> = [
  ['script-info-only', '[Script Info]\nScriptType: v4.00+\n'],
  ['broken-style-format', '[V4+ Styles]\nFormat: garbage\nStyle: broken,,\n'],
  ['negative-margins', EMPTY + 'Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,{\\an5\\pos(-500,-500)}offscreen text\n'],
  ['huge-fontsize', EMPTY + 'Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,{\\fs9999}huge\n'],
  ['nan-time', EMPTY + 'Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,{\\move(a,b,c,d)}bad move\n'],
  ['deep-tag-nesting', EMPTY + 'Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,{\\t(0,1000,\\t(0,500,\\frz90))\\bord2}deep\n'],
  ['unclosed-override', EMPTY + 'Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,{\\b1 unclosed override\n'],
  ['duplicate-styles', EMPTY + 'Style: Default,Lato,48,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,20,1\nDialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,still fine\n']
]

// Inputs with no track. libass calls exit(4) and stops the worker. The JS side
// must reject the ready promise.
const TERMINATING: Array<[string, string]> = [
  ['empty-string', ''],
  ['not-ass-at-all', 'this is not a subtitle file, just text\nwith a few lines'],
  ['broken-events', '[Events]\nFormat: Layer\nDialogue: 0\n'],
  ['zero-playres', '[Script Info]\nPlayResX: 0\nPlayResY: 0\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,text with zero playres\n']
]

// The exit(4) path rejects twice. The test asserts one rejection, so ignore the
// duplicate.
const ignoreDuplicate = (event: PromiseRejectionEvent) => {
  const reason = String((event as unknown as { reason?: unknown }).reason)
  if (reason.includes('Unserializable') || reason.includes('exit(')) event.preventDefault()
}

beforeAll(() => window.addEventListener('unhandledrejection', ignoreDuplicate))
afterAll(() => window.removeEventListener('unhandledrejection', ignoreDuplicate))

describe('error handling', () => {
  for (const [name, content] of TOLERATED) {
    test(`tolerated: ${name}`, async () => {
      const renderer = await createModern(content, { fonts: [LATO] })
      try {
        const frame = await renderer.captureAt(1)
        const again = await renderer.captureAt(1)
        expect(frame.width).toBeGreaterThan(0)
        expect(frame.height).toBeGreaterThan(0)
        expect(diff(frame, again, 0).maxDelta).toBe(0)
      } finally {
        await renderer.destroy()
      }
    })
  }

  for (const [name, content] of TERMINATING) {
    test(`rejects: ${name}`, async () => {
      const reason = await createModern(content, { fonts: [LATO] }).then(
        () => null,
        (reason: unknown) => reason
      )
      // The real failure must reach the caller, not an abslink serialization
      // failure.
      expect(reason, 'init rejects').toBeTruthy()
      expect(String(reason)).not.toContain('Unserializable')
    })
  }

  test('renders without fonts', async () => {
    const renderer = await createModern(EMPTY + 'Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,no fonts loaded\n', { fonts: [] })
    try {
      const frame = await renderer.captureAt(1)
      expect(frame.width).toBeGreaterThan(0)
    } finally {
      await renderer.destroy()
    }
  })
})
