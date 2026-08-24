import AkariSub from 'akarisub'
import throughput from 'throughput'

import type { PerfCallback } from '$lib/constants'

import workerUrl from '$akarisub/dist/ts/worker.js?worker&url'
import mtGlueUrl from '$akarisub/pkg/akarisub-mt.js?url'
import mtWasmUrl from '$akarisub/pkg/akarisub-mt.wasm?url'
import glueUrl from '$akarisub/pkg/akarisub.js?url'
import wasmUrl from '$akarisub/pkg/akarisub.wasm?url'

export default async function (subUrl: string, video: HTMLVideoElement, timeOffset = 0, fonts: string[] = [], cb: PerfCallback) {
  const _fps = throughput(5)
  const _processingDuration = throughput(5)
  let presentedFrames = 0
  const instance = new AkariSub({
    video,
    subUrl,
    fonts,
    timeOffset,
    workerUrl,
    wasmUrl,
    glueUrl,
    mtWasmUrl,
    mtGlueUrl,
    onRender: (event) => {
      const fps = _fps(1)
      const processingDuration = _processingDuration(event.renderTimeMs / fps)
      ++presentedFrames
      cb({
        presentedFrames,
        mistimedFrames: -1,
        droppedFrames: -1,
        fps,
        processingDuration
      })
    }
  })

  return () => instance.destroy()
}
