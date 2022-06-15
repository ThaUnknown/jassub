/* global Module */
/* eslint-env browser, worker */
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
