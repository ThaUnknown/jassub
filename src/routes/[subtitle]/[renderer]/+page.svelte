<script lang='ts'>
  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
  import type { PerfInfo, renderers } from '$lib/constants'

  import { page } from '$app/state'

  export let data

  let perf: PerfInfo | null = null

  function renderer (node: HTMLVideoElement) {
    const impl = data.renderer as (typeof renderers)[number]

    const rend = import(`$lib/renderers/${impl}.ts`).then(mod => mod.default(data.subUrl || page.state.subtitle, node, data.delay, data.fonts || page.state.fonts, (info: PerfInfo) => { perf = info }))

    return {
      destroy: () => rend.then(destroyer => destroyer())
    }
  }
</script>

<video src={data.videoUrl || page.state.video} controls use:renderer loop muted />

<div style='position: absolute; top: 0; left: 0; color: white; background: rgba(0, 0, 0, 0.5); padding: 5px; font-family: monospace; font-size: 12px;'>
  {#if perf}
    <div>FPS: {perf.fps.toFixed(2)}</div>
    <div>Processing Duration: {perf.processingDuration.toFixed(2)} ms</div>
    <div>Dropped Frames: {perf.droppedFrames}</div>
    <div>Presented Frames: {perf.presentedFrames}</div>
    <div>Mistimed Frames: {perf.mistimedFrames}</div>
  {/if}
</div>
