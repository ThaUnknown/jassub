const renderer = new JASSUB({
  video: document.querySelector('video'),
  subUrl: '../subtitles/box.ass',
  workerUrl: '../jassub-worker.js',
  availableFonts: {
    'liberation sans': '../fonts/default.woff2'
  }
})
