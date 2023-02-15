const renderer = new JASSUB({
  video: document.querySelector('video'),
  subUrl: '../../subtitles/test.ass',
  workerUrl: '../assets/jassub-worker.js',
  debug: true,
  availableFonts: {
    'liberation sans': '../../fonts/default.woff2'
  }
})
