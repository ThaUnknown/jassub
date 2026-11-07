import './style.css'

import JASSUB from 'jassub'
import modernWasmUrl from 'jassub/dist/wasm/jassub-worker-modern.wasm?url'
import normalWasmUrl from 'jassub/dist/wasm/jassub-worker.wasm?url'

import { chooseTier } from './capabilities.ts'
import { installMainPolyfills } from './polyfills/main/index.ts'
import pthreadModernUrl from './worker/pthread-modern.ts?worker&url'
import pthreadNormalUrl from './worker/pthread-normal.ts?worker&url'
import workerLegacyUrl from './worker/worker-legacy.ts?worker&url'
import workerShippedUrl from './worker/worker-shipped.ts?worker&url'

// Built by legacy-build/, see the README. Not part of this repository.
const LEGACY_GLUE_URL = '/legacy/jassub-worker-legacy.js'
const LEGACY_WASM_URL = '/legacy/jassub-worker-legacy.wasm'

// The clip starts 246.38 s into the episode.
const TIME_OFFSET = 246.38
const FONT_DIR = '/media/fonts/'
const FONTS = [
  'GandhiSans-Bold.otf',
  'Roboto.ttf',
  'SlatePro-Medium.otf',
  'arial.ttf',
  'Lato-Regular.ttf',
  'allison-script.regular.otf',
  'architext.regular.ttf',
  'chawp.otf',
  'FRABK.TTF'
].map(name => FONT_DIR + name)

async function main () {
  // Before the WebAssembly stub of the polyfills, which hides whether the browser has WebAssembly.
  const tier = await chooseTier()
  installMainPolyfills()

  const video = document.querySelector('video')!

  // The shipped build and its pthread workers. Both glue files are bundled in worker-shipped.ts.
  const shipped = {
    workerUrl: workerShippedUrl,
    wasmUrl: normalWasmUrl,
    modernWasmUrl,
    wasmWorkerUrl: pthreadNormalUrl,
    modernWasmWorkerUrl: pthreadModernUrl
  }

  // The single-thread MVP build, or the same build as JavaScript through the WASM=2 shim. Both pairs
  // point at the legacy build, so the SIMD check of jassub cannot pick a different one.
  const legacy = {
    workerUrl: workerLegacyUrl,
    wasmUrl: LEGACY_WASM_URL,
    modernWasmUrl: LEGACY_WASM_URL,
    wasmWorkerUrl: LEGACY_GLUE_URL,
    modernWasmWorkerUrl: LEGACY_GLUE_URL
  }

  const renderer = new JASSUB({
    video,
    subUrl: '/media/beastars.ass',
    fonts: FONTS,
    timeOffset: TIME_OFFSET,
    queryFonts: false,
    ...(tier === 'shipped' ? shipped : legacy)
  })

  await renderer.ready
}

main().catch(error => console.error(error))
