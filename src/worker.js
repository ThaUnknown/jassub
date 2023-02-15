/* global Module, HEAPU8, _malloc, buffer */
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
    err()
  }
  xhr.onerror = err
  xhr.send(null)
}
// eslint-disable-next-line no-global-assign
Module = {
  wasm: !WebAssembly.instantiateStreaming && read_('jassub-worker.wasm', true)
}

// ran when WASM is compiled
self.ready = () => postMessage({ target: 'ready' })

self.out = text => {
  if (text === 'libass: No usable fontconfig configuration file found, using fallback.') {
    console.debug(text)
  } else {
    console.log(text)
  }
}
self.err = text => {
  if (text === 'Fontconfig error: Cannot load default config file: No such file: (null)') {
    console.debug(text)
  } else {
    console.error(text)
  }
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

  if (!availableFonts[font] && useLocalFonts) {
    return postMessage({ target: 'getLocalFont', font })
  }

  asyncWrite(availableFonts[font])
}

const asyncWrite = font => {
  if (ArrayBuffer.isView(font)) {
    allocFont(font)
  } else {
    readAsync(font, fontData => {
      allocFont(new Uint8Array(fontData))
    }, console.error)
  }
}

// TODO: this should re-draw last frame!
const allocFont = uint8 => {
  const ptr = _malloc(uint8.byteLength)
  HEAPU8.set(uint8, ptr)
  self.jassubObj.addFont('font-' + (fontId++), ptr, uint8.byteLength)
  self.jassubObj.reloadFonts()
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

  // Tell libass to render the new track
  self.jassubObj.createTrackMem(content)
}

/**
 * Remove subtitle track.
 */
self.freeTrack = () => {
  self.jassubObj.removeTrack()
}

/**
 * Set the subtitle track.
 * @param {!string} url the URL of the subtitle file.
 */
self.setTrackByUrl = ({ url }) => {
  self.setTrack({ content: read_(url) })
}

const resize = (width, height) => {
  self.width = width
  self.height = height
  self.jassubObj.resizeCanvas(width, height)
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

const render = (time, force) => {
  const renderStartTime = Date.now()
  let result = null
  if (blendMode === 'wasm') {
    result = self.jassubObj.renderBlend(time, force)
    if (result) {
      result.times = {
        renderTime: Date.now() - renderStartTime - (result && result.time) | 0,
        blendTime: (result && result.time) | 0
      }
    }
  } else {
    result = self.jassubObj.renderImage(time, force)
    if (result) {
      result.times = {
        renderTime: Date.now() - renderStartTime - (result && result.time) | 0,
        cppDecodeTime: (result && result.time) | 0
      }
    }
  }
  if (result && (self.jassubObj.changed !== 0 || force)) {
    const images = []
    let buffers = []
    const decodeStartTime = Date.now()
    // use callback to not rely on async/await
    if (asyncRender) {
      const promises = []
      for (let image = result, i = 0; i < self.jassubObj.count; image = image.next, ++i) {
        if (image.image) {
          images.push({ w: image.w, h: image.h, x: image.x, y: image.y })
          promises.push(createImageBitmap(new ImageData(HEAPU8C.subarray(image.image, image.image + image.w * image.h * 4), image.w, image.h)))
        }
      }
      Promise.all(promises).then(bitmaps => {
        for (let i = 0; i < images.length; i++) {
          images[i].image = bitmaps[i]
        }
        buffers = bitmaps
        paintImages({ images, buffers, times: result.times, decodeStartTime })
      })
    } else {
      for (let image = result, i = 0; i < self.jassubObj.count; image = image.next, ++i) {
        if (image.image) {
          const img = { w: image.w, h: image.h, x: image.x, y: image.y, image: image.image }
          if (!offCanvasCtx) {
            const buf = buffer.slice(image.image, image.image + image.w * image.h * 4)
            buffers.push(buf)
            img.image = buf
          }
          images.push(img)
        }
      }
      paintImages({ images, buffers, times: result.times, decodeStartTime })
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

const paintImages = ({ times, images, decodeStartTime, buffers }) => {
  times.decodeTime = Date.now() - decodeStartTime
  if (offCanvasCtx) {
    const drawStartTime = Date.now()
    // force updates
    offCanvas.width = self.width
    if (offCanvas.height !== self.height) offCanvas.height = self.height
    offCanvasCtx.clearRect(0, 0, self.width, self.height)
    for (const image of images) {
      if (image.image) {
        if (asyncRender) {
          offCanvasCtx.drawImage(image.image, image.x, image.y)
          image.image.close()
        } else {
          self.bufferCanvas.width = image.w
          self.bufferCanvas.height = image.h
          self.bufferCtx.putImageData(new ImageData(HEAPU8C.subarray(image.image, image.image + image.w * image.h * 4), image.w, image.h), 0, 0)
          offCanvasCtx.drawImage(self.bufferCanvas, image.x, image.y)
        }
      }
    }
    if (debug) {
      times.drawTime = Date.now() - drawStartTime
      let total = 0
      for (const key in times) total += times[key]
      console.log('Bitmaps: ' + images.length + ' Total: ' + Math.round(total) + 'ms', times)
    }
    postMessage({
      target: 'unbusy'
    })
  } else {
    postMessage({
      target: 'render',
      async: asyncRender,
      images,
      times,
      width: self.width,
      height: self.height
    }, buffers)
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

// Frame throttling

const _applyKeys = (input, output) => {
  for (const v of Object.keys(input)) {
    output[v] = input[v]
  }
}

self.init = data => {
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

  const fallbackFont = data.fallbackFont.toLowerCase()
  self.jassubObj = new Module.JASSUB(self.width, self.height, fallbackFont || null)

  if (fallbackFont) findAvailableFonts(fallbackFont)

  let subContent = data.subContent
  if (!subContent) subContent = read_(data.subUrl)

  processAvailableFonts(subContent)

  for (const font of data.fonts || []) asyncWrite(font)

  self.jassubObj.createTrackMem(subContent)
  self.jassubObj.setDropAnimations(data.dropAllAnimations)

  if (data.libassMemoryLimit > 0 || data.libassGlyphLimit > 0) {
    self.jassubObj.setMemoryLimits(data.libassGlyphLimit || 0, data.libassMemoryLimit || 0)
  }
}

self.canvas = ({ width, height, force }) => {
  if (width == null) throw new Error('Invalid canvas size specified')
  resize(width, height, force)
  if (force) render(lastCurrentTime)
}

self.video = ({ currentTime, isPaused, rate }) => {
  if (currentTime != null) setCurrentTime(currentTime)
  if (isPaused != null) setIsPaused(isPaused)
  rate = rate || rate
}

let offCanvas
let offCanvasCtx
self.offscreenCanvas = ({ transferable }) => {
  offCanvas = transferable[0]
  offCanvasCtx = offCanvas.getContext('2d', { desynchronized: true })
  if (!asyncRender) {
    self.bufferCanvas = new OffscreenCanvas(self.height, self.width)
    self.bufferCtx = self.bufferCanvas.getContext('2d', { desynchronized: true })
  }
}

self.destroy = () => {
  self.jassubObj.quitLibrary()
}

self.createEvent = ({ event }) => {
  _applyKeys(event, self.jassubObj.getEvent(self.jassubObj.allocEvent()))
}

self.getEvents = () => {
  const events = []
  for (let i = 0; i < self.jassubObj.getEventCount(); i++) {
    const { Start, Duration, ReadOrder, Layer, Style, MarginL, MarginR, MarginV, Name, Text, Effect } = self.jassubObj.getEvent(i)
    events.push({ Start, Duration, ReadOrder, Layer, Style, MarginL, MarginR, MarginV, Name, Text, Effect })
  }
  postMessage({
    target: 'getEvents',
    events
  })
}

self.setEvent = ({ event, index }) => {
  _applyKeys(event, self.jassubObj.getEvent(index))
}

self.removeEvent = ({ index }) => {
  self.jassubObj.removeEvent(index)
}

self.createStyle = ({ style }) => {
  _applyKeys(style, self.jassubObj.getStyle(self.jassubObj.allocStyle()))
}

self.getStyles = () => {
  const styles = []
  for (let i = 0; i < self.jassubObj.getStyleCount(); i++) {
    // eslint-disable-next-line camelcase
    const { Name, FontName, FontSize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding, treat_fontname_as_pattern, Blur, Justify } = self.jassubObj.getStyle(i)
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
  _applyKeys(style, self.jassubObj.getStyle(index))
}

self.removeStyle = ({ index }) => {
  self.jassubObj.removeStyle(index)
}

onmessage = ({ data }) => {
  if (self[data.target]) {
    self[data.target](data)
  } else {
    throw new Error('Unknown event target ' + data.target)
  }
}

let HEAPU8C = null

// patch EMS function to include Uint8Clamped, but call old function too
self.updateGlobalBufferAndViews = (_super => {
  return buf => {
    _super(buf)
    HEAPU8C = new Uint8ClampedArray(buf)
  }
})(self.updateGlobalBufferAndViews)
