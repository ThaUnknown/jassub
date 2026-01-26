<h1 align="center">
  JASSUB
</h1>
<p align="center">
  The Fastest JavaScript SSA/ASS Subtitle Renderer For Browsers.
</p>
JASSUB is a JS wrapper for <a href="https://github.com/libass/libass">libass</a>, which renders <a href="https://en.wikipedia.org/wiki/SubStation_Alpha">SSA/ASS subtitles</a> directly in your browser. It uses Emscripten to compile libass' C++ code to WASM, and WebGL for hardware acceleration.

<p align="center">
  <a href="https://jassub.pages.dev" target="_blank">Demo</a>
</h1>

## Features

* Supports all SSA/ASS features (everything libass supports)
* Supports all OpenType, TrueType and WOFF fonts, as well as embedded fonts
* Supports anamorphic videos [(on browsers which support it)](https://caniuse.com/mdn-api_htmlvideoelement_requestvideoframecallback)
* Supports color space mangling [(on browsers which support it)](https://caniuse.com/mdn-api_videocolorspace)
* Capable of using local fonts [(on browsers which support it)](https://caniuse.com/mdn-api_window_querylocalfonts)
* Capable of finding fonts online (opt-in, done via Google Fonts API)
* Works fast (all the heavy lifting is done by WebAssembly and WebGL, with absolutely minimal JS glue)
* Is fully multi-threaded
* Is asynchronous (renders when available, not in order of execution)
* Benefits from hardware acceleration (uses WebGL)
* Doesn't manipulate the DOM to render subtitles
* Easy to use - just connect it to video element

## Requirements

The

```json
{
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin"
}
```

headers are recommended to use this library, as it uses SharedArrayBuffer for multi-threading, but if you can't set them, it will fallback automatically to work in single-threaded mode. Firefox doesn't support threading so they are not required there.

At minimum WASM + WebGL2 + TextDecoder + OffscreenCanvas + Web Workers + Proxy + AbortController + Fetch + Promise + getVideoPlaybackQuality/requestVideoFrameCallback are required for JASSUB to work.

<!-- 
WASM:              57 11 52    /  51 11 47
WebGL2:            56 15 51    /  43 10.1 42
TextDecoder:       38 10.1 20  /  38 10.1 19
OffscreenCanvas:   69 17 105   /  58 16.2 44
BigInt:            67 15 68
Web Workers:       4 4 3.5
Promise:           33 7.1 29   /  4 3.1 2
Proxy:             49 10 18
AbortController:   66 12 57    /  4 3.1 2
Fetch:             42 10.1 39  /  41 10.1 34
getVPQ/rVFC:       80 8 42     /  28 8 42
-->

JASSUB supports Chrome/Safari/Firefox 80/17/105, you bring the support down to 67/16.2/68 if you enable some flags/settings in your browser for these features, and polyfill AbortController. For other engines other polyfills might be needed. Babel is also recommended if you need to support older JS engines as JASSUB ships as ES modules with modern syntax.

<!-- See https://github.com/gpuweb/gpuweb/wiki/Implementation-Status for a WebGPU support table, and what flags you might need to enable it in your browser if you want to utilise it instead of WebGL2. -->

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
import workerUrl from 'jassub/dist/jassub-worker.js?worker&url'
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
import JASSUB from 'jassub'

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

Example usage can be found in the demo source [here](https://github.com/ThaUnknown/jassub/tree/gh-pages).

## Understanding font management

If you know for sure that your subtitles use specific fonts, you can pre-load them via the `fonts` option when creating the JASSUB instance:

```js
const instance = new JASSUB({
  video: document.querySelector('video'),
  subUrl: './tracks/sub.ass', 
  fonts: [new URL('./fonts/GandhiSans-Regular.woff', import.meta.url).href, new Uint8Array(data)]
})
```

This will load/fetch the fonts ASAP when the renderer and WASM is initiated, this process is non-blocking.

If you however have a very big database of fonts and/or you're unsure if your subtitles use, or you want to conserve memory, bandwidth etc you can define fonts via `availableFonts`, which is a case-insensitive, postscript-insensitive map of fonts and their sources. This means the keys can, but don't need to include the weight of the font, but it is preferred. For example:

```js
const instance = new JASSUB({
  video: document.querySelector('video'),
  subUrl: './tracks/sub.ass',
  availableFonts: {
    'Gandhi Sans': new URL('./fonts/GandhiSans-Regular.ttf', import.meta.url).href,
    'RoBoTO mEdiuM': new Uint8Array(data), // this is quite stupid if you want to conserve resources, since the data will be lingering in memory, but it is supported
    'roboto': new URL('./fonts/Roboto-Medium.woff2', import.meta.url).href
  }
})
```

When JASSUB then needs one of these fonts for immediate rendering it will load the font from the given source, however this will cause a [flash of unstyled text](https://css-tricks.com/fout-foit-foft/) as the font is being loaded asynchronously, which looks something like this:

<img src='./docs/fout.gif'>

With complex typesetting this might not just be text, but glyphs, icons etc.

The above also applies to the default font, you can pre-load it via fonts\[], or use availableFonts. If you use `await instance.renderer.setDefaultFont('Gandhi Sans')` and wish to preload it, you should do so manually via `await instance.renderer.addFonts(['Gandhi Sans'])`.

## About finding fonts online

By default, JASSUB will only use embedded, constructor defined and local fonts. However, if you want to enable online font finding, you can do so by setting the `queryFonts` option to `'localandremote'` when creating the JASSUB instance, note that this loads 50+ KB of code:

```js
const instance = new JASSUB({
  video: document.querySelector('video'),
  subUrl: './tracks/sub.ass',
  queryFonts: 'localandremote'
})
```

This finds fonts from the free and public Google Fonts API if they aren't available locally or embedded, which has some privacy implications \[in theory, not in practice]. Be mindful of the [licensing](https://fonts.google.com/knowledge/glossary/licensing).
Note that Google Fonts doesn't include a lot of non-free fonts such as Arial, so this isn't a perfect solution.

## Looking for backwards compatibility with much older browser engines?

If you want to support even older engines, then please check the [v1.8.8 tag](https://github.com/ThaUnknown/jassub/releases/tag/1.8.8), or install it via:

```shell
[p]npm i jassub@1.8.8
```

Support for older browsers (without WebGL, WebAssembly threads, etc) has been dropped in v2.0.0 and later.

# How to build?

## Get the Source

Run git clone --recursive https://github.com/ThaUnknown/jassub.git

### Docker

1. Install Docker
2. ./run-docker-build.sh or ./run-docker-build.ps1
