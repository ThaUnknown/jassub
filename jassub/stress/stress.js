const renderer = new JASSUB({
  video: document.querySelector('video'),
  subUrl: '../subtitles/beastars.ass',
  workerUrl: '../jassub-worker.js',
  fonts: [
    '../fonts/architext.regular.ttf',
    '../fonts/FRABK.TTF',
    '../fonts/allison-script.regular.otf',
    '../fonts/Lato-Regular.ttf',
    '../fonts/chawp.otf',
    '../fonts/arial.ttf',
    '../fonts/SlatePro-Medium.otf'
  ],
  availableFonts: {
    'liberation sans': '../fonts/default.woff2'
  },
  timeOffset: 246.45
})
