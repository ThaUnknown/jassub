
const renderer = new JASSUB({
  video: document.querySelector('video'),
  subUrl: '../subtitles/test.ass',
  workerUrl: '../assets/jassub-worker.js',
  availableFonts: {
    'liberation sans': '../fonts/default.woff2'
  }
})
window.changeResolution = function (width, height) {
  containerC.style.width = width + 'px'
  containerC.style.height = height + 'px'
}
