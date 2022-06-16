const renderer = new SubtitlesOctopus({
  video: document.querySelector('video'),
  renderMode: 'lossy',
  subUrl: '../subtitles/FGOBD.ass',
  workerUrl: '../subtitles-octopus-worker.js',
  fallbackFont: '../fonts/default.woff2',
  fonts: [
    '../fonts/Averia Sans Libre Light.ttf',
    '../fonts/Averia Serif Simple Light.ttf',
    '../fonts/Gramond.ttf'
  ],
  timeOffset: -0.041
})
