export interface ASSEvent {
  Start: number
  Duration: number
  Name: string
  Effect: string
  Text: string
  ReadOrder: number
  Layer: number
  Style: number
  MarginL: number
  MarginR: number
  MarginV: number
}

export interface ASSStyle {
  Name: string
  FontName: string
  FontSize: number
  PrimaryColour: number
  SecondaryColour: number
  OutlineColour: number
  BackColour: number
  Bold: number
  Italic: number
  Underline: number
  StrikeOut: number
  ScaleX: number
  ScaleY: number
  Spacing: number
  Angle: number
  BorderStyle: number
  Outline: number
  Shadow: number
  Alignment: number
  MarginL: number
  MarginR: number
  MarginV: number
  Encoding: number
  treat_fontname_as_pattern: number
  Blur: number
  Justify: number
}

export interface ASSImage {
  w: number
  h: number
  dst_x: number
  dst_y: number
  stride: number
  color: number
  bitmap: number
  cache_id: number
}

// offset by 1, 0 = 1, to match CSS font-weight values, but dividing by 100 gives the correct index
export const WEIGHT_MAP = [
  'thin',
  'extralight',
  'light',
  'regular', // Normal isn't used
  'medium',
  'semibold',
  'bold',
  'extrabold',
  'black',
  'ultrablack'
] as const

export type WeightValue = typeof WEIGHT_MAP[number]

export async function fetchok (url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`JASSUB: failed to fetch ${url}: HTTP ${res.status}`)
  return res
}

export async function fetchtext (url: string) {
  const res = await fetchok(url)
  return await res.text()
}

export const THREAD_COUNT = self.crossOriginIsolated ? Math.min(Math.max(1, navigator.hardwareConcurrency - 2), 8) : 1
