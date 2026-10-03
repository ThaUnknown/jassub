import { commands } from 'vitest/browser'

import type { Frame } from './harness.ts'

// Write a frame pair and a difference overlay to .vitest/attachments/. All
// files keep their alpha channel. The overlay is transparent where the frames
// are equal. The file names start with the test label.
export async function dumpDiff (label: string, modern: Frame, old: Frame): Promise<string> {
  const safe = label.replace(/[^\w.-]+/g, '_')
  const prefix = `.vitest/attachments/${safe}`
  const write = (suffix: string, base64: string) => commands.writeFile(`${prefix}${suffix}`, base64, 'base64')

  await write('__modern.png', toPng(toCanvas(modern)))
  await write('__old.png', toPng(toCanvas(old)))
  await write('__diff.png', toPng(overlay(modern, old, 16)))

  return prefix
}

function toCanvas (frame: Frame): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = frame.width
  canvas.height = frame.height
  const source = new OffscreenCanvas(frame.width, frame.height)
  source.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height), 0, 0)
  canvas.getContext('2d')!.drawImage(source, 0, 0)
  return canvas
}

function toPng (canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png').split(',')[1]!
}

// Transparent where the frames are equal. Red grows with the delta.
function overlay (a: Frame, b: Frame, gain: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = a.width
  canvas.height = a.height
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(a.width, a.height)
  for (let i = 0; i < a.data.length; i += 4) {
    let delta = 0
    for (let c = 0; c < 4; c++) delta = Math.max(delta, Math.abs(a.data[i + c]! - b.data[i + c]!))
    image.data[i] = 255
    image.data[i + 1] = delta > 128 ? 220 : 0
    image.data[i + 2] = 0
    image.data[i + 3] = Math.min(255, delta * gain)
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}
