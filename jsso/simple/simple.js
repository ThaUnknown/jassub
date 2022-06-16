const renderer = new SubtitlesOctopus({
  video: document.querySelector('video'),
  renderMode: 'lossy',
  subUrl: '../subtitles/test.ass',
  workerUrl: '../subtitles-octopus-worker.js'
})
