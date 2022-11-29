const renderer = new JASSUB({
  video: document.querySelector('video'),
  subUrl: '../../subtitles/test.ass',
  workerUrl: '../assets/jassub-worker.js',
  useLocalFonts: true
})
