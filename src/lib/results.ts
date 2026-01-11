import type { subtitleList, renderers } from './constants'

type Renderer = (typeof renderers)[number]
type Subtitle = keyof typeof subtitleList
type ResultKey = `${Renderer}-${Subtitle}`

// Common annotation symbols: * † ‡ + ◊ § ¶ # ※
export const annotations = {
  '*': 'Known timing issues',
  '†': 'Subtitles desync from video position progressively',
  '‡': 'Partial implementation, missing/incorrectly implemented ASS features',
  '+': 'Major rendering issues',
  '◊': 'Incorrect colors',
  '#': 'Can\'t be accurately measured, but considered real-time'
} as const satisfies Record<string, string>

export type Annotation = keyof typeof annotations

export interface Result {
  frametime: number | 'FAIL'
  notes?: Annotation[]
}

export const results: Record<ResultKey, Result> = {
  'jassub-variable': { frametime: 0.12 },
  'jassub-high': { frametime: 0.19 },
  'jassub-simple': { frametime: 1.15 },
  'jassub-fate': { frametime: 3.37 },
  'jassub-beastars': { frametime: 11.35 },
  'jassub-kusriya': { frametime: 7.13 },
  'jsso-variable': { frametime: 1, notes: ['*'] },
  'jsso-high': { frametime: 1, notes: ['*'] },
  'jsso-simple': { frametime: 8, notes: ['*'] },
  'jsso-fate': { frametime: 21.1, notes: ['*'] },
  'jsso-beastars': { frametime: 273.3, notes: ['*'] },
  'jsso-kusriya': { frametime: 58.1, notes: ['*'] },
  'assjs-variable': { frametime: 30, notes: ['†', '#'] },
  'assjs-high': { frametime: 12, notes: ['†', '#'] },
  'assjs-simple': { frametime: 42, notes: ['‡', '#'] },
  'assjs-fate': { frametime: 680.12, notes: ['‡', '+'] },
  'assjs-beastars': { frametime: 67.71, notes: ['‡', '◊', '+'] },
  'assjs-kusriya': { frametime: 'FAIL' },
  'sabre-variable': { frametime: 'FAIL' },
  'sabre-high': { frametime: 'FAIL' },
  'sabre-simple': { frametime: 'FAIL' },
  'sabre-fate': { frametime: 'FAIL' },
  'sabre-beastars': { frametime: 'FAIL' },
  'sabre-kusriya': { frametime: 'FAIL' }
}
