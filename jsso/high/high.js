const renderer = new SubtitlesOctopus({
  video: document.querySelector('video'),
  renderMode: 'lossy',
  subUrl: '../subtitles/box.ass',
  workerUrl: '../subtitles-octopus-worker.js'
})
