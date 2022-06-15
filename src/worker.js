/* global Module, FS, readBinary, read_, calledMain, addRunDependency, removeRunDependency, buffer */
const hasNativeConsole = typeof console !== 'undefined'

// implement console methods if they're missing
function makeCustomConsole () {
  const console = (function () {
    function postConsoleMessage (command, args) {
      postMessage({
        target: 'console',
        command,
        content: JSON.stringify(Array.prototype.slice.call(args))
      })
    }

    return {
      log: function () {
        postConsoleMessage('log', arguments)
      },
      debug: function () {
        postConsoleMessage('debug', arguments)
      },
      info: function () {
        postConsoleMessage('info', arguments)
      },
      warn: function () {
        postConsoleMessage('warn', arguments)
      },
      error: function () {
        postConsoleMessage('error', arguments)
      }
    }
  })()

  return console
}

/**
 * Test the subtitle file for Brotli compression.
 * @param {!string} url the URL of the subtitle file.
 * @returns {boolean} Brotli compression found or not.
 */
function isBrotliFile (url) {
  // Search for parameters
  let len = url.indexOf('?')

  if (len === -1) {
    len = url.length
  }

  return url.endsWith('.br', len)
}

Module = Module || {}

Module.preRun = Module.preRun || []

Module.preRun.push(function () {
  Module.FS_createPath('/', 'fonts', true, true)
  Module.FS_createPath('/', 'fontconfig', true, true)

  if (!self.subContent) {
    // We can use sync xhr cause we're inside Web Worker
    if (isBrotliFile(self.subUrl)) {
      self.subContent = Module.BrotliDecode(readBinary(self.subUrl))
    } else {
      self.subContent = read_(self.subUrl)
    }
  }

  if (self.availableFonts && self.availableFonts.length !== 0) {
    const sections = parseAss(self.subContent)
    for (let i = 0; i < sections.length; i++) {
      for (let j = 0; j < sections[i].body.length; j++) {
        if (sections[i].body[j].key === 'Style') {
          self.writeFontToFS(sections[i].body[j].value.Fontname)
        }
      }
    }

    const regex = /\\fn([^\\}]*?)[\\}]/g
    let matches
    while (matches = regex.exec(self.subContent)) {
      self.writeFontToFS(matches[1])
    }
  }

  Module.FS_createLazyFile('/fonts', '.fallback.' + self.fallbackFont.match(/(?:\.([^.]+))?$/)[1].toLowerCase(), self.fallbackFont, true, false)

  const fontFiles = self.fontFiles || []
  for (let i = 0; i < fontFiles.length; i++) {
    Module.FS_createLazyFile('/fonts', 'font' + i + '-' + fontFiles[i].split('/').pop(), fontFiles[i], true, false)
  }
})

const textByteLength = (input) => new TextEncoder().encode(input).buffer.byteLength

Module.onRuntimeInitialized = function () {
  self.jassubObj = new Module.JASSub()

  self.jassubObj.initLibrary(screen.width, screen.height, '/fonts/.fallback.' + self.fallbackFont.match(/(?:\.([^.]+))?$/)[1].toLowerCase())

  self.jassubObj.createTrackMem(self.subContent, textByteLength(self.subContent))
  self.jassubObj.setDropAnimations(self.dropAllAnimations)

  if (self.libassMemoryLimit > 0 || self.libassGlyphLimit > 0) {
    self.jassubObj.setMemoryLimits(self.libassGlyphLimit, self.libassMemoryLimit)
  }
}

Module.print = function (text) {
  if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(' ')
  console.log(text)
}
Module.printErr = function (text) {
  if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(' ')
  console.error(text)
}

// Modified from https://github.com/kripken/emscripten/blob/6dc4ac5f9e4d8484e273e4dcc554f809738cedd6/src/proxyWorker.js
if (!hasNativeConsole) {
  // we can't call Module.printErr because that might be circular
  console = {
    log: function (x) {
      if (typeof dump === 'function') dump('log: ' + x + '\n')
    },
    debug: function (x) {
      if (typeof dump === 'function') dump('debug: ' + x + '\n')
    },
    info: function (x) {
      if (typeof dump === 'function') dump('info: ' + x + '\n')
    },
    warn: function (x) {
      if (typeof dump === 'function') dump('warn: ' + x + '\n')
    },
    error: function (x) {
      if (typeof dump === 'function') dump('error: ' + x + '\n')
    }
  }
}

Module.FS = FS

self.delay = 0 // approximate delay (time of render + postMessage + drawImage), for example 1/60 or 0
self.lastCurrentTime = 0
self.rate = 1
self.rafId = null
self.nextIsRaf = false
self.lastCurrentTimeReceivedAt = Date.now()
self.targetFps = 24
self.libassMemoryLimit = 0 // in MiB
self.dropAllAnimations = false

self.width = 0
self.height = 0

self.fontMap_ = {}
self.fontId = 0

let asyncRender = false

/**
 * Make the font accessible by libass by writing it to the virtual FS.
 * @param {!string} font the font name.
 */
self.writeFontToFS = function (font) {
  font = font.trim().toLowerCase()

  if (font.startsWith('@')) {
    font = font.substring(1)
  }

  if (self.fontMap_[font]) return

  self.fontMap_[font] = true

  if (!self.availableFonts[font]) return
  const content = readBinary(self.availableFonts[font])

  Module.FS.writeFile('/fonts/font' + (self.fontId++) + '-' + self.availableFonts[font].split('/').pop(), content, {
    encoding: 'binary'
  })
}

/**
 * Write all font's mentioned in the .ass file to the virtual FS.
 * @param {!string} content the file content.
 */
self.writeAvailableFontsToFS = function (content) {
  if (!self.availableFonts) return

  const sections = parseAss(content)

  for (let i = 0; i < sections.length; i++) {
    for (let j = 0; j < sections[i].body.length; j++) {
      if (sections[i].body[j].key === 'Style') {
        self.writeFontToFS(sections[i].body[j].value.Fontname)
      }
    }
  }

  const regex = /\\fn([^\\}]*?)[\\}]/g
  let matches
  while (matches = regex.exec(self.subContent)) {
    self.writeFontToFS(matches[1])
  }
}
/**
 * Set the subtitle track.
 * @param {!string} content the content of the subtitle file.
 */
self.setTrack = function ({ content }) {
  // Make sure that the fonts are loaded
  self.writeAvailableFontsToFS(content)

  // Tell libass to render the new track
  self.jassubObj.createTrackMem(self.subContent, textByteLength(self.subContent))
  self.ass_track = self.jassubObj.track
  self.renderLoop()
}

/**
 * Remove subtitle track.
 */
self.freeTrack = function () {
  self.jassubObj.removeTrack()
  self.renderLoop()
}

/**
 * Set the subtitle track.
 * @param {!string} url the URL of the subtitle file.
 */
self.setTrackByUrl = function ({ url }) {
  let content = ''
  if (isBrotliFile(url)) {
    content = Module.BrotliDecode(readBinary(url))
  } else {
    content = read_(url)
  }
  self.setTrack({ content })
}

self.resize = (width, height) => {
  self.width = width
  self.height = height
  if (self.offscreenCanvas) {
    self.offscreenCanvas.width = width
    self.offscreenCanvas.height = height
  }
  self.jassubObj.resizeCanvas(width, height)
}

self.getCurrentTime = function () {
  const diff = (Date.now() - self.lastCurrentTimeReceivedAt) / 1000
  if (self._isPaused) {
    return self.lastCurrentTime
  } else {
    if (diff > 5) {
      console.error('Didn\'t received currentTime > 5 seconds. Assuming video was paused.')
      self.setIsPaused(true)
    }
    return self.lastCurrentTime + (diff * self.rate)
  }
}
self.setCurrentTime = function (currentTime) {
  self.lastCurrentTime = currentTime
  self.lastCurrentTimeReceivedAt = Date.now()
  if (!self.rafId) {
    if (self.nextIsRaf) {
      self.rafId = self.requestAnimationFrame(self.renderLoop)
    } else {
      self.renderLoop()

      // Give onmessage chance to receive all queued messages
      setTimeout(function () {
        self.nextIsRaf = false
      }, 20)
    }
  }
}

self._isPaused = true
self.getIsPaused = function () {
  return self._isPaused
}
self.setIsPaused = function (isPaused) {
  if (isPaused !== self._isPaused) {
    self._isPaused = isPaused
    if (isPaused) {
      if (self.rafId) {
        clearTimeout(self.rafId)
        self.rafId = null
      }
    } else {
      self.lastCurrentTimeReceivedAt = Date.now()
      self.rafId = self.requestAnimationFrame(self.renderLoop)
    }
  }
}

self.renderImageData = (time, force) => {
  const renderStartTime = Date.now()
  let result = null
  if (self.blendMode === 'wasm') {
    result = self.jassubObj.renderBlend(time, force)
    result.times = {
      renderTime: Date.now() - renderStartTime - result.time | 0,
      blendTime: result.time | 0
    }
  } else {
    result = self.jassubObj.renderImage(time, force)
    result.times = {
      renderTime: Date.now() - renderStartTime - result.time | 0,
      cppDecodeTime: result.time | 0
    }
  }
  return result
}

self.processRender = (result) => {
  const images = []
  let buffers = []
  const decodeStartTime = Date.now()
  // use callback to not rely on async/await
  if (asyncRender) {
    const promises = []
    for (let image = result; image.ptr !== 0; image = image.next) {
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
      self.paintImages({ images, buffers, times: result.times, decodeStartTime })
    })
  } else {
    for (let image = result; image.ptr !== 0; image = image.next) {
      if (image.image) {
        images.push({ w: image.w, h: image.h, x: image.x, y: image.y })
        buffers.push(buffer.slice(image.image, image.image + image.w * image.h * 4))
      }
    }
    self.paintImages({ images, buffers, times: result.times, decodeStartTime })
  }
}

self.render = (time, force) => {
  const result = self.renderImageData(time, force)
  if (result.changed !== 0 || force) {
    self.processRender(result)
  } else {
    postMessage({
      target: 'unbusy'
    })
  }
}

self.demand = data => {
  self.lastCurrentTime = data.time
  self.render(data.time)
}

self.renderLoop = (force) => {
  self.rafId = 0
  self.renderPending = false
  self.render(self.getCurrentTime() + self.delay, force)
  if (!self._isPaused) {
    self.rafId = self.requestAnimationFrame(self.renderLoop)
  }
}

self.paintImages = ({ images, buffers, decodeStartTime, times }) => {
  times.decodeTime = Date.now() - decodeStartTime
  if (self.offscreenCanvasCtx) {
    const drawStartTime = Date.now()
    self.offscreenCanvasCtx.clearRect(0, 0, self.offscreenCanvas.width, self.offscreenCanvas.height)
    for (const image of images) {
      if (image.image) {
        if (asyncRender) {
          self.offscreenCanvasCtx.drawImage(image.image, image.x, image.y)
          image.image.close()
        } else {
          self.bufferCanvas.width = image.w
          self.bufferCanvas.height = image.h
          self.bufferCtx.putImageData(new ImageData(HEAPU8C.subarray(image.image, image.image + image.w * image.h * 4), image.w, image.h), 0, 0)
          self.offscreenCanvasCtx.drawImage(self.bufferCanvas, image.x, image.y)
        }
      }
    }
    if (self.debug) {
      times.drawTime = Date.now() - drawStartTime
      let total = 0
      for (const key in times) total += times[key]
      console.log('Bitmaps: ' + images.length + ' Total: ' + Math.round(total) + 'ms', times)
    }
  } else {
    postMessage({
      target: 'render',
      async: asyncRender,
      images,
      times
    }, buffers)
  }
  postMessage({
    target: 'unbusy'
  })
}

/**
 * Parse the content of an .ass file.
 * @param {!string} content the content of the file
 */
function parseAss (content) {
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
          value = value.map(function (s) {
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
};

self.requestAnimationFrame = (function () {
  // similar to Browser.requestAnimationFrame
  let nextRAF = 0
  return function (func) {
    // try to keep target fps (30fps) between calls to here
    const now = Date.now()
    if (nextRAF === 0) {
      nextRAF = now + 1000 / self.targetFps
    } else {
      while (now + 2 >= nextRAF) { // fudge a little, to avoid timer jitter causing us to do lots of delay:0
        nextRAF += 1000 / self.targetFps
      }
    }
    const delay = Math.max(nextRAF - now, 0)
    return setTimeout(func, delay)
    // return setTimeout(func, 1);
  }
})()

// eslint-disable-next-line
let screen = {
  width: 0,
  height: 0
}

// Frame throttling

// Wait to start running until we receive some info from the client
addRunDependency('worker-init')

// buffer messages until the program starts to run

let messageBuffer = null
let messageResenderTimeout = null

function messageResender () {
  if (calledMain) {
    assert(messageBuffer && messageBuffer.length > 0)
    messageResenderTimeout = null
    messageBuffer.forEach(function (message) {
      onmessage(message)
    })
    messageBuffer = null
  } else {
    messageResenderTimeout = setTimeout(messageResender, 50)
  }
}

function _applyKeys (input, output) {
  const vargs = Object.keys(input)

  for (let i = 0; i < vargs.length; i++) {
    output[vargs[i]] = input[vargs[i]]
  }
}

self.init = data => {
  screen.width = self.width = data.width
  screen.height = self.height = data.height
  self.subUrl = data.subUrl
  self.subContent = data.subContent
  self.fontFiles = data.fonts
  self.fallbackFont = data.fallbackFont
  self.blendMode = data.blendMode
  asyncRender = data.asyncRender
  self.dropAllAnimations = !!data.dropAllAnimations || self.dropAllAnimations
  // Force fallback if engine does not support 'lossy' mode.
  // We only use createImageBitmap in the worker and historic WebKit versions supported
  // the API in the normal but not the worker scope, so we can't check this earlier.
  if (asyncRender && typeof createImageBitmap === 'undefined') {
    asyncRender = false
    console.error("'createImageBitmap' needed for 'asyncRender' unsupported!")
  }

  self.availableFonts = data.availableFonts
  self.debug = data.debug
  if (!hasNativeConsole && self.debug) {
    console = makeCustomConsole()
    console.log('overridden console')
  }
  self.targetFps = data.targetFps || self.targetFps
  self.libassMemoryLimit = data.libassMemoryLimit || self.libassMemoryLimit
  self.libassGlyphLimit = data.libassGlyphLimit || 0
  removeRunDependency('worker-init')
  postMessage({
    target: 'ready'
  })
}

self.canvas = data => {
  if (data.width == null) throw new Error('Invalid canvas size specified')
  self.resize(data.width, data.height)
  self.renderLoop()
}

self.video = data => {
  if (data.currentTime != null) self.setCurrentTime(data.currentTime)
  if (data.isPaused != null) self.setIsPaused(data.isPaused)
  self.rate = data.rate || self.rate
}

self.offscreenCanvas = data => {
  self.offscreenCanvas = data.transferable[0]
  self.offscreenCanvasCtx = self.offscreenCanvas.getContext('2d')
  self.bufferCanvas = new OffscreenCanvas(self.height, self.width)
  self.bufferCtx = self.bufferCanvas.getContext('2d')
}

self.destroy = () => {
  self.jassubObj.quitLibrary()
}

self.createEvent = data => {
  _applyKeys(data.event, self.jassubObj.track.get_events(self.jassubObj.allocEvent()))
}

self.getEvents = () => {
  const events = []
  for (let i = 0; i < self.jassubObj.getEventCount(); i++) {
    const evntPtr = self.jassubObj.track.get_events(i)
    events.push({
      Start: evntPtr.get_Start(),
      Duration: evntPtr.get_Duration(),
      ReadOrder: evntPtr.get_ReadOrder(),
      Layer: evntPtr.get_Layer(),
      Style: evntPtr.get_Style(),
      Name: evntPtr.get_Name(),
      MarginL: evntPtr.get_MarginL(),
      MarginR: evntPtr.get_MarginR(),
      MarginV: evntPtr.get_MarginV(),
      Effect: evntPtr.get_Effect(),
      Text: evntPtr.get_Text()
    })
  }
  postMessage({
    target: 'getEvents',
    events
  })
}

self.setEvent = data => {
  _applyKeys(data.event, self.jassubObj.track.get_events(data.index))
}

self.removeEvent = data => {
  self.jassubObj.removeEvent(data.index)
}

self.createStyle = data => {
  _applyKeys(data.style, self.jassubObj.track.get_styles(self.jassubObj.allocStyle()))
}

self.getStyles = () => {
  const styles = []
  for (let i = 0; i < self.jassubObj.getStyleCount(); i++) {
    const stylPtr = self.jassubObj.track.get_styles(i)
    styles.push({
      Name: stylPtr.get_Name(),
      FontName: stylPtr.get_FontName(),
      FontSize: stylPtr.get_FontSize(),
      PrimaryColour: stylPtr.get_PrimaryColour(),
      SecondaryColour: stylPtr.get_SecondaryColour(),
      OutlineColour: stylPtr.get_OutlineColour(),
      BackColour: stylPtr.get_BackColour(),
      Bold: stylPtr.get_Bold(),
      Italic: stylPtr.get_Italic(),
      Underline: stylPtr.get_Underline(),
      StrikeOut: stylPtr.get_StrikeOut(),
      ScaleX: stylPtr.get_ScaleX(),
      ScaleY: stylPtr.get_ScaleY(),
      Spacing: stylPtr.get_Spacing(),
      Angle: stylPtr.get_Angle(),
      BorderStyle: stylPtr.get_BorderStyle(),
      Outline: stylPtr.get_Outline(),
      Shadow: stylPtr.get_Shadow(),
      Alignment: stylPtr.get_Alignment(),
      MarginL: stylPtr.get_MarginL(),
      MarginR: stylPtr.get_MarginR(),
      MarginV: stylPtr.get_MarginV(),
      Encoding: stylPtr.get_Encoding(),
      treat_fontname_as_pattern: stylPtr.get_treat_fontname_as_pattern(),
      Blur: stylPtr.get_Blur(),
      Justify: stylPtr.get_Justify()
    })
  }
  postMessage({
    target: 'getStyles',
    time: Date.now(),
    styles
  })
}

self.setStyle = data => {
  _applyKeys(data.style, self.jassubObj.track.get_styles(data.index))
}

self.removeStyle = data => {
  self.jassubObj.removeStyle(data.index)
}

onmessage = message => {
  if (!calledMain && !message.data.preMain) {
    if (!messageBuffer) {
      messageBuffer = []
      messageResenderTimeout = setTimeout(messageResender, 50)
    }
    messageBuffer.push(message)
    return
  }
  if (calledMain && messageResenderTimeout) {
    clearTimeout(messageResenderTimeout)
    messageResender()
  }
  const data = message.data
  if (self[data.target]) {
    self[data.target](data)
  } else {
    throw new Error('Unknown event target ' + message.data.target)
  }
}

let HEAPU8C = null

function updateGlobalBufferAndViews (buf) {
  buffer = buf
  HEAPU8C = new Uint8ClampedArray(buf)
  Module.HEAP8 = HEAP8 = new Int8Array(buf)
  Module.HEAP16 = HEAP16 = new Int16Array(buf)
  Module.HEAP32 = HEAP32 = new Int32Array(buf)
  Module.HEAPU8 = HEAPU8 = new Uint8Array(buf)
  Module.HEAPU16 = HEAPU16 = new Uint16Array(buf)
  Module.HEAPU32 = HEAPU32 = new Uint32Array(buf)
  Module.HEAPF32 = HEAPF32 = new Float32Array(buf)
  Module.HEAPF64 = HEAPF64 = new Float64Array(buf)
}
