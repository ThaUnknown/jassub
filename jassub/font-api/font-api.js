let renderer = null

fontselect.addEventListener('change', async ({ detail }) => {
  if (!detail?.[0]) return null
  console.log(detail[0])
  const blob = await detail[0].blob()
  const ab = await blob.arrayBuffer()
  const uint8 = new Uint8Array(ab)
  if (renderer) renderer.destroy()
  renderer = new JASSUB({
    video: document.querySelector('video'),
    subUrl: '../../subtitles/test.ass',
    workerUrl: '../assets/jassub-worker.js',
    fallbackFont: detail[0].fullName,
    availableFonts: {
      [detail[0].fullName.toLowerCase()]: uint8
    }
  })
})
