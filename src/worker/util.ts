/* eslint-disable camelcase */
import type { ASS_Event, ASS_Image, ASS_Style, ClassHandle } from '../wasm/types.d.ts'

export type ASSEvent = Omit<ASS_Event, keyof ClassHandle>
export type ASSStyle = Omit<ASS_Style, keyof ClassHandle>
export type ASSImage = Omit<ASS_Image, keyof ClassHandle>

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

export const IS_FIREFOX = navigator.userAgent.toLowerCase().includes('firefox')

const a = 'BT601'
const b = 'BT709'
const c = 'SMPTE240M'
const d = 'FCC'

export const LIBASS_YCBCR_MAP = [null, a, null, a, a, b, b, c, c, d, d] as const

export function _applyKeys<T extends (ASSEvent | ASSStyle)> (input: T, output: T) {
  for (const v of Object.keys(input) as Array<keyof T>) {
    output[v] = input[v]
  }
}

export const _fetch = globalThis.fetch
export async function fetchtext (url: string) {
  const res = await _fetch(url)
  return await res.text()
}
