# jassub-legacy

A minimal demo that runs [jassub](https://github.com/ThaUnknown/jassub) down to Chrome 34, FireFox 34, Safari 9, Edge 12. One subtitle track, no other code around it.

## How it works

`src/main.ts` picks the lowest-level build the browser can run, and `src/polyfills/` fills in the rest.

| Tier | Build | Floor |
|---|---|---|
| shipped | `jassub/dist` as published, threads, post-MVP wasm | Chrome 85, Firefox 79, Safari 15 |
| legacy-wasm | single-thread WebAssembly MVP build, see `legacy-build/` | Chrome 57, Firefox 52, Safari 11, Edge 16 |
| wasm2js | the same build as JavaScript through the Emscripten `WASM=2` shim | Chrome 34, FireFox 34, Safari 9, Edge 12 |

## Run

```sh
pnpm install
pnpm build
pnpm preview
```

Open `http://127.0.0.1:4173/`. `pnpm dev` only works on current browsers: Vite serves workers as modules there, and old browsers need classic workers. The preview server sends the cross-origin isolation headers, so `crossOriginIsolated` browsers get the threaded build; the legacy tiers do not need them.

## The legacy build

The 2 lower tiers need 3 files in `legacy/`, which is git-ignored. `legacy-build/` produces them with Emscripten 4.0.23 in Docker, from the jassub 2.5.36 commit this demo depends on:

```sh
docker build -t jassub-legacy legacy-build
docker run --rm -v "${PWD}:/demo" jassub-legacy
```

The kit clones that commit, disables threads, links the libass stack against the WebAssembly MVP target, adds an embind override for engines without a configurable function `name`, and writes the `.wasm`, the wasm2js shim and the classic-script glue. It takes about 30 minutes on 8 cores. Without the files the demo works on Chrome 85 and newer only.

## What gets polyfilled

Page, in `src/polyfills/main/`:

| API | Native since | Stand-in |
|---|---|---|
| `Proxy` | Chrome 49, Firefox 18, Safari 10, Edge 12 | proxy-polyfill. It can only trap properties that exist on the target when the proxy is created, so the build seeds the abslink proxy target with the renderer method names. |
| `transferControlToOffscreen` | Chrome 69, Firefox 105, Safari 17 | Returns a handle that an abslink transfer handler sends to the worker, where it becomes a software canvas. The worker posts atlas pages and raw `drawImage` calls back, and the page replays them on the real canvas, which clips. |
| `requestVideoFrameCallback` | Chrome 83, Firefox 132, Safari 15.4 | `rvfc-polyfill` from jassub where the frame counters exist, otherwise a `currentTime` check on animation frames. |
| `ResizeObserver` | Chrome 64, Firefox 69, Safari 13.1 | Polls the client size of each target on animation frames. |
| `WebAssembly` | Chrome 57, Firefox 52, Safari 11 | A stub with `Module`, `Instance` and `validate`. jassub compiles an empty module as a test, the stub passes it. |
| `Promise`, `Symbol`, `Map`, `WeakMap`, ... | | `@vitejs/plugin-legacy` with core-js. |

Worker, in `src/polyfills/worker/`:

| API | Native since | Stand-in |
|---|---|---|
| `Proxy` | see above | proxy-polyfill, for the font callback that the page hands to the worker. |
| `OffscreenCanvas`, `ImageData` | Chrome 69, Firefox 105, Safari 16.4 | A 2D canvas that keeps the last atlas page and records `drawImage` and `clearRect` for the page. jassub falls back to its Canvas2D renderer on its own, because `getContext('webgl')` returns null. |
| `WebAssembly.instantiateStreaming` | Chrome 61, Firefox 58, Safari 15 | `arrayBuffer()` then `instantiate()`. With the wasm2js shim it skips the fetch. |
| `fetch` | Chrome 42, Firefox 39, Safari 10.1 | `whatwg-fetch`. |
| `Worker` name option | Chrome 70, Firefox 55, Safari 12.1 | The worker defines `self.name` itself. |
| module workers | Chrome 80, Firefox 114, Safari 15 | Every worker is a classic script. The `import()` of the emscripten glue in jassub is replaced by `jassubLoadWasmGlue()`. |
| `performance`, `AbortController` | | Small shims. |
| ES2015 and later, built-ins | | Babel transpiles the legacy worker chunk to ES5. core-js loads as the prebuilt `core-js-bundle` script, separately, because its Symbol sham and the Babel helpers cannot share one transpiled chunk. |

Two more fixes are not polyfills:

* The build drops `type: 'module'` from the worker jassub creates, so every bundle can be a classic script.
* Below Chrome 90 the worker drops the `desynchronized` canvas attribute, where a transferred `OffscreenCanvas`
  renders nothing with it.

## Testing on old Chromium

Chromium snapshots for every milestone are public at
`https://commondatastorage.googleapis.com/chromium-browser-snapshots/index.html`.

Builds up to about Chrome 60 are 32-bit under `Win/`, newer ones are under `Win_x64/`. Both answer XML listings, so you can search a range instead of browsing pages:

```sh
curl -s "https://commondatastorage.googleapis.com/chromium-browser-snapshots/?delimiter=/&prefix=Win_x64/7689"
```

That returns the revisions starting with `7689`, for example `Win_x64/768966/`. List that folder to find the archive:

```sh
curl -s "https://commondatastorage.googleapis.com/chromium-browser-snapshots/?prefix=Win_x64/768966/"
```

Download `chrome-win.zip`, or `chrome-win32.zip` under `Win/`, extract it and start `chrome.exe`. The version is the file version of `chrome.dll`:

```powershell
(Get-ChildItem -Recurse chrome.dll | Select-Object -First 1).VersionInfo.FileVersion
```

Revisions used for this demo. The tier is what the page picks by itself, no flags involved:

| Chromium | Snapshot | Tier |
|---|---|---|
| 34.0.1847 | `Win/251904` | wasm2js |
| 37.0.1986 | `Win/269627` | wasm2js |
| 38.0.2125 | `Win/290052` | wasm2js |
| 40.0.2214 | `Win/303348` | wasm2js |
| 49.0.2623 | `Win/369909` | wasm2js |
| 58.0.3029 | `Win/454473` | legacy-wasm |
| 84.0.4147 | `Win_x64/768966` | legacy-wasm |
| 85.0.4183 | `Win_x64/782797` | shipped |
| 90.0.4430 | `Win_x64/857997` | shipped |
| 100.0.4896 | `Win_x64/972766` | shipped |

The snapshots have no H.264 decoder, so the page serves the WebM source first. Start `pnpm preview`, which sends the cross-origin isolation headers, open the page and check that the subtitles appear over the video.

## Layout

```
index.html                     page
src/main.ts                    tier choice, creates jassub
src/capabilities.ts            picks the shipped, legacy or wasm2js build
src/polyfills/main/            page polyfills
src/polyfills/worker/          worker polyfills, install.ts runs before jassub loads
src/offscreen-canvas/          the fake OffscreenCanvas, both ends and the message protocol
src/worker/worker-shipped.ts   worker for the shipped build, bundles both emscripten glues
src/worker/worker-legacy.ts    worker for the legacy build, ES5, loads core-js and the glue as scripts
src/worker/pthread-*.ts        classic-script entries for the emscripten pthread workers
src/vite-plugins/              the jassub and abslink patches, Babel, the legacy build assets
legacy-build/                  Docker kit that produces the legacy build
legacy/                        where the legacy build goes, git-ignored
public/media/                  video, subtitles and fonts
```

## License

SPDX-License-Identifier: GPL-3.0-or-later

Copyright (C) 2026 JASSUB contributors.

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version.

This program is distributed in the hope that it will be useful, but WITHOUT
ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with
this program. If not, see <https://www.gnu.org/licenses/>.

Third-party media and fonts keep their own licenses.
