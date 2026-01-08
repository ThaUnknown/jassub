import type { PerfCallback } from '$lib/constants'

export default async function (url: string, element: HTMLVideoElement, delay: number, fontsURLS: string[], cb: PerfCallback) {
  await import('https://unpkg.com/opentype.js@latest/dist/opentype.min.js')
  await import('https://unpkg.com/@sabre-js/sabre@latest/dist/sabre.min.js')
  const res = await fetch(url)
  const subtitles = await res.arrayBuffer()

  const fonts = await Promise.all(fontsURLS.map(font => opentype.load(font)))

  const renderer = new sabre.Renderer({
    fonts,
    subtitles,
    colorSpace: sabre.VideoColorSpaces.AUTOMATIC,
    resolution: [1280, 720],
    nativeResolution: [1280, 720]
  })

  element.requestVideoFrameCallback(function renderFrame (now, metadata) {
    renderer.drawFrame(metadata.mediaTime + delay, document.getElementById('subtitle-canvas') as HTMLCanvasElement, '2d')
    element.requestVideoFrameCallback(renderFrame)
  })

  return () => renderer.dispose()
}
