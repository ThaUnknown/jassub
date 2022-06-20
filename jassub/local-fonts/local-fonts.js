const renderer = new JASSUB({
  video: document.querySelector('video'),
  subUrl: '../subtitles/test.ass',
  workerUrl: '../jassub-worker.js',
  useLocalFonts: true
})
