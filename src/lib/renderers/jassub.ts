import JASSUB from 'jassub'
import modernWasmUrl from 'jassub/dist/wasm/jassub-worker-modern.wasm?url'
import wasmUrl from 'jassub/dist/wasm/jassub-worker.wasm?url'
import workerUrl from 'jassub/dist/worker/worker.js?worker&url'

import type { PerfCallback } from '$lib/constants'

export default async function (subUrl: string, video: HTMLVideoElement, timeOffset = 0, fonts: string[] = [], cb: PerfCallback) {
  const instance = new JASSUB({
    video,
    subUrl,
    fonts,
    workerUrl,
    modernWasmUrl,
    wasmUrl,
    debug: true,
    timeOffset,
    queryFonts: 'localandremote'
  })

  instance.debug!.onsubtitleFrameCallback = (_now, info) => cb(info)
  await instance.ready

  return () => instance.destroy()
}
