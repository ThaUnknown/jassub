interface VideoProto {
  requestVideoFrameCallback?: (callback: VideoFrameRequestCallback) => number
  cancelVideoFrameCallback?: (handle: number) => void
  _rvfcpolyfillmap?: unknown
}

interface PollState {
  lastTime: number
  presentedFrames: number
}

const states = new WeakMap<HTMLVideoElement, PollState>()
const frames = new Map<number, number>()
let nextHandle = 1

function requestVideoFrameCallback (this: HTMLVideoElement, callback: VideoFrameRequestCallback) {
  const video = this
  const handle = nextHandle++
  const state = states.get(video) ?? { lastTime: -1, presentedFrames: 0 }
  states.set(video, state)

  const poll = (now: number) => {
    frames.delete(handle)
    const time = video.currentTime
    // A frame is ready when the time moved, or when the first frame of a paused video is decoded.
    // Chrome advances currentTime between frames, so compare in 1/60 s steps to cap the rate at 60 per second.
    if (Math.floor(time * 60) === Math.floor(state.lastTime * 60) || video.readyState < 2) {
      frames.set(handle, requestAnimationFrame(poll))
      return
    }
    state.lastTime = time
    state.presentedFrames++
    callback(now, {
      presentationTime: now,
      expectedDisplayTime: now,
      width: video.videoWidth,
      height: video.videoHeight,
      mediaTime: time,
      presentedFrames: state.presentedFrames,
      processingDuration: 0
    })
  }
  frames.set(handle, requestAnimationFrame(poll))
  return handle
}

function cancelVideoFrameCallback (this: HTMLVideoElement, handle: number) {
  const frame = frames.get(handle)
  if (frame !== undefined) cancelAnimationFrame(frame)
  frames.delete(handle)
}

export function installVideoFrameCallback () {
  const proto = HTMLVideoElement.prototype as unknown as VideoProto
  // rvfc-polyfill marks the prototype, so its version does not count as native.
  const quality = '_rvfcpolyfillmap' in proto
  if (typeof proto.requestVideoFrameCallback === 'function' && !quality) return
  proto.requestVideoFrameCallback = requestVideoFrameCallback
  proto.cancelVideoFrameCallback = cancelVideoFrameCallback
}
