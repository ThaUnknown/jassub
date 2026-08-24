import type { subtitleList, renderers } from './constants'

type Renderer = (typeof renderers)[number]
type Subtitle = keyof typeof subtitleList
type ResultKey = `${Renderer}-${Subtitle}`

// Common annotation symbols: * † ‡ + ◊ § ¶ # ※
export const annotations = {
  '*': 'Timing issues',
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
  'jassub-variable': { frametime: 0.25 },
  'jassub-high': { frametime: 0.16 },
  'jassub-simple': { frametime: 3.51 },
  'jassub-fate': { frametime: 4.61 },
  'jassub-beastars': { frametime: 8.55 },
  'jassub-kusriya': { frametime: 7.31 },
  'jsso-variable': { frametime: 1, notes: ['*'] },
  'jsso-high': { frametime: 1, notes: ['*'] },
  'jsso-simple': { frametime: 24.95, notes: ['*'] },
  'jsso-fate': { frametime: 21.3, notes: ['*'] },
  'jsso-beastars': { frametime: 170.28, notes: ['*'] },
  'jsso-kusriya': { frametime: 59.11, notes: ['*'] },
  'assjs-variable': { frametime: 30, notes: ['†', '#'] },
  'assjs-high': { frametime: 12, notes: ['†', '#'] },
  'assjs-simple': { frametime: 42, notes: ['‡', '#'] },
  'assjs-fate': { frametime: 680.12, notes: ['‡', '+'] },
  'assjs-beastars': { frametime: 63.17, notes: ['‡', '◊', '+'] },
  'assjs-kusriya': { frametime: 'FAIL' },
  'sabre-variable': { frametime: 'FAIL' },
  'sabre-high': { frametime: 'FAIL' },
  'sabre-simple': { frametime: 'FAIL' },
  'sabre-fate': { frametime: 'FAIL' },
  'sabre-beastars': { frametime: 'FAIL' },
  'sabre-kusriya': { frametime: 'FAIL' },
  'subframe-variable': { frametime: 0.12 },
  'subframe-high': { frametime: 0.17 },
  'subframe-simple': { frametime: 4.30, notes: ['‡'] },
  'subframe-fate': { frametime: 41.67, notes: ['‡', '+'] },
  'subframe-beastars': { frametime: 335.66, notes: ['‡', '+'] },
  'subframe-kusriya': { frametime: 115.1 },
  'akarisub-variable': { frametime: 0.07 },
  'akarisub-high': { frametime: 0.04, notes: ['*'] },
  'akarisub-simple': { frametime: 3.56 },
  'akarisub-fate': { frametime: 10.67 },
  'akarisub-beastars': { frametime: 45.61 },
  'akarisub-kusriya': { frametime: 33.04, notes: ['+'] }
}
