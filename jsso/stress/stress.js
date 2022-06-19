const renderer = new SubtitlesOctopus({
  video: document.querySelector('video'),
  renderMode: 'lossy',
  subUrl: '../subtitles/beastars.ass',
  workerUrl: '../subtitles-octopus-worker.js',
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
