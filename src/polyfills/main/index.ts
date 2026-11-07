// Order matters. proxy-polyfill installs only when Proxy is missing, and rvfc-polyfill must run
// before the currentTime fallback.
import 'proxy-polyfill'
import 'rvfc-polyfill'

import { installRemoteCanvas } from '../../offscreen-canvas/main.ts'

import { installResizeObserver } from './resize-observer.ts'
import { installVideoFrameCallback } from './video-frame-callback.ts'
import { installWebAssemblyStub } from './webassembly-stub.ts'

export function installMainPolyfills () {
  installRemoteCanvas()
  installVideoFrameCallback()
  installResizeObserver()
  installWebAssemblyStub()
}
