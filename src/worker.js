import WASM from 'wasm'

const read_ = (url, ab) => {
  const xhr = new XMLHttpRequest()
  xhr.open('GET', url, false)
  xhr.responseType = ab ? 'arraybuffer' : 'text'
  xhr.send(null)
  return xhr.response
}
const readAsync = (url, load, err) => {
  const xhr = new XMLHttpRequest()
  xhr.open('GET', url, true)
  xhr.responseType = 'arraybuffer'
  xhr.onload = () => {
    if ((xhr.status === 200 || xhr.status === 0) && xhr.response) {
      return load(xhr.response)
    }
  }
  xhr.onerror = err
  xhr.send(null)
}

if (!Date.now) Date.now = () => new Date().getTime()
if (!('performance' in self)) self.performance = { now: () => Date.now() }

// implement console methods if they're missing
if (typeof console === 'undefined') {
  const msg = (command, a) => {
    postMessage({
      target: 'console',
      command,
      content: JSON.stringify(Array.prototype.slice.call(a))
    })
  }
  // eslint-disable-next-line no-global-assign
  console = {
    log: function () {
      msg('log', arguments)
    },
    debug: function () {
      msg('debug', arguments)
    },
    info: function () {
      msg('info', arguments)
    },
    warn: function () {
      msg('warn', arguments)
    },
    error: function () {
      msg('error', arguments)
    }
  }
  console.log('Detected lack of console, overridden console')
}

let lastCurrentTime = 0
const rate = 1
let rafId = null
let nextIsRaf = false
let lastCurrentTimeReceivedAt = Date.now()
let targetFps = 24
let useLocalFonts = false
let blendMode = 'js'
let availableFonts = {}
const fontMap_ = {}
let fontId = 0
let debug

self.width = 0
self.height = 0

let asyncRender = false

self.addFont = ({ font }) => asyncWrite(font)

const findAvailableFonts = font => {
  font = font.trim().toLowerCase()

  if (font.startsWith('@')) font = font.substring(1)

  if (fontMap_[font]) return

  fontMap_[font] = true

  if (!availableFonts[font]) {
    if (useLocalFonts) postMessage({ target: 'getLocalFont', font })
  } else {
    asyncWrite(availableFonts[font])
  }
}

const asyncWrite = font => {
  if (typeof font === 'string') {
    readAsync(font, fontData => {
      allocFont(new Uint8Array(fontData))
    }, console.error)
  } else {
    allocFont(font)
  }
}

// TODO: this should re-draw last frame!
const allocFont = uint8 => {
  const ptr = _malloc(uint8.byteLength)
  self.HEAPU8.set(uint8, ptr)
  jassubObj.addFont('font-' + (fontId++), ptr, uint8.byteLength)
  jassubObj.reloadFonts()
}

const processAvailableFonts = content => {
  if (!availableFonts) return

  const sections = parseAss(content)

  for (let i = 0; i < sections.length; i++) {
    for (let j = 0; j < sections[i].body.length; j++) {
      if (sections[i].body[j].key === 'Style') {
        findAvailableFonts(sections[i].body[j].value.Fontname)
      }
    }
  }

  const regex = /\\fn([^\\}]*?)[\\}]/g
  let matches
  while ((matches = regex.exec(content)) !== null) {
    findAvailableFonts(matches[1])
  }
}
/**
 * Set the subtitle track.
 * @param {!string} content the content of the subtitle file.
 */
self.setTrack = ({ content }) => {
  // Make sure that the fonts are loaded
  processAvailableFonts(content)

  if (dropAllBlur) content = dropBlur(content)
  // Tell libass to render the new track
  jassubObj.createTrackMem(content)

  subtitleColorSpace = libassYCbCrMap[jassubObj.trackColorSpace]
  postMessage({ target: 'verifyColorSpace', subtitleColorSpace })
}

self.getColorSpace = () => postMessage({ target: 'verifyColorSpace', subtitleColorSpace })

/**
 * Remove subtitle track.
 */
self.freeTrack = () => {
  jassubObj.removeTrack()
}

/**
 * Set the subtitle track.
 * @param {!string} url the URL of the subtitle file.
 */
self.setTrackByUrl = ({ url }) => {
  // simulate throttling due to network or resource pressure
  // let delay = 0;
  let fontnameIndex;

  const process = line => {
    preprocess: if (availableFonts) {
      // Ignore empty lines and comments
      if (!line || line.startsWith(';')) {
        break preprocess;
      }

      // Reset format with new sections
      if (line.startsWith('[')) {
        fontnameIndex = undefined;
        break preprocess;
      }

      const verb = line.split(':')[0];

      if (verb === 'Format') {
        fontnameIndex = line.split(',').findIndex(s => s.trim() === 'Fontname');
      } else if (verb === 'Style') {
        let font = line.split(',')[fontnameIndex].trim();

        if (font) {
          findAvailableFonts(font);
        }
      }

      const regex = /\\fn([^\\}]*?)[\\}]/g;
      let matches;
      while ((matches = regex.exec(line)) !== null) {
        findAvailableFonts(matches[1])
      }
    }

    // delay += 200 + Math.random() * 500;
    // setTimeout(() => {
    if (dropAllBlur) line = dropBlur(line)
    jassubObj.processLine(line);
    // }, delay);
  };

  _fetch(url).then(response => {
    let partialLine = '';

    return response.body
      .pipeThrough(new TextDecoderStream())
      .pipeTo(new WritableStream({
        start: () => {
          jassubObj.newEmptyTrack();
          subtitleColorSpace = libassYCbCrMap[jassubObj.trackColorSpace];
          postMessage({ target: 'verifyColorSpace', subtitleColorSpace });
        },
        write: (chunk) => {
          // Extract lines from chunk
          const lines = (partialLine + chunk).split(/\r\n|[\r\n]/g);

          // Save last line, as it might be incomplete
          partialLine = lines.pop() || '';

          // Process each complete line
          lines.forEach(process);
        },
        close: () => {
          // Process the last partial line, if any
          if (partialLine) {
            process(partialLine);
          }
        }
      }));
  });
}

const getCurrentTime = () => {
  const diff = (Date.now() - lastCurrentTimeReceivedAt) / 1000
  if (_isPaused) {
    return lastCurrentTime
  } else {
    if (diff > 5) {
      console.error('Didn\'t received currentTime > 5 seconds. Assuming video was paused.')
      setIsPaused(true)
    }
    return lastCurrentTime + (diff * rate)
  }
}
const setCurrentTime = currentTime => {
  lastCurrentTime = currentTime
  lastCurrentTimeReceivedAt = Date.now()
  if (!rafId) {
    if (nextIsRaf) {
      rafId = requestAnimationFrame(renderLoop)
    } else {
      renderLoop()

      // Give onmessage chance to receive all queued messages
      setTimeout(() => {
        nextIsRaf = false
      }, 20)
    }
  }
}

let _isPaused = true
const setIsPaused = isPaused => {
  if (isPaused !== _isPaused) {
    _isPaused = isPaused
    if (isPaused) {
      if (rafId) {
        clearTimeout(rafId)
        rafId = null
      }
    } else {
      lastCurrentTimeReceivedAt = Date.now()
      rafId = requestAnimationFrame(renderLoop)
    }
  }
}

const a = 'BT601'
const b = 'BT709'
const c = 'SMPTE240M'
const d = 'FCC'

const libassYCbCrMap = [null, a, null, a, a, b, b, c, c, d, d]

const render = (time, force) => {
  const times = {}
  const renderStartTime = performance.now()
  const renderResult = blendMode === 'wasm' ? jassubObj.renderBlend(time, force || 0) : jassubObj.renderImage(time, force || 0)
  if (debug) {
    const decodeEndTime = performance.now()
    const renderEndTime = jassubObj.time
    times.WASMRenderTime = renderEndTime - renderStartTime
    times.WASMBitmapDecodeTime = decodeEndTime - renderEndTime
    // performance.now is relative to the creation of the scope, since this time MIGHT be used to calculate a time difference
    // on the main thread, we need absolute time, not relative
    times.JSRenderTime = Date.now()
  }
  if (jassubObj.changed !== 0 || force) {
    const images = []
    const buffers = []
    if (!renderResult) return paintImages({ images, buffers, times })
    if (asyncRender) {
      const promises = []
      for (let result = renderResult, i = 0; i < jassubObj.count; result = result.next, ++i) {
        const reassigned = { w: result.w, h: result.h, x: result.x, y: result.y }
        const pointer = result.image
        promises.push(createImageBitmap(new ImageData(self.HEAPU8C.subarray(pointer, pointer + reassigned.w * reassigned.h * 4), reassigned.w, reassigned.h)))
        images.push(reassigned)
      }
      // use callback to not rely on async/await
      Promise.all(promises).then(bitmaps => {
        for (let i = 0; i < images.length; i++) {
          images[i].image = bitmaps[i]
        }
        if (debug) times.JSBitmapGenerationTime = Date.now() - times.JSRenderTime
        paintImages({ images, buffers: bitmaps, times })
      })
    } else {
      for (let image = renderResult, i = 0; i < jassubObj.count; image = image.next, ++i) {
        const reassigned = { w: image.w, h: image.h, x: image.x, y: image.y, image: image.image }
        if (!offCanvasCtx) {
          const buf = self.wasmMemory.buffer.slice(image.image, image.image + image.w * image.h * 4)
          buffers.push(buf)
          reassigned.image = buf
        }
        images.push(reassigned)
      }
      paintImages({ images, buffers, times })
    }
  } else {
    postMessage({
      target: 'unbusy'
    })
  }
}

self.demand = ({ time }) => {
  lastCurrentTime = time
  render(time)
}

const renderLoop = force => {
  rafId = 0
  render(getCurrentTime(), force)
  if (!_isPaused) {
    rafId = requestAnimationFrame(renderLoop)
  }
}

const paintImages = ({ times, images, buffers }) => {
  const resultObject = {
    target: 'render',
    asyncRender,
    images,
    times,
    width: self.width,
    height: self.height,
    colorSpace: subtitleColorSpace
  }

  if (offscreenRender) {
    if (offCanvas.height !== self.height || offCanvas.width !== self.width) {
      offCanvas.width = self.width
      offCanvas.height = self.height
    }
    offCanvasCtx.clearRect(0, 0, self.width, self.height)
    for (const image of images) {
      if (image.image) {
        if (asyncRender) {
          offCanvasCtx.drawImage(image.image, image.x, image.y)
          image.image.close()
        } else {
          bufferCanvas.width = image.w
          bufferCanvas.height = image.h
          bufferCtx.putImageData(new ImageData(self.HEAPU8C.subarray(image.image, image.image + image.w * image.h * 4), image.w, image.h), 0, 0)
          offCanvasCtx.drawImage(bufferCanvas, image.x, image.y)
        }
      }
    }
    if (offscreenRender === 'hybrid') {
      if (!images.length) return postMessage(resultObject)
      if (debug) times.bitmaps = images.length
      try {
        const image = offCanvas.transferToImageBitmap()
        resultObject.images = [{ image, x: 0, y: 0 }]
        resultObject.asyncRender = true
        postMessage(resultObject, [image])
      } catch (e) {
        postMessage({ target: 'unbusy' })
      }
    } else {
      if (debug) {
        times.JSRenderTime = Date.now() - times.JSRenderTime - (times.JSBitmapGenerationTime || 0)
        let total = 0
        for (const key in times) total += times[key]
        console.log('Bitmaps: ' + images.length + ' Total: ' + (total | 0) + 'ms', times)
      }
      postMessage({ target: 'unbusy' })
    }
  } else {
    postMessage(resultObject, buffers)
  }
}

/**
 * Parse the content of an .ass file.
 * @param {!string} content the content of the file
 */
const parseAss = content => {
  let m, format, lastPart, parts, key, value, tmp, i, j, body
  const sections = []
  const lines = content.split(/[\r\n]+/g)
  for (i = 0; i < lines.length; i++) {
    m = lines[i].match(/^\[(.*)\]$/)
    if (m) {
      format = null
      sections.push({
        name: m[1],
        body: []
      })
    } else {
      if (/^\s*$/.test(lines[i])) continue
      if (sections.length === 0) continue
      body = sections[sections.length - 1].body
      if (lines[i][0] === ';') {
        body.push({
          type: 'comment',
          value: lines[i].substring(1)
        })
      } else {
        parts = lines[i].split(':')
        key = parts[0]
        value = parts.slice(1).join(':').trim()
        if (format || key === 'Format') {
          value = value.split(',')
          if (format && value.length > format.length) {
            lastPart = value.slice(format.length - 1).join(',')
            value = value.slice(0, format.length - 1)
            value.push(lastPart)
          }
          value = value.map(s => {
            return s.trim()
          })
          if (format) {
            tmp = {}
            for (j = 0; j < value.length; j++) {
              tmp[format[j]] = value[j]
            }
            value = tmp
          }
        }
        if (key === 'Format') {
          format = value
        }
        body.push({
          key,
          value
        })
      }
    }
  }

  return sections
}

const blurRegex = /\\blur(?:[0-9]+\.)?[0-9]+/gm

const dropBlur = subContent => {
  return subContent.replace(blurRegex, '')
}

const requestAnimationFrame = (() => {
  // similar to Browser.requestAnimationFrame
  let nextRAF = 0
  return func => {
    // try to keep target fps (30fps) between calls to here
    const now = Date.now()
    if (nextRAF === 0) {
      nextRAF = now + 1000 / targetFps
    } else {
      while (now + 2 >= nextRAF) { // fudge a little, to avoid timer jitter causing us to do lots of delay:0
        nextRAF += 1000 / targetFps
      }
    }
    const delay = Math.max(nextRAF - now, 0)
    return setTimeout(func, delay)
    // return setTimeout(func, 1);
  }
})()

const _applyKeys = (input, output) => {
  for (const v of Object.keys(input)) {
    output[v] = input[v]
  }
}
const _fetch = fetch
let offCanvas
let offCanvasCtx
let offscreenRender
let bufferCanvas
let bufferCtx
let jassubObj
let subtitleColorSpace
let dropAllBlur
let _malloc

self.init = data => {
  try {
    const module = new WebAssembly.Module(Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00))
    if (!(module instanceof WebAssembly.Module) || !(new WebAssembly.Instance(module) instanceof WebAssembly.Instance)) throw new Error('WASM not supported')
  } catch (e) {
    console.warn(e)
    // load WASM2JS code if WASM is unsupported
    // eslint-disable-next-line no-eval
    eval(read_(data.legacyWasmUrl))
  }
  // hack, we want custom WASM URLs
  const wasm = !WebAssembly.instantiateStreaming && read_(data.wasmUrl, true)
  if (WebAssembly.instantiateStreaming) self.fetch = _ => _fetch(data.wasmUrl)
  WASM({ wasm }).then(Module => {
    _malloc = Module._malloc
    self.width = data.width
    self.height = data.height
    blendMode = data.blendMode
    asyncRender = data.asyncRender
    // Force fallback if engine does not support 'lossy' mode.
    // We only use createImageBitmap in the worker and historic WebKit versions supported
    // the API in the normal but not the worker scope, so we can't check this earlier.
    if (asyncRender && typeof createImageBitmap === 'undefined') {
      asyncRender = false
      console.error("'createImageBitmap' needed for 'asyncRender' unsupported!")
    }

    availableFonts = data.availableFonts
    debug = data.debug
    targetFps = data.targetFps || targetFps
    useLocalFonts = data.useLocalFonts
    dropAllBlur = data.dropAllBlur

    const fallbackFont = data.fallbackFont.toLowerCase()
    jassubObj = new Module.JASSUB(self.width, self.height, fallbackFont || null, debug)

    if (fallbackFont) findAvailableFonts(fallbackFont)

    for (const font of data.fonts || []) asyncWrite(font)

    if (data.subContent) {
      self.setTrack({ content: data.subContent });
    } else {
      self.setTrackByUrl({ url: data.subUrl });
    }

    subtitleColorSpace = libassYCbCrMap[jassubObj.trackColorSpace]

    jassubObj.setDropAnimations(data.dropAllAnimations || 0)

    if (data.libassMemoryLimit > 0 || data.libassGlyphLimit > 0) {
      jassubObj.setMemoryLimits(data.libassGlyphLimit || 0, data.libassMemoryLimit || 0)
    }

    postMessage({ target: 'ready' })
    postMessage({ target: 'verifyColorSpace', subtitleColorSpace })
  })
}

self.offscreenCanvas = ({ transferable }) => {
  offCanvas = transferable[0]
  offCanvasCtx = offCanvas.getContext('2d')
  if (!asyncRender) {
    bufferCanvas = new OffscreenCanvas(self.height, self.width)
    bufferCtx = bufferCanvas.getContext('2d', { desynchronized: true })
  }
  offscreenRender = true
}

self.detachOffscreen = () => {
  offCanvas = new OffscreenCanvas(self.height, self.width)
  offCanvasCtx = offCanvas.getContext('2d', { desynchronized: true })
  offscreenRender = 'hybrid'
}

self.canvas = ({ width, height, force }) => {
  if (width == null) throw new Error('Invalid canvas size specified')
  self.width = width
  self.height = height
  if (jassubObj) jassubObj.resizeCanvas(width, height)
  if (force) render(lastCurrentTime, true)
}

self.video = ({ currentTime, isPaused, rate }) => {
  if (currentTime != null) setCurrentTime(currentTime)
  if (isPaused != null) setIsPaused(isPaused)
  rate = rate || rate
}

self.destroy = () => {
  jassubObj.quitLibrary()
}

self.createEvent = ({ event }) => {
  _applyKeys(event, jassubObj.getEvent(jassubObj.allocEvent()))
}

self.getEvents = () => {
  const events = []
  for (let i = 0; i < jassubObj.getEventCount(); i++) {
    const { Start, Duration, ReadOrder, Layer, Style, MarginL, MarginR, MarginV, Name, Text, Effect } = jassubObj.getEvent(i)
    events.push({ Start, Duration, ReadOrder, Layer, Style, MarginL, MarginR, MarginV, Name, Text, Effect })
  }
  postMessage({
    target: 'getEvents',
    events
  })
}

self.setEvent = ({ event, index }) => {
  _applyKeys(event, jassubObj.getEvent(index))
}

self.removeEvent = ({ index }) => {
  jassubObj.removeEvent(index)
}

self.createStyle = ({ style }) => {
  _applyKeys(style, jassubObj.getStyle(jassubObj.allocStyle()))
}

self.getStyles = () => {
  const styles = []
  for (let i = 0; i < jassubObj.getStyleCount(); i++) {
    // eslint-disable-next-line camelcase
    const { Name, FontName, FontSize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding, treat_fontname_as_pattern, Blur, Justify } = jassubObj.getStyle(i)
    // eslint-disable-next-line camelcase
    styles.push({ Name, FontName, FontSize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding, treat_fontname_as_pattern, Blur, Justify })
  }
  postMessage({
    target: 'getStyles',
    time: Date.now(),
    styles
  })
}

self.setStyle = ({ style, index }) => {
  _applyKeys(style, jassubObj.getStyle(index))
}

self.removeStyle = ({ index }) => {
  jassubObj.removeStyle(index)
}

onmessage = ({ data }) => {
  if (self[data.target]) {
    self[data.target](data)
  } else {
    throw new Error('Unknown event target ' + data.target)
  }
}
