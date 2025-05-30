import 'rvfc-polyfill'

const webYCbCrMap = {
  bt709: 'BT709',
  // these might not be exactly correct? oops?
  bt470bg: 'BT601', // alias BT.601 PAL... whats the difference?
  smpte170m: 'BT601'// alias BT.601 NTSC... whats the difference?
}

const colorMatrixConversionMap = {
  BT601: {
    BT709: '1.0863 -0.0723 -0.014 0 0 0.0965 0.8451 0.0584 0 0 -0.0141 -0.0277 1.0418'
  },
  BT709: {
    BT601: '0.9137 0.0784 0.0079 0 0 -0.1049 1.1722 -0.0671 0 0 0.0096 0.0322 0.9582'
  },
  FCC: {
    BT709: '1.0873 -0.0736 -0.0137 0 0 0.0974 0.8494 0.0531 0 0 -0.0127 -0.0251 1.0378',
    BT601: '1.001 -0.0008 -0.0002 0 0 0.0009 1.005 -0.006 0 0 0.0013 0.0027 0.996'
  },
  SMPTE240M: {
    BT709: '0.9993 0.0006 0.0001 0 0 -0.0004 0.9812 0.0192 0 0 -0.0034 -0.0114 1.0148',
    BT601: '0.913 0.0774 0.0096 0 0 -0.1051 1.1508 -0.0456 0 0 0.0063 0.0207 0.973'
  }
}

/**
 * New JASSUB instance.
 * @class
 */
export default class JASSUB extends EventTarget {
  /**
   * @param {Object} options Settings object.
   * @param {HTMLVideoElement} options.video Video to use as target for rendering and event listeners. Optional if canvas is specified instead.
   * @param {HTMLCanvasElement} [options.canvas=HTMLCanvasElement] Canvas to use for manual handling. Not required if video is specified.
   * @param {'js'|'wasm'} [options.blendMode='js'] Which image blending mode to use. WASM will perform better on lower end devices, JS will perform better if the device and browser supports hardware acceleration.
   * @param {Boolean} [options.asyncRender=true] Whether or not to use async rendering, which offloads the CPU by creating image bitmaps on the GPU.
   * @param {Boolean} [options.offscreenRender=true] Whether or not to render things fully on the worker, greatly reduces CPU usage.
   * @param {Boolean} [options.onDemandRender=true] Whether or not to render subtitles as the video player decodes renders, rather than predicting which frame the player is on using events.
   * @param {Number} [options.targetFps=24] Target FPS to render subtitles at. Ignored when onDemandRender is enabled.
   * @param {Number} [options.timeOffset=0] Subtitle time offset in seconds.
   * @param {Boolean} [options.debug=false] Whether or not to print debug information.
   * @param {Number} [options.prescaleFactor=1.0] Scale down (< 1.0) the subtitles canvas to improve performance at the expense of quality, or scale it up (> 1.0).
   * @param {Number} [options.prescaleHeightLimit=1080] The height in pixels beyond which the subtitles canvas won't be prescaled.
   * @param {Number} [options.maxRenderHeight=0] The maximum rendering height in pixels of the subtitles canvas. Beyond this subtitles will be upscaled by the browser.
   * @param {Boolean} [options.dropAllAnimations=false] Attempt to discard all animated tags. Enabling this may severly mangle complex subtitles and should only be considered as an last ditch effort of uncertain success for hardware otherwise incapable of displaing anything. Will not reliably work with manually edited or allocated events.
   * @param {Boolean} [options.dropAllBlur=false] The holy grail of performance gains. If heavy TS lags a lot, disabling this will make it ~x10 faster. This drops blur from all added subtitle tracks making most text and backgrounds look sharper, this is way less intrusive than dropping all animations, while still offering major performance gains.
   * @param {String} [options.workerUrl='jassub-worker.js'] The URL of the worker.
   * @param {String} [options.wasmUrl='jassub-worker.wasm'] The URL of the worker WASM.
   * @param {String} [options.legacyWasmUrl='jassub-worker.wasm.js'] The URL of the worker WASM. Only loaded if the browser doesn't support WASM.
   * @param {String} options.modernWasmUrl The URL of the modern worker WASM. This includes faster ASM instructions, but is only supported by newer browsers, disabled if the URL isn't defined.
   * @param {String} [options.subUrl=options.subContent] The URL of the subtitle file to play.
   * @param {String} [options.subContent=options.subUrl] The content of the subtitle file to play.
   * @param {String[]|Uint8Array[]} [options.fonts] An array of links or Uint8Arrays to the fonts used in the subtitle. If Uint8Array is used the array is copied, not referenced. This forces all the fonts in this array to be loaded by the renderer, regardless of if they are used.
   * @param {Object} [options.availableFonts={'liberation sans': './default.woff2'}] Object with all available fonts - Key is font family in lower case, value is link or Uint8Array: { arial: '/font1.ttf' }. These fonts are selectively loaded if detected as used in the current subtitle track.
   * @param {String} [options.fallbackFont='liberation sans'] The font family key of the fallback font in availableFonts to use if the other font for the style is missing special glyphs or unicode.
   * @param {Boolean} [options.useLocalFonts=false] If the Local Font Access API is enabled [chrome://flags/#font-access], the library will query for permissions to use local fonts and use them if any are missing. The permission can be queried beforehand using navigator.permissions.request({ name: 'local-fonts' }).
   * @param {Number} [options.libassMemoryLimit] libass bitmap cache memory limit in MiB (approximate).
   * @param {Number} [options.libassGlyphLimit] libass glyph cache memory limit in MiB (approximate).
   */
  constructor (options) {
    super()
    if (!globalThis.Worker) throw this.destroy('Worker not supported')
    if (!options) throw this.destroy('No options provided')

    this._loaded = /** @type {Promise<void>} */(new Promise(resolve => {
      this._init = resolve
    }))

    const test = JASSUB._test()
    this._onDemandRender = 'requestVideoFrameCallback' in HTMLVideoElement.prototype && (options.onDemandRender ?? true)

    // don't support offscreen rendering on custom canvases, as we can't replace it if colorSpace doesn't match
    this._offscreenRender = 'transferControlToOffscreen' in HTMLCanvasElement.prototype && !options.canvas && (options.offscreenRender ?? true)

    this.timeOffset = options.timeOffset || 0
    this._video = options.video
    this._videoHeight = 0
    this._videoWidth = 0
    this._videoColorSpace = null
    this._canvas = options.canvas
    if (this._video && !this._canvas) {
      this._canvasParent = document.createElement('div')
      this._canvasParent.className = 'JASSUB'
      this._canvasParent.style.position = 'relative'

      this._canvas = this._createCanvas()

      this._video.insertAdjacentElement('afterend', this._canvasParent)
    } else if (!this._canvas) {
      throw this.destroy('Don\'t know where to render: you should give video or canvas in options.')
    }

    this._bufferCanvas = document.createElement('canvas')
    this._bufferCtx = this._bufferCanvas.getContext('2d')
    if (!this._bufferCtx) throw this.destroy('Canvas rendering not supported')

    this._canvasctrl = this._offscreenRender ? this._canvas.transferControlToOffscreen() : this._canvas
    this._ctx = !this._offscreenRender && this._canvasctrl.getContext('2d')

    this._lastRenderTime = 0
    this.debug = !!options.debug

    this.prescaleFactor = options.prescaleFactor || 1.0
    this.prescaleHeightLimit = options.prescaleHeightLimit || 1080
    this.maxRenderHeight = options.maxRenderHeight || 0 // 0 - no limit.

    this._boundResize = this.resize.bind(this)
    this._boundTimeUpdate = this._timeupdate.bind(this)
    this._boundSetRate = this.setRate.bind(this)
    this._boundUpdateColorSpace = this._updateColorSpace.bind(this)
    if (this._video) this.setVideo(options.video)

    if (this._onDemandRender) {
      this.busy = false
      this._lastDemandTime = null
    }

    this._worker = new Worker(options.workerUrl || 'jassub-worker.js')
    this._worker.onmessage = e => this._onmessage(e)
    this._worker.onerror = e => this._error(e)

    test.then(() => {
      this._worker.postMessage({
        target: 'init',
        wasmUrl: JASSUB._supportsSIMD && options.modernWasmUrl ? options.modernWasmUrl : options.wasmUrl ?? 'jassub-worker.wasm',
        legacyWasmUrl: options.legacyWasmUrl ?? 'jassub-worker.wasm.js',
        asyncRender: typeof createImageBitmap !== 'undefined' && (options.asyncRender ?? true),
        onDemandRender: this._onDemandRender,
        width: this._canvasctrl.width || 0,
        height: this._canvasctrl.height || 0,
        blendMode: options.blendMode || 'js',
        subUrl: options.subUrl,
        subContent: options.subContent || null,
        fonts: options.fonts || [],
        availableFonts: options.availableFonts || { 'liberation sans': './default.woff2' },
        fallbackFont: options.fallbackFont || 'liberation sans',
        debug: this.debug,
        targetFps: options.targetFps || 24,
        dropAllAnimations: options.dropAllAnimations,
        dropAllBlur: options.dropAllBlur,
        libassMemoryLimit: options.libassMemoryLimit || 0,
        libassGlyphLimit: options.libassGlyphLimit || 0,
        // @ts-ignore
        useLocalFonts: typeof queryLocalFonts !== 'undefined' && (options.useLocalFonts ?? true),
        hasBitmapBug: JASSUB._hasBitmapBug
      })
      if (this._offscreenRender === true) this.sendMessage('offscreenCanvas', null, [this._canvasctrl])
    })
  }

  _createCanvas () {
    this._canvas = document.createElement('canvas')
    this._canvas.style.display = 'block'
    this._canvas.style.position = 'absolute'
    this._canvas.style.pointerEvents = 'none'
    this._canvasParent.appendChild(this._canvas)
    return this._canvas
  }

  // test support for WASM, ImageData, alphaBug, but only once, on init so it doesn't run when first running the page

  /** @type {boolean|null} */
  static _supportsSIMD = null
  /** @type {boolean|null} */
  static _hasAlphaBug = null
  /** @type {boolean|null} */
  static _hasBitmapBug = null

  static _testSIMD () {
    if (JASSUB._supportsSIMD !== null) return

    try {
      JASSUB._supportsSIMD = WebAssembly.validate(Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11))
    } catch (e) {
      JASSUB._supportsSIMD = false
    }
  }

  static async _testImageBugs () {
    if (JASSUB._hasBitmapBug !== null) return

    const canvas1 = document.createElement('canvas')
    const ctx1 = canvas1.getContext('2d', { willReadFrequently: true })
    if (!ctx1) throw new Error('Canvas rendering not supported')
    // test ImageData constructor
    if (typeof ImageData.prototype.constructor === 'function') {
      try {
        // try actually calling ImageData, as on some browsers it's reported
        // as existing but calling it errors out as "TypeError: Illegal constructor"
        // eslint-disable-next-line no-new
        new ImageData(new Uint8ClampedArray([0, 0, 0, 0]), 1, 1)
      } catch (e) {
        console.log('Detected that ImageData is not constructable despite browser saying so')

        // @ts-ignore
        self.ImageData = function (data, width, height) {
          const imageData = ctx1.createImageData(width, height)
          if (data) imageData.data.set(data)
          return imageData
        }
      }
    }

    // Test for alpha bug, where e.g. WebKit can render a transparent pixel
    // (with alpha == 0) as non-black which then leads to visual artifacts.
    const canvas2 = document.createElement('canvas')
    const ctx2 = canvas2.getContext('2d', { willReadFrequently: true })
    if (!ctx2) throw new Error('Canvas rendering not supported')

    canvas1.width = canvas2.width = 1
    canvas1.height = canvas2.height = 1
    ctx1.clearRect(0, 0, 1, 1)
    ctx2.clearRect(0, 0, 1, 1)
    const prePut = ctx2.getImageData(0, 0, 1, 1).data
    ctx1.putImageData(new ImageData(new Uint8ClampedArray([0, 255, 0, 0]), 1, 1), 0, 0)
    ctx2.drawImage(canvas1, 0, 0)
    const postPut = ctx2.getImageData(0, 0, 1, 1).data
    JASSUB._hasAlphaBug = prePut[1] !== postPut[1]
    if (JASSUB._hasAlphaBug) console.log('Detected a browser having issue with transparent pixels, applying workaround')

    if (typeof createImageBitmap !== 'undefined') {
      const subarray = new Uint8ClampedArray([255, 0, 255, 0, 255]).subarray(1, 5)
      ctx2.drawImage(await createImageBitmap(new ImageData(subarray, 1)), 0, 0)
      const { data } = ctx2.getImageData(0, 0, 1, 1)
      JASSUB._hasBitmapBug = false
      for (const [i, number] of data.entries()) {
        // realistically at most this will be a diff of 4, but just to be safe
        if (Math.abs(subarray[i] - number) > 15) {
          JASSUB._hasBitmapBug = true
          console.log('Detected a browser having issue with partial bitmaps, applying workaround')
          break
        }
      }
    } else {
      JASSUB._hasBitmapBug = false
    }

    canvas1.remove()
    canvas2.remove()
  }

  static async _test () {
    JASSUB._testSIMD()
    await JASSUB._testImageBugs()
  }

  /**
   * Resize the canvas to given parameters. Auto-generated if values are ommited.
   * @param  {Number} [width=0]
   * @param  {Number} [height=0]
   * @param  {Number} [top=0]
   * @param  {Number} [left=0]
   * @param  {Boolean} [force=false]
   */
  resize (width = 0, height = 0, top = 0, left = 0, force = this._video?.paused) {
    if ((!width || !height) && this._video) {
      const videoSize = this._getVideoPosition()
      let renderSize = null
      // support anamorphic video
      if (this._videoWidth) {
        const widthRatio = this._video.videoWidth / this._videoWidth
        const heightRatio = this._video.videoHeight / this._videoHeight
        renderSize = this._computeCanvasSize((videoSize.width || 0) / widthRatio, (videoSize.height || 0) / heightRatio)
      } else {
        renderSize = this._computeCanvasSize(videoSize.width || 0, videoSize.height || 0)
      }
      width = renderSize.width
      height = renderSize.height
      if (this._canvasParent) {
        top = videoSize.y - (this._canvasParent.getBoundingClientRect().top - this._video.getBoundingClientRect().top)
        left = videoSize.x
      }
      this._canvas.style.width = videoSize.width + 'px'
      this._canvas.style.height = videoSize.height + 'px'
    }

    this._canvas.style.top = top + 'px'
    this._canvas.style.left = left + 'px'
    if (force && this.busy === false) {
      this.busy = true
    } else {
      force = false
    }
    this.sendMessage('canvas', { width, height, videoWidth: this._videoWidth || this._video.videoWidth, videoHeight: this._videoHeight || this._video.videoHeight, force })
  }

  _getVideoPosition (width = this._video.videoWidth, height = this._video.videoHeight) {
    const videoRatio = width / height
    const { offsetWidth, offsetHeight } = this._video
    const elementRatio = offsetWidth / offsetHeight
    width = offsetWidth
    height = offsetHeight
    if (elementRatio > videoRatio) {
      width = Math.floor(offsetHeight * videoRatio)
    } else {
      height = Math.floor(offsetWidth / videoRatio)
    }

    const x = (offsetWidth - width) / 2
    const y = (offsetHeight - height) / 2

    return { width, height, x, y }
  }

  _computeCanvasSize (width = 0, height = 0) {
    const scalefactor = this.prescaleFactor <= 0 ? 1.0 : this.prescaleFactor
    const ratio = self.devicePixelRatio || 1

    if (height <= 0 || width <= 0) {
      width = 0
      height = 0
    } else {
      const sgn = scalefactor < 1 ? -1 : 1
      let newH = height * ratio
      if (sgn * newH * scalefactor <= sgn * this.prescaleHeightLimit) {
        newH *= scalefactor
      } else if (sgn * newH < sgn * this.prescaleHeightLimit) {
        newH = this.prescaleHeightLimit
      }

      if (this.maxRenderHeight > 0 && newH > this.maxRenderHeight) newH = this.maxRenderHeight

      width *= newH / height
      height = newH
    }

    return { width, height }
  }

  _timeupdate ({ type }) {
    const eventmap = {
      seeking: true,
      waiting: true,
      playing: false
    }
    const playing = eventmap[type]
    if (playing != null) this._playstate = playing
    this.setCurrentTime(this._video.paused || this._playstate, this._video.currentTime + this.timeOffset)
  }

  /**
   * Change the video to use as target for event listeners.
   * @param  {HTMLVideoElement} video
   */
  setVideo (video) {
    if (video instanceof HTMLVideoElement) {
      this._removeListeners()
      this._video = video
      if (this._onDemandRender) {
        this._video.requestVideoFrameCallback(this._handleRVFC.bind(this))
      } else {
        this._playstate = video.paused

        video.addEventListener('timeupdate', this._boundTimeUpdate, false)
        video.addEventListener('progress', this._boundTimeUpdate, false)
        video.addEventListener('waiting', this._boundTimeUpdate, false)
        video.addEventListener('seeking', this._boundTimeUpdate, false)
        video.addEventListener('playing', this._boundTimeUpdate, false)
        video.addEventListener('ratechange', this._boundSetRate, false)
        video.addEventListener('resize', this._boundResize, false)
      }
      // everything else is unreliable for this, loadedmetadata and loadeddata included.
      if ('VideoFrame' in window) {
        video.addEventListener('loadedmetadata', this._boundUpdateColorSpace, false)
        if (video.readyState > 2) this._updateColorSpace()
      }
      if (video.videoWidth > 0) this.resize()
      // Support Element Resize Observer
      if (typeof ResizeObserver !== 'undefined') {
        if (!this._ro) this._ro = new ResizeObserver(() => this.resize())
        this._ro.observe(video)
      }
    } else {
      this._error('Video element invalid!')
    }
  }

  runBenchmark () {
    this.sendMessage('runBenchmark')
  }

  /**
   * Overwrites the current subtitle content.
   * @param  {String} url URL to load subtitles from.
   */
  setTrackByUrl (url) {
    this.sendMessage('setTrackByUrl', { url })
    this._reAttachOffscreen()
    if (this._ctx) this._ctx.filter = 'none'
  }

  /**
   * Overwrites the current subtitle content.
   * @param  {String} content Content of the ASS file.
   */
  setTrack (content) {
    this.sendMessage('setTrack', { content })
    this._reAttachOffscreen()
    if (this._ctx) this._ctx.filter = 'none'
  }

  /**
   * Free currently used subtitle track.
   */
  freeTrack () {
    this.sendMessage('freeTrack')
  }

  /**
   * Sets the playback state of the media.
   * @param  {Boolean} isPaused Pause/Play subtitle playback.
   */
  setIsPaused (isPaused) {
    this.sendMessage('video', { isPaused })
  }

  /**
   * Sets the playback rate of the media [speed multiplier].
   * @param  {Number} rate Playback rate.
   */
  setRate (rate) {
    this.sendMessage('video', { rate })
  }

  /**
   * Sets the current time, playback state and rate of the subtitles.
   * @param  {Boolean} [isPaused] Pause/Play subtitle playback.
   * @param  {Number} [currentTime] Time in seconds.
   * @param  {Number} [rate] Playback rate.
   */
  setCurrentTime (isPaused, currentTime, rate) {
    this.sendMessage('video', { isPaused, currentTime, rate, colorSpace: this._videoColorSpace })
  }

  /**
   * @typedef {Object} ASS_Event
   * @property {Number} Start Start Time of the Event, in 0:00:00:00 format ie. Hrs:Mins:Secs:hundredths. This is the time elapsed during script playback at which the text will appear onscreen. Note that there is a single digit for the hours!
   * @property {Number} Duration End Time of the Event, in 0:00:00:00 format ie. Hrs:Mins:Secs:hundredths. This is the time elapsed during script playback at which the text will disappear offscreen. Note that there is a single digit for the hours!
   * @property {String} Style Style name. If it is "Default", then your own *Default style will be subtituted.
   * @property {String} Name Character name. This is the name of the character who speaks the dialogue. It is for information only, to make the script is easier to follow when editing/timing.
   * @property {Number} MarginL 4-figure Left Margin override. The values are in pixels. All zeroes means the default margins defined by the style are used.
   * @property {Number} MarginR 4-figure Right Margin override. The values are in pixels. All zeroes means the default margins defined by the style are used.
   * @property {Number} MarginV 4-figure Bottom Margin override. The values are in pixels. All zeroes means the default margins defined by the style are used.
   * @property {String} Effect Transition Effect. This is either empty, or contains information for one of the three transition effects implemented in SSA v4.x
   * @property {String} Text Subtitle Text. This is the actual text which will be displayed as a subtitle onscreen. Everything after the 9th comma is treated as the subtitle text, so it can include commas.
   * @property {Number} ReadOrder Number in order of which to read this event.
   * @property {Number} Layer Z-index overlap in which to render this event.
   * @property {Number} _index (Internal) index of the event.
  */

  /**
   * Create a new ASS event directly.
   * @param  {ASS_Event} event
   */
  createEvent (event) {
    this.sendMessage('createEvent', { event })
  }

  /**
   * Overwrite the data of the event with the specified index.
   * @param  {ASS_Event} event
   * @param  {Number} index
   */
  setEvent (event, index) {
    this.sendMessage('setEvent', { event, index })
  }

  /**
   * Remove the event with the specified index.
   * @param  {Number} index
   */
  removeEvent (index) {
    this.sendMessage('removeEvent', { index })
  }

  /**
   * Get all ASS events.
   * @param  {function(Error|null, ASS_Event): void} callback Function to callback when worker returns the events.
   */
  getEvents (callback) {
    this._fetchFromWorker({
      target: 'getEvents'
    }, (err, { events }) => {
      callback(err, events)
    })
  }

  /**
   * Set a style override.
   * @param  {ASS_Style} style
   */
  styleOverride(style) {
    this.sendMessage('styleOverride', { style })
  }

  /**
   * Disable style override.
   */
  disableStyleOverride() {
    this.sendMessage('disableStyleOverride')
  }

  /**
   * @typedef {Object} ASS_Style
   * @property {String} Name The name of the Style. Case sensitive. Cannot include commas.
   * @property {String} FontName The fontname as used by Windows. Case-sensitive.
   * @property {Number} FontSize Font size.
   * @property {Number} PrimaryColour A long integer BGR (blue-green-red)  value. ie. the byte order in the hexadecimal equivelent of this number is BBGGRR
   * @property {Number} SecondaryColour A long integer BGR (blue-green-red)  value. ie. the byte order in the hexadecimal equivelent of this number is BBGGRR
   * @property {Number} OutlineColour A long integer BGR (blue-green-red)  value. ie. the byte order in the hexadecimal equivelent of this number is BBGGRR
   * @property {Number} BackColour This is the colour of the subtitle outline or shadow, if these are used. A long integer BGR (blue-green-red)  value. ie. the byte order in the hexadecimal equivelent of this number is BBGGRR.
   * @property {Number} Bold This defines whether text is bold (true) or not (false). -1 is True, 0 is False. This is independant of the Italic attribute - you can have have text which is both bold and italic.
   * @property {Number} Italic  Italic. This defines whether text is italic (true) or not (false). -1 is True, 0 is False. This is independant of the bold attribute - you can have have text which is both bold and italic.
   * @property {Number} Underline -1 or 0
   * @property {Number} StrikeOut -1 or 0
   * @property {Number} ScaleX Modifies the width of the font. [percent]
   * @property {Number} ScaleY Modifies the height of the font. [percent]
   * @property {Number} Spacing Extra space between characters. [pixels]
   * @property {Number} Angle The origin of the rotation is defined by the alignment. Can be a floating point number. [degrees]
   * @property {Number} BorderStyle 1=Outline + drop shadow, 3=Opaque box
   * @property {Number} Outline If BorderStyle is 1,  then this specifies the width of the outline around the text, in pixels. Values may be 0, 1, 2, 3 or 4.
   * @property {Number} Shadow If BorderStyle is 1,  then this specifies the depth of the drop shadow behind the text, in pixels. Values may be 0, 1, 2, 3 or 4. Drop shadow is always used in addition to an outline - SSA will force an outline of 1 pixel if no outline width is given.
   * @property {Number} Alignment This sets how text is "justified" within the Left/Right onscreen margins, and also the vertical placing. Values may be 1=Left, 2=Centered, 3=Right. Add 4 to the value for a "Toptitle". Add 8 to the value for a "Midtitle". eg. 5 = left-justified toptitle
   * @property {Number} MarginL This defines the Left Margin in pixels. It is the distance from the left-hand edge of the screen.The three onscreen margins (MarginL, MarginR, MarginV) define areas in which the subtitle text will be displayed.
   * @property {Number} MarginR This defines the Right Margin in pixels. It is the distance from the right-hand edge of the screen. The three onscreen margins (MarginL, MarginR, MarginV) define areas in which the subtitle text will be displayed.
   * @property {Number} MarginV This defines the vertical Left Margin in pixels. For a subtitle, it is the distance from the bottom of the screen. For a toptitle, it is the distance from the top of the screen. For a midtitle, the value is ignored - the text will be vertically centred.
   * @property {Number} Encoding This specifies the font character set or encoding and on multi-lingual Windows installations it provides access to characters used in multiple than one languages. It is usually 0 (zero) for English (Western, ANSI) Windows.
   * @property {Number} treat_fontname_as_pattern
   * @property {Number} Blur
   * @property {Number} Justify
  */

  /**
   * Create a new ASS style directly.
   * @param  {ASS_Style} style
   */
  createStyle (style) {
    this.sendMessage('createStyle', { style })
  }

  /**
   * Overwrite the data of the style with the specified index.
   * @param  {ASS_Style} style
   * @param  {Number} index
   */
  setStyle (style, index) {
    this.sendMessage('setStyle', { style, index })
  }

  /**
   * Remove the style with the specified index.
   * @param  {Number} index
   */
  removeStyle (index) {
    this.sendMessage('removeStyle', { index })
  }

  /**
   * Get all ASS styles.
   * @param  {function(Error|null, ASS_Style): void} callback Function to callback when worker returns the styles.
   */
  getStyles (callback) {
    this._fetchFromWorker({
      target: 'getStyles'
    }, (err, { styles }) => {
      callback(err, styles)
    })
  }

  /**
   * Adds a font to the renderer.
   * @param  {String|Uint8Array} font Font to add.
   */
  addFont (font) {
    this.sendMessage('addFont', { font })
  }
  /**
   * Changes the font family of the default font, this font needs to be previously added via addFont or fonts array on construction.
   * @param  {String} font Font family to change to.
   */
  setDefaultFont(font) {
    this.sendMessage('defaultFont', { font })
  }

  _sendLocalFont (name) {
    try {
      // @ts-ignore
      queryLocalFonts().then(fontData => {
        const font = fontData?.find(obj => obj.fullName.toLowerCase() === name)
        if (font) {
          font.blob().then(blob => {
            blob.arrayBuffer().then(buffer => {
              this.addFont(new Uint8Array(buffer))
            })
          })
        }
      })
    } catch (e) {
      console.warn('Local fonts API:', e)
    }
  }

  _getLocalFont ({ font }) {
    try {
      // electron by default has all permissions enabled, and it doesn't have perm query
      // if this happens, just send it
      if (navigator?.permissions?.query) {
        // @ts-ignore
        navigator.permissions.query({ name: 'local-fonts' }).then(permission => {
          if (permission.state === 'granted') {
            this._sendLocalFont(font)
          }
        })
      } else {
        this._sendLocalFont(font)
      }
    } catch (e) {
      console.warn('Local fonts API:', e)
    }
  }

  _unbusy () {
    // play catchup, leads to more frames being painted, but also more jitter
    if (this._lastDemandTime) {
      this._demandRender(this._lastDemandTime)
    } else {
      this.busy = false
    }
  }

  _handleRVFC (now, { mediaTime, width, height }) {
    if (this._destroyed) return null
    if (this.busy) {
      this._lastDemandTime = { mediaTime, width, height }
    } else {
      this.busy = true
      this._demandRender({ mediaTime, width, height })
    }
    this._video.requestVideoFrameCallback(this._handleRVFC.bind(this))
  }

  _demandRender ({ mediaTime, width, height }) {
    this._lastDemandTime = null
    if (width !== this._videoWidth || height !== this._videoHeight) {
      this._videoWidth = width
      this._videoHeight = height
      this.resize()
    }
    this.sendMessage('demand', { time: mediaTime + this.timeOffset })
  }

  // if we're using offscreen render, we can't use ctx filters, so we can't use a transfered canvas
  _detachOffscreen () {
    if (!this._offscreenRender || this._ctx) return null
    this._canvas.remove()
    this._createCanvas()
    this._canvasctrl = this._canvas
    this._ctx = this._canvasctrl.getContext('2d')
    this.sendMessage('detachOffscreen')
    // force a render after resize
    this.busy = false
    this.resize(0, 0, 0, 0, true)
  }

  // if the video or track changed, we need to re-attach the offscreen canvas
  _reAttachOffscreen () {
    if (!this._offscreenRender || !this._ctx) return null
    this._canvas.remove()
    this._createCanvas()
    this._canvasctrl = this._canvas.transferControlToOffscreen()
    this._ctx = false
    this.sendMessage('offscreenCanvas', null, [this._canvasctrl])
    this.resize(0, 0, 0, 0, true)
  }

  _updateColorSpace () {
    this._video.requestVideoFrameCallback(() => {
      try {
        // eslint-disable-next-line no-undef
        const frame = new VideoFrame(this._video)
        this._videoColorSpace = webYCbCrMap[frame.colorSpace.matrix]
        frame.close()
        this.sendMessage('getColorSpace')
      } catch (e) {
        // sources can be tainted
        console.warn(e)
      }
    })
  }

  /**
   * Veryify the color spaces for subtitles and videos, then apply filters to correct the color of subtitles.
   * @param  {Object} options
   * @param  {String} options.subtitleColorSpace Subtitle color space. One of: BT601 BT709 SMPTE240M FCC
   * @param  {String=} options.videoColorSpace Video color space. One of: BT601 BT709
   */
  _verifyColorSpace ({ subtitleColorSpace, videoColorSpace = this._videoColorSpace }) {
    if (!subtitleColorSpace || !videoColorSpace) return
    if (subtitleColorSpace === videoColorSpace) return
    this._detachOffscreen()
    this._ctx.filter = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><filter id='f'><feColorMatrix type='matrix' values='${colorMatrixConversionMap[subtitleColorSpace][videoColorSpace]} 0 0 0 0 0 1 0'/></filter></svg>#f")`
  }

  _render ({ images, asyncRender, times, width, height, colorSpace }) {
    this._unbusy()
    if (this.debug) times.IPCTime = Date.now() - times.JSRenderTime
    if (this._canvasctrl.width !== width || this._canvasctrl.height !== height) {
      this._canvasctrl.width = width
      this._canvasctrl.height = height
      this._verifyColorSpace({ subtitleColorSpace: colorSpace })
    }
    this._ctx.clearRect(0, 0, this._canvasctrl.width, this._canvasctrl.height)
    for (const image of images) {
      if (image.image) {
        if (asyncRender) {
          this._ctx.drawImage(image.image, image.x, image.y)
          image.image.close()
        } else {
          this._bufferCanvas.width = image.w
          this._bufferCanvas.height = image.h
          this._bufferCtx.putImageData(new ImageData(this._fixAlpha(new Uint8ClampedArray(image.image)), image.w, image.h), 0, 0)
          this._ctx.drawImage(this._bufferCanvas, image.x, image.y)
        }
      }
    }
    if (this.debug) {
      times.JSRenderTime = Date.now() - times.JSRenderTime - times.IPCTime
      let total = 0
      const count = times.bitmaps || images.length
      delete times.bitmaps
      for (const key in times) total += times[key]
      console.log('Bitmaps: ' + count + ' Total: ' + (total | 0) + 'ms', times)
    }
  }

  _fixAlpha (uint8) {
    if (JASSUB._hasAlphaBug) {
      for (let j = 3; j < uint8.length; j += 4) {
        uint8[j] = uint8[j] > 1 ? uint8[j] : 1
      }
    }
    return uint8
  }

  _ready () {
    this._init()
    this.dispatchEvent(new CustomEvent('ready'))
  }

  /**
   * Send data and execute function in the worker.
   * @param  {String} target Target function.
   * @param  {Object} [data] Data for function.
   * @param  {Transferable[]} [transferable] Array of transferables.
   */
  async sendMessage (target, data = {}, transferable) {
    await this._loaded
    if (transferable) {
      this._worker.postMessage({
        target,
        transferable,
        ...data
      }, [...transferable])
    } else {
      this._worker.postMessage({
        target,
        ...data
      })
    }
  }

  _fetchFromWorker (workerOptions, callback) {
    try {
      const target = workerOptions.target

      const timeout = setTimeout(() => {
        reject(new Error('Error: Timeout while try to fetch ' + target))
      }, 5000)

      const resolve = ({ data }) => {
        if (data.target === target) {
          callback(null, data)
          this._worker.removeEventListener('message', resolve)
          this._worker.removeEventListener('error', reject)
          clearTimeout(timeout)
        }
      }

      const reject = event => {
        callback(event)
        this._worker.removeEventListener('message', resolve)
        this._worker.removeEventListener('error', reject)
        clearTimeout(timeout)
      }

      this._worker.addEventListener('message', resolve)
      this._worker.addEventListener('error', reject)

      this._worker.postMessage(workerOptions)
    } catch (error) {
      this._error(error)
    }
  }

  _console ({ content, command }) {
    console[command].apply(console, JSON.parse(content))
  }

  _onmessage ({ data }) {
    if (this['_' + data.target]) this['_' + data.target](data)
  }

  _error (err) {
    const error = err instanceof Error
      ? err // pass
      : err instanceof ErrorEvent
        ? err.error // ErrorEvent has error property which is an Error object
        : new Error(err) // construct Error

    const event = err instanceof Event
      ? new ErrorEvent(err.type, err) // clone event
      : new ErrorEvent('error', { error }) // construct Event

    this.dispatchEvent(event)

    console.error(error)

    return error
  }

  _removeListeners () {
    if (this._video) {
      if (this._ro) this._ro.unobserve(this._video)
      if (this._ctx) this._ctx.filter = 'none'
      this._video.removeEventListener('timeupdate', this._boundTimeUpdate)
      this._video.removeEventListener('progress', this._boundTimeUpdate)
      this._video.removeEventListener('waiting', this._boundTimeUpdate)
      this._video.removeEventListener('seeking', this._boundTimeUpdate)
      this._video.removeEventListener('playing', this._boundTimeUpdate)
      this._video.removeEventListener('ratechange', this._boundSetRate)
      this._video.removeEventListener('resize', this._boundResize)
      this._video.removeEventListener('loadedmetadata', this._boundUpdateColorSpace)
    }
  }

  /**
   * Destroy the object, worker, listeners and all data.
   * @param  {String|Error} [err] Error to throw when destroying.
   */
  destroy (err) {
    if (err) err = this._error(err)
    if (this._video && this._canvasParent) this._video.parentNode?.removeChild(this._canvasParent)
    this._destroyed = true
    this._removeListeners()
    this.sendMessage('destroy')
    this._worker?.terminate()
    return err
  }
}
