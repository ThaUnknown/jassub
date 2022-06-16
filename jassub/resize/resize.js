

const renderer = new JASSUB({
  video: document.querySelector('video'),
  subUrl: '../../subtitles/test.ass',
  workerUrl: '../jassub-worker.js',
  fallbackFont: '../../fonts/default.woff2'
})
window.changeResolution = function (width, height) {
  containerC.style.width = width + 'px'
  containerC.style.height = height + 'px'
}
