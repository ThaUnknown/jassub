import JASSUB from '../../src/jassub.ts'

// Reference build. The package installs jassub@1.8.8 as "jassub-ref".
import JASSUBOld from 'jassub-ref'

import oldWorkerUrl from 'jassub-ref/dist/jassub-worker.js?url'
import oldWasmUrl from 'jassub-ref/dist/jassub-worker.wasm?url'
import oldModernWasmUrl from 'jassub-ref/dist/jassub-worker-modern.wasm?url'
import oldLegacyWasmUrl from 'jassub-ref/dist/jassub-worker.wasm.js?url'

import { LATO } from './fonts.ts'

export interface Frame {
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface RenderOptions {
  time: number
  fonts?: string[]
  width?: number
  height?: number
}

export interface Renderer {
  canvas: HTMLCanvasElement
  render: (time: number) => Promise<void>
  renderTimed: (time: number) => Promise<number>
  capture: () => Promise<Frame>
  captureAt: (time: number) => Promise<Frame>
  setTrack: (content: string) => Promise<void>
  setColorSpace: (colorSpace: 'BT709' | 'BT601') => Promise<void>
  destroy: () => Promise<void> | void
}

const DEFAULT_FONTS = [LATO]
const DEFAULT_WIDTH = 1920
const DEFAULT_HEIGHT = 1080

// A valid track with no events. libass stops the worker on an invalid track.
export const EMPTY_ASS = `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Lato,48,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,20,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`

function makeCanvas (width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  canvas.style.position = 'absolute'
  canvas.style.top = '0'
  canvas.style.left = '0'
  document.body.appendChild(canvas)
  return canvas
}

function nextFrame () {
  return new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
}

// Fail the test if a worker does not answer.
function withTimeout<T> (promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${label}`)), ms)
    promise.then(
      value => { clearTimeout(timer); resolve(value) },
      error => { clearTimeout(timer); reject(error) }
    )
  })
}

// Read the pixels from the canvas. The modern build transfers the canvas to an
// OffscreenCanvas. The 1.8.8 build uses a plain 2D canvas.
export async function capture (canvas: HTMLCanvasElement): Promise<Frame> {
  const bitmap = await createImageBitmap(canvas)
  const off = new OffscreenCanvas(canvas.width, canvas.height)
  const ctx = off.getContext('2d')!
  ctx.clearRect(0, 0, off.width, off.height)
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return { data: ctx.getImageData(0, 0, off.width, off.height).data, width: off.width, height: off.height }
}

export async function createModern (ass: string, opts: Partial<RenderOptions> = {}): Promise<Renderer> {
  const width = opts.width ?? DEFAULT_WIDTH
  const height = opts.height ?? DEFAULT_HEIGHT
  const canvas = makeCanvas(width, height)
  const jassub = new JASSUB({
    canvas,
    subContent: ass,
    fonts: opts.fonts ?? DEFAULT_FONTS,
    // Lato is always in the font set. Use it as the fallback font.
    defaultFont: 'Lato',
    queryFonts: false,
    debug: false
  })
  await withTimeout(jassub.ready, 30_000, 'modern worker ready')
  let lastTime = 0
  const renderer: any = jassub.renderer
  return {
    canvas,
    render: async (time: number) => {
      lastTime = time
      await jassub.manualRender({ mediaTime: time, width, height, expectedDisplayTime: performance.now() })
      await nextFrame()
    },
    renderTimed: async (time: number) => {
      lastTime = time
      const t0 = performance.now()
      // Measure the worker render. manualRender() drops frames while busy.
      await renderer._draw(time, false)
      return performance.now() - t0
    },
    // Headless mode cannot read the transferred canvas. Read pixels from the
    // worker instead.
    capture: async () => {
      const pixels = await renderer._drawCapture(lastTime)
      return { data: pixels.data, width: pixels.width, height: pixels.height }
    },
    captureAt: async (time: number) => {
      lastTime = time
      await jassub.manualRender({ mediaTime: time, width, height, expectedDisplayTime: performance.now() })
      const pixels = await renderer._drawCapture(time)
      return { data: pixels.data, width: pixels.width, height: pixels.height }
    },
    setTrack: async (content: string) => {
      await renderer.setTrack(content)
    },
    setColorSpace: async (colorSpace: 'BT709' | 'BT601') => {
      await renderer._setColorSpace(colorSpace)
    },
    destroy: () => jassub.destroy()
  }
}

export async function createOld (ass: string, opts: Partial<RenderOptions> = {}): Promise<Renderer> {
  const width = opts.width ?? DEFAULT_WIDTH
  const height = opts.height ?? DEFAULT_HEIGHT
  const canvas = makeCanvas(width, height)
  const jassub: any = new JASSUBOld({
    canvas,
    subContent: ass,
    fonts: opts.fonts ?? DEFAULT_FONTS,
    workerUrl: oldWorkerUrl,
    wasmUrl: oldWasmUrl,
    modernWasmUrl: oldModernWasmUrl,
    legacyWasmUrl: oldLegacyWasmUrl,
    offscreenRender: false,
    onDemandRender: false,
    useLocalFonts: false,
    fallbackFont: 'Lato',
    availableFonts: {},
    debug: false
  })
  await withTimeout(new Promise<void>((resolve, reject) => {
    jassub.addEventListener('ready', () => resolve(), { once: true })
    jassub.addEventListener('error', (e: any) => reject(e?.error ?? new Error('jassub-ref init failed')), { once: true })
  }), 30_000, 'jassub-ref ready')
  // The 1.8.8 build sets the storage size only on resize(). Leave it unset so
  // both builds use the script layout for scaling.
  await jassub.sendMessage('canvas', { width, height, videoWidth: 0, videoHeight: 0, force: false })
  await new Promise(resolve => setTimeout(resolve, 50))
  const waitRender = () => withTimeout(new Promise<void>(resolve => {
    const handler = (e: MessageEvent) => {
      // "render" sends new pixels. "unbusy" means the frame did not change.
      if (e.data?.target === 'render' || e.data?.target === 'unbusy') {
        jassub._worker.removeEventListener('message', handler)
        resolve()
      }
    }
    jassub._worker.addEventListener('message', handler)
  }), 30_000, 'jassub-ref render')
  const waitMessage = (target: string) => withTimeout(new Promise<void>(resolve => {
    const handler = (e: MessageEvent) => {
      if (e.data?.target === target) {
        jassub._worker.removeEventListener('message', handler)
        resolve()
      }
    }
    jassub._worker.addEventListener('message', handler)
  }), 30_000, `jassub-ref ${target}`)
  return {
    canvas,
    render: async (time: number) => {
      const rendered = waitRender()
      jassub.setCurrentTime(true, time)
      await rendered
      await nextFrame()
    },
    renderTimed: async (time: number) => {
      const t0 = performance.now()
      const rendered = waitRender()
      jassub.setCurrentTime(true, time)
      await rendered
      return performance.now() - t0
    },
    capture: () => capture(canvas),
    captureAt: async (time: number) => {
      const rendered = waitRender()
      jassub.setCurrentTime(true, time)
      await rendered
      await nextFrame()
      return await capture(canvas)
    },
    setTrack: async (content: string) => {
      jassub.setTrack(content)
    },
    setColorSpace: async (colorSpace: 'BT709' | 'BT601') => {
      jassub._videoColorSpace = colorSpace
      const done = waitMessage('verifyColorSpace')
      jassub.sendMessage('getColorSpace')
      await done
    },
    destroy: () => jassub.destroy()
  }
}

export async function createPair (fonts: string[] = DEFAULT_FONTS): Promise<{ modern: Renderer, old: Renderer }> {
  return {
    modern: await createModern(EMPTY_ASS, { fonts }),
    old: await createOld(EMPTY_ASS, { fonts })
  }
}

export interface Diff {
  meanAbs: number
  within: number
  maxDelta: number
  nonZeroA: number
  nonZeroB: number
}

// Compare two frames. `within` is the fraction of pixels that differ by at most
// `tol` on every channel. `meanAbs` is the mean channel difference.
export function diff (a: Frame, b: Frame, tol = 24): Diff {
  if (a.width !== b.width || a.height !== b.height) throw new Error('frame size mismatch')
  let sum = 0
  let within = 0
  let max = 0
  let nonZeroA = 0
  let nonZeroB = 0
  for (let i = 0; i < a.data.length; i += 4) {
    let worst = 0
    for (let c = 0; c < 4; c++) {
      const delta = Math.abs(a.data[i + c] - b.data[i + c])
      sum += delta
      if (delta > worst) worst = delta
    }
    if (worst <= tol) within++
    if (worst > max) max = worst
    if (a.data[i + 3]) nonZeroA++
    if (b.data[i + 3]) nonZeroB++
  }
  const pixels = a.width * a.height
  return { meanAbs: sum / a.data.length, within: within / pixels, maxDelta: max, nonZeroA, nonZeroB }
}

export function stats (times: number[]) {
  if (!times.length) return { n: 0 }
  const sorted = [...times].sort((a, b) => a - b)
  const avg = times.reduce((a, b) => a + b, 0) / times.length
  return {
    n: times.length,
    avg: +avg.toFixed(2),
    p50: +sorted[Math.floor(sorted.length / 2)].toFixed(2),
    p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
    max: +sorted[sorted.length - 1].toFixed(2)
  }
}
