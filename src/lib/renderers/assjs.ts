import ASS from 'assjs-v2'

import type { PerfCallback } from '$lib/constants'

export default async function (url: string, element: HTMLVideoElement, delay = 0, fonts: string[] = [], cb: PerfCallback) {
  const res = await fetch(url)
  const content = await res.text()
  await new Promise(resolve => element.requestVideoFrameCallback(resolve))
  const ass = new ASS(content, element, {
    resampling: 'video_width',
    container: element.parentElement!
  })

  ass.delay = -delay

  ass.show()

  return () => ass.destroy()
}
