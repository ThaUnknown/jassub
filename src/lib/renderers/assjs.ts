import ASS from 'assjs-v2'
import throughput from 'throughput'

import type { PerfCallback } from '$lib/constants'

export default async function (url: string, element: HTMLVideoElement, delay = 0, fonts: string[] = [], cb: PerfCallback) {
  const res = await fetch(url)
  const content = await res.text()
  await new Promise(resolve => element.requestVideoFrameCallback(resolve))

  // register the fonts as css fonts
  for (const font of fonts) {
    const fontFace = new FontFace(font.slice(font.lastIndexOf('/') + 1, font.lastIndexOf('.')), `url(${font})`)
    await fontFace.load()
    document.fonts.add(fontFace)
  }

  const _fps = throughput(5)
  const _processingDuration = throughput(5)
  let presentedFrames = 0
  let mistimedFrames = 0
  // @ts-expect-error patching lib to profile it
  globalThis.profile = (mediaTimeSeconds: number) => {
    const ms = Math.max(0, mediaTimeSeconds) * 1000 // fix for when video loops, and convert to ms
    const fps = _fps(1)
    ++presentedFrames
    const processingDuration = _processingDuration(ms / fps)
    if (ms > 42) ++mistimedFrames

    cb({
      presentedFrames,
      mistimedFrames,
      droppedFrames: -1,
      fps,
      processingDuration
    })
  }
  const ass = new ASS(content, element, {
    resampling: 'video_width',
    container: element.parentElement!
  })

  ass.delay = -delay

  ass.show()

  return () => ass.destroy()
}
