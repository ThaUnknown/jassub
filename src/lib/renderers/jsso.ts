import JSSO from '@jellyfin/libass-wasm'
import workerUrl from '@jellyfin/libass-wasm/dist/js/subtitles-octopus-worker.js?url'
import throughput from 'throughput'

import type { PerfCallback } from '$lib/constants'
import '@jellyfin/libass-wasm/dist/js/subtitles-octopus-worker.wasm?url'

export default async function (subUrl: string, video: HTMLVideoElement, timeOffset = 0, fonts: string[] = [], cb: PerfCallback) {
  const instance = new JSSO({
    video,
    subUrl,
    fonts,
    timeOffset,
    workerUrl,
    renderMode: 'wasm-blend',
    dropAllAnimations: false,
    libassMemoryLimit: 40,
    libassGlyphLimit: 40,
    targetFps: 24,
    debug: true,
    fallbackFont: '/fonts/default.woff2'
  })

  const originalLog = console.log
  const _fps = throughput(5)
  const _processingDuration = throughput(5)

  let presentedFrames = 0

  console.log = (log, ...rest) => {
    if (typeof log === 'string' && log.startsWith('render:')) {
      const totalMatch = log.match(/TOTAL=(\d+)\s+ms/)
      if (totalMatch) {
        const fps = _fps(1)
        const total = parseInt(totalMatch[1]!, 10)
        const processingDuration = _processingDuration(total / fps)
        ++presentedFrames
        cb({
          presentedFrames,
          mistimedFrames: presentedFrames,
          droppedFrames: -1,
          fps,
          processingDuration
        })
      }
    }
  }

  return () => {
    instance.dispose()
    console.log = originalLog
  }
}
