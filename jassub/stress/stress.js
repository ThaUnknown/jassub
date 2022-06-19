const renderer = new JASSUB({
  video: document.querySelector('video'),
  subUrl: '../subtitles/beastars.ass',
  workerUrl: '../jassub-worker.js',
  fallbackFont: '../fonts/default.woff2',
  fonts: [
    '../fonts/architext.regular.ttf',
    '../fonts/FRABK.TTF',
    '../fonts/allison-script.regular.otf',
    '../fonts/Lato-Regular.ttf',
    '../fonts/chawp.otf'
  ],
  timeOffset: 246.45
})
