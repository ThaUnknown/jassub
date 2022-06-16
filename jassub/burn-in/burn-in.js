const renderer = new JASSUB({
  video: document.querySelector('video'),
  subUrl: '../subtitles/FGOBD.ass',
  workerUrl: '../jassub-worker.js',
  fallbackFont: '../fonts/default.woff2',
  fonts: [
    '../fonts/Averia Sans Libre Light.ttf',
    '../fonts/Averia Serif Simple Light.ttf',
    '../fonts/Gramond.ttf'
  ],
  timeOffset: -0.041
})
