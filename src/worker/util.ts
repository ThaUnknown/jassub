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

const IS_INCOMPETENT_BROWSER = /firefox/i.test(navigator.userAgent) || /applewebkit\/[\d.]+ \(khtml, like gecko\)(?!.*chrome\/)/i.test(navigator.userAgent)

const a = 'BT601'
const b = 'BT709'
const c = 'SMPTE240M'
const d = 'FCC'

export const LIBASS_YCBCR_MAP = [null, a, null, a, a, b, b, c, c, d, d] as const

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

const USES_GROWABLE_OR_SHARED_MEMORY = !!WebAssembly.Memory.prototype.toResizableBuffer || THREAD_COUNT > 1

// HACK: 3 memory hacks to support here:
// 1. Chromium growable memory can reference the buffer directly. Refresh the HEAPU8 view so it never goes stale.
// 2. Chromium non-growable multithreaded memory needs the HEAPU8 view recreated after growth because of race conditions.
// 3. Firefox and Safari reject resizable or shared WASM buffer views in WebGL, so the bitmap data is copied into a normal buffer.
// Safari's SharedArrayBuffer support is inconsistent across versions, it is treated like Firefox here.
export const SHOULD_REFERENCE_MEMORY = !IS_INCOMPETENT_BROWSER && USES_GROWABLE_OR_SHARED_MEMORY

// Firefox and Safari reject resizable or shared WASM buffer views in WebGL.
export const NEEDS_WASM_BUFFER_COPY = IS_INCOMPETENT_BROWSER && USES_GROWABLE_OR_SHARED_MEMORY

export const IDENTITY_MATRIX = new Float32Array([
  1, 0, 0,
  0, 1, 0,
  0, 0, 1
])

// Color matrix conversion map - 3x3 matrices for the renderers
// Each matrix converts FROM the key color space TO the nested key color space
const colorMatrixConversionMap = {
  BT601: {
    BT709: new Float32Array([
      1.0863, 0.0965, -0.01411,
      -0.0723, 0.8451, -0.0277,
      -0.0141, 0.0584, 1.0418
    ]),
    BT601: IDENTITY_MATRIX
  },
  BT709: {
    BT601: new Float32Array([
      0.9137, 0.0784, 0.0079,
      -0.1049, 1.1722, -0.0671,
      0.0096, 0.0322, 0.9582
    ]),
    BT709: IDENTITY_MATRIX
  },
  FCC: {
    BT709: new Float32Array([
      1.0873, -0.0736, -0.0137,
      0.0974, 0.8494, 0.0531,
      -0.0127, -0.0251, 1.0378
    ]),
    BT601: new Float32Array([
      1.001, -0.0008, -0.0002,
      0.0009, 1.005, -0.006,
      0.0013, 0.0027, 0.996
    ])
  },
  SMPTE240M: {
    BT709: new Float32Array([
      0.9993, 0.0006, 0.0001,
      -0.0004, 0.9812, 0.0192,
      -0.0034, -0.0114, 1.0148
    ]),
    BT601: new Float32Array([
      0.913, 0.0774, 0.0096,
      -0.1051, 1.1508, -0.0456,
      0.0063, 0.0207, 0.973
    ])
  }
} as const

export function resolveColorMatrix (subtitleColorSpace?: 'BT601' | 'BT709' | 'SMPTE240M' | 'FCC', videoColorSpace?: 'BT601' | 'BT709') {
  if (!subtitleColorSpace || !videoColorSpace) return IDENTITY_MATRIX
  return colorMatrixConversionMap[subtitleColorSpace][videoColorSpace]
}
