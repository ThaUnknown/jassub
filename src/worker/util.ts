/* eslint-disable camelcase */
import type { ASS_Event, ASS_Style } from '../wasm/types'

export const read_ = (url: string, ab = false) => {
  const xhr = new XMLHttpRequest()
  xhr.open('GET', url, false)
  xhr.responseType = ab ? 'arraybuffer' : 'text'
  xhr.send(null)
  return xhr.response
}

export const readAsync = (url: string, load: (response: ArrayBuffer) => void, err: (error: unknown) => void) => {
  const xhr = new XMLHttpRequest()
  xhr.open('GET', url, true)
  xhr.responseType = 'arraybuffer'
  xhr.onload = () => {
    if ((xhr.status === 200 || xhr.status === 0) && xhr.response) {
      return load(xhr.response)
    }
  }
  xhr.onerror = err
  xhr.send(null)
}

const a = 'BT601'
const b = 'BT709'
const c = 'SMPTE240M'
const d = 'FCC'

export const libassYCbCrMap = [null, a, null, a, a, b, b, c, c, d, d] as const

export function _applyKeys<T extends (ASS_Event | ASS_Style)> (input: T, output: T) {
  for (const v of Object.keys(input) as Array<keyof T>) {
    output[v] = input[v]
  }
}
