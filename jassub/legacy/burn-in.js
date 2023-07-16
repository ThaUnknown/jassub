const renderer = new JASSUB.default({
  video: document.querySelector('video'),
  subUrl: '../../subtitles/FGOBD.ass',
  workerUrl: '../assets/jassub-worker.js',
  availableFonts: {
    'liberation sans': '../../fonts/default.woff2'
  },
  fonts: [
    '../../fonts/Averia Sans Libre Light.ttf',
    '../../fonts/Averia Serif Simple Light.ttf',
    '../../fonts/Gramond.ttf'
  ],
  timeOffset: -0.041,
  debug: true,
  asyncRender: false
})
