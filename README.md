<h1 align="center">
  JASSUB
</h1>
<p align="center">
  JavaScript SSA/ASS Subtitle Renderer For Modern Browsers.
</p>
JASSUB is a JS wrapper for <a href="https://github.com/libass/libass">libass</a>, which renders <a href="https://en.wikipedia.org/wiki/SubStation_Alpha">SSA/ASS subtitles</a> directly in your browser. It uses Emscripten to compile libass' C++ code to WASM, and WebGPU for hardware acceleration.

## Features

* Supports all SSA/ASS features (everything libass supports)
* Supports all OpenType, TrueType and WOFF fonts, as well as embedded fonts
* Supports anamorphic videos
* Supports color space mangling
* Capable of using local fonts [(on browsers which support it)](https://caniuse.com/mdn-api_window_querylocalfonts)
* Works fast (all the heavy lifting is done by WebAssembly and WebGPU, with absolutely minimal JS glue)
* Is fully multi-threaded
* Is asynchronous (renders when available, not in order of execution)
* Benefits from hardware acceleration (uses WebGPU)
* Doesn't manipulate the DOM to render subtitles
* Easy to use - just connect it to video element

## Requirements

```json
{
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin"
}
```

Headers are recommended to use this library, as it uses SharedArrayBuffer for multi-threading, but if you can't set them, it will still work in single-threaded mode.

See https://github.com/gpuweb/gpuweb/wiki/Implementation-Status for a WebGPU support table, and what flags you might need to enable it in your browser.

## Usage

Install the library via:

```shell
[p]npm i jassub
```

```js
import JASSUB from 'jassub'

const instance = new JASSUB({
  video: document.querySelector('video'),
  subUrl: './tracks/sub.ass'
})
```

If you use a custom bundler, and need to override the worker and wasm URLs you can instead do:

```js
import JASSUB from 'jassub'
import workerUrl from 'jassub/dist/jassub-worker.js?url'
import wasmUrl from 'jassub/dist/jassub-worker.wasm?url' // non-SIMD fallback
import modernWasmUrl from 'jassub/dist/jassub-worker-modern.wasm?url' // SIMD

const instance = new JASSUB({
  video: document.querySelector('video'),
  subContent: subtitleString,
  workerUrl, // you can also use: `new URL('jassub/dist/jassub-worker.js', import.meta.url)` instead of importing it as an url, or whatever solution suits you
  wasmUrl,
  modernWasmUrl
})
```

However this shoud almost never be necessary.

## Using only with canvas

You're also able to use it without any video. However, that requires you to set the time the subtitles should render at yourself:

```js
import JASSUB from './jassub.es.js'

const instance = new JASSUB({
  canvas: document.querySelector('canvas'),
  subUrl: './tracks/sub.ass'
})

await instance.ready

instance.setCurrentTime(15)
```

# Docs

The library is fully typed, so you can simply browse the types of `instance` or `instance.renderer`. "Private" fields are prefixed with `_` such as `_fontId` or `_findAvailableFonts`, and shouldn't be used by developers, but can if the need arises.

`instance.renderer` calls are ALWAYS async as it's a remote worker, which means you should always await/then them for the IPC call to be serialized!!! For example:

```ts
const x = instance.renderer.useLocalFonts // does nothing, returns IPC proxy object
const y = await instance.renderer.useLocalFonts // returns true/false

instance.renderer.useLocalFonts = false // this is fine
await (instance.renderer.useLocalFonts = false) // or u can await it for safety

instance.renderer.setDefaultFont('Gandhi Sans') // this is fine, sets default font
await instance.renderer.setDefaultFont('Gandhi Sans') // or you can await if if you want
```

Make sure to always `await instance.ready` before running any methods!!!

## Looking for backwards compatibility with older browser engines?

Please check the [v1.8.8 tag](https://github.com/ThaUnknown/jassub/releases/tag/1.8.8), or install it via:

```shell
[p]npm i jassub@1.8.8
```

Support for older browsers (without WebGPU, WebAssembly threads, etc) has been dropped in v2.0.0 and later.

# How to build?

## Get the Source

Run git clone --recursive https://github.com/ThaUnknown/jassub.git

### Docker

1. Install Docker
2. ./run-docker-build.sh or ./run-docker-build.ps1
