/* eslint-disable no-global-assign */
/* global Module, FS, readBinary, readAsync, read_, calledMain, addRunDependency, removeRunDependency, buffer, assert, updateGlobalBufferAndViews */
Module = Module || {}

Module.preRun = Module.preRun || []

Module.preRun.push(function () {
  Module.FS.createPath('/', 'fonts', true, true)
  Module.FS.createPath('/', 'fontconfig', true, true)

  if (!self.subContent) {
    self.subContent = read_(self.subUrl)
  }

  self.writeAvailableFontsToFS(self.subContent)

  const fallbackFontData = ArrayBuffer.isView(self.fallbackFont) ? self.fallbackFont : readBinary(self.fallbackFont)
  Module.FS.writeFile('/fonts/.fallback', fallbackFontData, { encoding: 'binary' })
})

const textByteLength = (input) => new TextEncoder().encode(input).buffer.byteLength

Module.onRuntimeInitialized = function () {
  self.jassubObj = new Module.JASSUB()

  self.jassubObj.initLibrary(self.width, self.height, '/fonts/.fallback')

  const fontFiles = self.fontFiles || []
  for (let i = 0; i < fontFiles.length; i++) {
    self.asyncWrite(fontFiles[i])
  }

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

self.addFont = function (data) {
  self.asyncWrite(data.font)
}

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

  self.asyncWrite(self.availableFonts[font])
}

self.asyncWrite = function (font) {
  if (ArrayBuffer.isView(font)) {
    Module.FS.writeFile('/fonts/font-' + (self.fontId++), font, { encoding: 'binary' })
    self.jassubObj.reloadFonts()
  } else {
    readAsync(font, fontData => {
      Module.FS.writeFile('/fonts/font-' + (self.fontId++), new Uint8Array(fontData), { encoding: 'binary' })
      self.jassubObj.reloadFonts()
    })
  }
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
  while ((matches = regex.exec(self.subContent)) !== null) {
    self.writeFontToFS(matches[1])
  }
}
/**
 * Set the subtitle track.
 * @param {!string} content the content of the subtitle file.
 */
self.setTrack = function (data) {
  // Make sure that the fonts are loaded
  self.writeAvailableFontsToFS(data.content)

  // Tell libass to render the new track
  self.jassubObj.createTrackMem(self.subContent, textByteLength(self.subContent))
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
self.setTrackByUrl = function (data) {
  const content = read_(data.url)

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

self.paintImages = (data) => {
  data.times.decodeTime = Date.now() - data.decodeStartTime
  if (self.offscreenCanvasCtx) {
    const drawStartTime = Date.now()
    self.offscreenCanvasCtx.clearRect(0, 0, self.offscreenCanvas.width, self.offscreenCanvas.height)
    for (const image of data.images) {
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
      data.times.drawTime = Date.now() - drawStartTime
      let total = 0
      for (const key in data.times) total += data.times[key]
      console.log('Bitmaps: ' + data.images.length + ' Total: ' + Math.round(total) + 'ms', data.times)
    }
  } else {
    postMessage({
      target: 'render',
      async: asyncRender,
      images: data.images,
      times: data.times
    }, data.buffers)
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
  self.width = data.width
  self.height = data.height
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

// patch EMS function to include Uint8Clamped, but call old function too
updateGlobalBufferAndViews = (function (_super) {
  return function (buf) {
    _super(buf)
    HEAPU8C = new Uint8ClampedArray(buf)
  }
})(updateGlobalBufferAndViews)
