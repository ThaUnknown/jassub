const renderer = new JASSUB({
  video: document.querySelector('video'),
  subUrl: '../subtitles/box.ass',
  workerUrl: '../jassub-worker.js',
  fallbackFont: '../../fonts/default.woff2'
})
