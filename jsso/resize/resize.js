

const renderer = new SubtitlesOctopus({
  video: document.querySelector('video'),
  renderMode: 'lossy',
  subUrl: '../subtitles/test.ass',
  workerUrl: '../subtitles-octopus-worker.js'
})
window.changeResolution = function (width, height) {
  containerC.style.width = width + 'px'
  containerC.style.height = height + 'px'
}
