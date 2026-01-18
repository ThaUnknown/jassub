<script lang='ts'>
  import { goto } from '$app/navigation'
  import { renderers } from '$lib/constants'

  const subtitleExtensions = ['srt', 'vtt', 'ass', 'ssa', 'sub', 'txt']
  const subRx = new RegExp(`.(${subtitleExtensions.join('|')})$`, 'i')

  const videoExtensions = ['3g2', '3gp', 'asf', 'avi', 'dv', 'flv', 'gxf', 'm2ts', 'm4a', 'm4b', 'm4p', 'm4r', 'm4v', 'mkv', 'mov', 'mp4', 'mpd', 'mpeg', 'mpg', 'mxf', 'nut', 'ogm', 'ogv', 'swf', 'ts', 'vob', 'webm', 'wmv', 'wtv']
  const videoRx = new RegExp(`.(${videoExtensions.join('|')})$`, 'i')

  const fontExtensions = ['ttf', 'ttc', 'woff', 'woff2', 'otf', 'cff', 'otc', 'pfa', 'pfb', 'pcf', 'fnt', 'bdf', 'pfr', 'eot']
  const fontRx = new RegExp(`.(${fontExtensions.join('|')})$`, 'i')

  function transferToFileList (e: { dataTransfer?: DataTransfer | null, clipboardData?: DataTransfer | null } & Event) {
    const promises = [...(e.dataTransfer ?? e.clipboardData)!.items].map(item => {
      const type = item.type
      return new Promise<File | { text: string, type: string }>(resolve => item.kind === 'string' ? item.getAsString(text => resolve({ text, type })) : resolve(item.getAsFile()!))
    })
    return Promise.all(promises)
  }

  const fonts: string[] = []
  let video = 'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
  let subtitle = ''
  async function handleTransfer (e: { dataTransfer?: DataTransfer | null, clipboardData?: DataTransfer | null } & Event) {
    for (const file of await transferToFileList(e)) {
      if (file instanceof File) {
        if (fontRx.test(file.name)) {
          fonts.push(URL.createObjectURL(file))
          console.log('Font file:', file)
        } else if (videoRx.test(file.name)) {
          console.log('Video file:', file)
          video = URL.createObjectURL(file)
        } else if (subRx.test(file.name)) {
          subtitle = URL.createObjectURL(file)
        } else {
          console.log('Other file:', file)
        }
      } else {
        subtitle = URL.createObjectURL(new Blob([file.text], { type: file.type }))
        console.log('String data:', file)
      }
    }
  }
</script>

<svelte:window on:dragover|preventDefault on:drop|preventDefault={handleTransfer} on:paste={handleTransfer} />

<main>
  <h1>Drag&Drop/Paste fonts, a video and a subtitle track</h1>

  {#if subtitle}
    {#each renderers as renderer (renderer)}
      <button on:click={() => goto(`/manual/${renderer}/`, { state: { video, subtitle, fonts } })}>
        Start with {renderer}
      </button>
    {/each}
  {/if}
</main>
