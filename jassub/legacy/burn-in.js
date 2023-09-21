const renderer = new JASSUB.default({
  video: document.querySelector('video'),
  subUrl: '../../subtitles/FGOBD.ass',
  workerUrl: '../../dist/worker.js',
  wasmUrl: '../jassub/assets/jassub-worker.wasm',
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
