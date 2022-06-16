const video = document.querySelector('video')

function showPerf (now, metadata, lastmeta) {
  const msbf = (metadata.mediaTime - lastmeta.mediaTime) / (metadata.presentedFrames - lastmeta.presentedFrames)
  const fps = (1 / msbf).toFixed(3)
  fpsC.textContent = isNaN(fps) ? 0 : fps
  presC.textContent = metadata.presentedFrames
  dropC.textContent = video.getVideoPlaybackQuality()?.droppedVideoFrames
  setTimeout(() => video.requestVideoFrameCallback((n, m) => showPerf(n, m, metadata)), 150)
}

video.requestVideoFrameCallback((a, b) => showPerf(a, b, b))

playC.onclick = () => {
  if (video.paused) {
    video.play()
  } else {
    video.pause()
  }
}

fullC.onclick = () => {
  document.fullscreenElement ? document.exitFullscreen() : containerC.requestFullscreen()
}
