var u = Object.defineProperty;
var f = (d, e, t) => e in d ? u(d, e, { enumerable: !0, configurable: !0, writable: !0, value: t }) : d[e] = t;
var v = (d, e, t) => (f(d, typeof e != "symbol" ? e + "" : e, t), t);
!("requestVideoFrameCallback" in HTMLVideoElement.prototype) && "getVideoPlaybackQuality" in HTMLVideoElement.prototype && (HTMLVideoElement.prototype._rvfcpolyfillmap = {}, HTMLVideoElement.prototype.requestVideoFrameCallback = function(d) {
  const e = this.getVideoPlaybackQuality(), t = this.mozPresentedFrames || this.mozPaintedFrames || e.totalVideoFrames - e.droppedVideoFrames, s = (r, i) => {
    const o = this.getVideoPlaybackQuality(), c = this.mozPresentedFrames || this.mozPaintedFrames || o.totalVideoFrames - o.droppedVideoFrames;
    if (c > t) {
      const l = this.mozFrameDelay || o.totalFrameDelay - e.totalFrameDelay || 0, m = i - r;
      d(i, {
        presentationTime: i + l * 1e3,
        expectedDisplayTime: i + m,
        width: this.videoWidth,
        height: this.videoHeight,
        mediaTime: Math.max(0, this.currentTime || 0) + m / 1e3,
        presentedFrames: c,
        processingDuration: l
      }), delete this._rvfcpolyfillmap[a];
    } else
      this._rvfcpolyfillmap[a] = requestAnimationFrame((l) => s(i, l));
  }, a = Date.now(), n = performance.now();
  return this._rvfcpolyfillmap[a] = requestAnimationFrame((r) => s(n, r)), a;
}, HTMLVideoElement.prototype.cancelVideoFrameCallback = function(d) {
  cancelAnimationFrame(this._rvfcpolyfillmap[d]), delete this._rvfcpolyfillmap[d];
});
const h = class extends EventTarget {
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
   * @param {String} [options.workerUrl='jassub-worker.js'] The URL of the worker.
   * @param {String} [options.legacyWorkerUrl='jassub-worker-legacy.js'] The URL of the legacy worker. Only loaded if the browser doesn't support WASM.
   * @param {String} [options.subUrl=options.subContent] The URL of the subtitle file to play.
   * @param {String} [options.subContent=options.subUrl] The content of the subtitle file to play.
   * @param {String[]|Uint8Array[]} [options.fonts] An array of links or Uint8Arrays to the fonts used in the subtitle. If Uint8Array is used the array is copied, not referenced. This forces all the fonts in this array to be loaded by the renderer, regardless of if they are used.
   * @param {Object} [options.availableFonts={'liberation sans': './default.woff2'}] Object with all available fonts - Key is font family in lower case, value is link or Uint8Array: { arial: '/font1.ttf' }. These fonts are selectively loaded if detected as used in the current subtitle track.
   * @param {String} [options.fallbackFont='liberation sans'] The font family key of the fallback font in availableFonts to use if the other font for the style is missing special glyphs or unicode.
   * @param {Boolean} [options.useLocalFonts=false] If the Local Font Access API is enabled [chrome://flags/#font-access], the library will query for permissions to use local fonts and use them if any are missing. The permission can be queried beforehand using navigator.permissions.request({ name: 'local-fonts' }).
   * @param {Number} [options.libassMemoryLimit] libass bitmap cache memory limit in MiB (approximate).
   * @param {Number} [options.libassGlyphLimit] libass glyph cache memory limit in MiB (approximate).
   */
  constructor(e = {}) {
    super(), globalThis.Worker || this.destroy("Worker not supported"), h._test();
    const t = e.blendMode || "js", s = typeof createImageBitmap < "u" && (e.asyncRender ?? !0), a = typeof OffscreenCanvas < "u" && (e.offscreenRender ?? !0);
    this._onDemandRender = "requestVideoFrameCallback" in HTMLVideoElement.prototype && (e.onDemandRender ?? !0), this.timeOffset = e.timeOffset || 0, this._video = e.video, this._videoHeight = 0, this._videoWidth = 0, this._canvas = e.canvas, this._video && !this._canvas ? (this._canvasParent = document.createElement("div"), this._canvasParent.className = "JASSUB", this._canvasParent.style.position = "relative", this._canvas = document.createElement("canvas"), this._canvas.style.display = "block", this._canvas.style.position = "absolute", this._canvas.style.pointerEvents = "none", this._canvasParent.appendChild(this._canvas), this._video.nextSibling ? this._video.parentNode.insertBefore(this._canvasParent, this._video.nextSibling) : this._video.parentNode.appendChild(this._canvasParent)) : this._canvas || this.destroy("Don't know where to render: you should give video or canvas in options."), this._bufferCanvas = document.createElement("canvas"), this._bufferCtx = this._bufferCanvas.getContext("2d", { desynchronized: !0, willReadFrequently: !0 }), this._canvasctrl = a ? this._canvas.transferControlToOffscreen() : this._canvas, this._ctx = !a && this._canvasctrl.getContext("2d", { desynchronized: !0 }), this._lastRenderTime = 0, this.debug = !!e.debug, this.prescaleFactor = e.prescaleFactor || 1, this.prescaleHeightLimit = e.prescaleHeightLimit || 1080, this.maxRenderHeight = e.maxRenderHeight || 0, this._worker = new Worker(h._supportsWebAssembly ? e.workerUrl || "jassub-worker.js" : e.legacyWorkerUrl || "jassub-worker-legacy.js"), this._worker.onmessage = (n) => this._onmessage(n), this._worker.onerror = (n) => this._error(n), this._loaded = new Promise((n) => {
      this._init = () => {
        var r;
        this._destroyed || (this._worker.postMessage({
          target: "init",
          asyncRender: s,
          onDemandRender: this._onDemandRender,
          width: this._canvasctrl.width,
          height: this._canvasctrl.height,
          preMain: !0,
          blendMode: t,
          subUrl: e.subUrl,
          subContent: e.subContent || null,
          fonts: e.fonts || [],
          availableFonts: e.availableFonts || { "liberation sans": "./default.woff2" },
          fallbackFont: e.fallbackFont || "liberation sans",
          debug: this.debug,
          targetFps: e.targetFps || 24,
          dropAllAnimations: e.dropAllAnimations,
          libassMemoryLimit: e.libassMemoryLimit || 0,
          libassGlyphLimit: e.libassGlyphLimit || 0,
          hasAlphaBug: h._hasAlphaBug,
          useLocalFonts: "queryLocalFonts" in self && (e.useLocalFonts ?? !0)
        }), a === !0 && this.sendMessage("offscreenCanvas", null, [this._canvasctrl]), this._boundResize = this.resize.bind(this), this._boundTimeUpdate = this._timeupdate.bind(this), this._boundSetRate = this.setRate.bind(this), this._video && this.setVideo(e.video), this._onDemandRender && (this.busy = !1, this._lastDemandTime = null, (r = this._video) == null || r.requestVideoFrameCallback(this._handleRVFC.bind(this))), n());
      };
    });
  }
  static _test() {
    if (h._supportsWebAssembly !== null)
      return null;
    const e = document.createElement("canvas"), t = e.getContext("2d", { willReadFrequently: !0 });
    if (typeof ImageData.prototype.constructor == "function")
      try {
        new ImageData(new Uint8ClampedArray([0, 0, 0, 0]), 1, 1);
      } catch {
        console.log("Detected that ImageData is not constructable despite browser saying so"), self.ImageData = function(o, c, l) {
          const m = t.createImageData(c, l);
          return o && m.data.set(o), m;
        };
      }
    try {
      if (typeof WebAssembly == "object" && typeof WebAssembly.instantiate == "function") {
        const i = new WebAssembly.Module(Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0));
        i instanceof WebAssembly.Module && (h._supportsWebAssembly = new WebAssembly.Instance(i) instanceof WebAssembly.Instance);
      }
    } catch {
      h._supportsWebAssembly = !1;
    }
    const s = document.createElement("canvas"), a = s.getContext("2d", { willReadFrequently: !0 });
    e.width = s.width = 1, e.height = s.height = 1, t.clearRect(0, 0, 1, 1), a.clearRect(0, 0, 1, 1);
    const n = a.getImageData(0, 0, 1, 1).data;
    t.putImageData(new ImageData(new Uint8ClampedArray([0, 255, 0, 0]), 1, 1), 0, 0), a.drawImage(e, 0, 0);
    const r = a.getImageData(0, 0, 1, 1).data;
    h._hasAlphaBug = n[1] !== r[1], h._hasAlphaBug && console.log("Detected a browser having issue with transparent pixels, applying workaround"), e.remove(), s.remove();
  }
  /**
   * Resize the canvas to given parameters. Auto-generated if values are ommited.
   * @param  {Number} [width=0]
   * @param  {Number} [height=0]
   * @param  {Number} [top=0]
   * @param  {Number} [left=0]
   * @param  {Boolean} [force=false]
   */
  resize(e = 0, t = 0, s = 0, a = 0, n = ((r) => (r = this._video) == null ? void 0 : r.paused)()) {
    if ((!e || !t) && this._video) {
      const i = this._getVideoPosition();
      let o = null;
      if (this._videoWidth) {
        const c = this._video.videoWidth / this._videoWidth, l = this._video.videoHeight / this._videoHeight;
        o = this._computeCanvasSize((i.width || 0) / c, (i.height || 0) / l);
      } else
        o = this._computeCanvasSize(i.width || 0, i.height || 0);
      e = o.width, t = o.height, this._canvasParent && (s = i.y - (this._canvasParent.getBoundingClientRect().top - this._video.getBoundingClientRect().top), a = i.x), this._canvas.style.width = i.width + "px", this._canvas.style.height = i.height + "px";
    }
    this._canvas.style.top = s + "px", this._canvas.style.left = a + "px", this.sendMessage("canvas", { width: e, height: t, force: n && this.busy === !1 });
  }
  _getVideoPosition(e = this._video.videoWidth, t = this._video.videoHeight) {
    const s = e / t, { offsetWidth: a, offsetHeight: n } = this._video, r = a / n;
    e = a, t = n, r > s ? e = Math.floor(n * s) : t = Math.floor(a / s);
    const i = (a - e) / 2, o = (n - t) / 2;
    return { width: e, height: t, x: i, y: o };
  }
  _computeCanvasSize(e = 0, t = 0) {
    const s = this.prescaleFactor <= 0 ? 1 : this.prescaleFactor, a = self.devicePixelRatio || 1;
    if (e = e * a, t = t * a, t <= 0 || e <= 0)
      e = 0, t = 0;
    else {
      const n = s < 1 ? -1 : 1;
      let r = t * a;
      n * r * s <= n * this.prescaleHeightLimit ? r *= s : n * r < n * this.prescaleHeightLimit && (r = this.prescaleHeightLimit), this.maxRenderHeight > 0 && r > this.maxRenderHeight && (r = this.maxRenderHeight), e *= r / t, t = r;
    }
    return { width: e, height: t };
  }
  _timeupdate({ type: e }) {
    const s = {
      seeking: !0,
      waiting: !0,
      playing: !1
    }[e];
    s != null && (this._playstate = s), this.setCurrentTime(this._video.paused || this._playstate, this._video.currentTime + this.timeOffset);
  }
  /**
   * Change the video to use as target for event listeners.
   * @param  {HTMLVideoElement} video
   */
  setVideo(e) {
    e instanceof HTMLVideoElement ? (this._removeListeners(), this._video = e, this._onDemandRender ? this._video.requestVideoFrameCallback(this._handleRVFC.bind(this)) : (this._playstate = e.paused, e.addEventListener("timeupdate", this._boundTimeUpdate, !1), e.addEventListener("progress", this._boundTimeUpdate, !1), e.addEventListener("waiting", this._boundTimeUpdate, !1), e.addEventListener("seeking", this._boundTimeUpdate, !1), e.addEventListener("playing", this._boundTimeUpdate, !1), e.addEventListener("ratechange", this._boundSetRate, !1), e.addEventListener("resize", this._boundResize)), e.videoWidth > 0 && this.resize(), typeof ResizeObserver < "u" && (this._ro || (this._ro = new ResizeObserver(() => this.resize())), this._ro.observe(e))) : this._error("Video element invalid!");
  }
  runBenchmark() {
    this.sendMessage("runBenchmark");
  }
  /**
   * Overwrites the current subtitle content.
   * @param  {String} url URL to load subtitles from.
   */
  setTrackByUrl(e) {
    this.sendMessage("setTrackByUrl", { url: e });
  }
  /**
   * Overwrites the current subtitle content.
   * @param  {String} content Content of the ASS file.
   */
  setTrack(e) {
    this.sendMessage("setTrack", { content: e });
  }
  /**
   * Free currently used subtitle track.
   */
  freeTrack() {
    this.sendMessage("freeTrack");
  }
  /**
   * Sets the playback state of the media.
   * @param  {Boolean} isPaused Pause/Play subtitle playback.
   */
  setIsPaused(e) {
    this.sendMessage("video", { isPaused: e });
  }
  /**
   * Sets the playback rate of the media [speed multiplier].
   * @param  {Number} rate Playback rate.
   */
  setRate(e) {
    this.sendMessage("video", { rate: e });
  }
  /**
   * Sets the current time, playback state and rate of the subtitles.
   * @param  {Boolean} [isPaused] Pause/Play subtitle playback.
   * @param  {Number} [currentTime] Time in seconds.
   * @param  {Number} [rate] Playback rate.
   */
  setCurrentTime(e, t, s) {
    this.sendMessage("video", { isPaused: e, currentTime: t, rate: s });
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
  createEvent(e) {
    this.sendMessage("createEvent", { event: e });
  }
  /**
   * Overwrite the data of the event with the specified index.
   * @param  {ASS_Event} event
   * @param  {Number} index
   */
  setEvent(e, t) {
    this.sendMessage("setEvent", { event: e, index: t });
  }
  /**
   * Remove the event with the specified index.
   * @param  {Number} index
   */
  removeEvent(e) {
    this.sendMessage("removeEvent", { index: e });
  }
  /**
   * Get all ASS events.
   * @param  {function(Error|null, ASS_Event)} callback Function to callback when worker returns the events.
   */
  getEvents(e) {
    this._fetchFromWorker({
      target: "getEvents"
    }, (t, { events: s }) => {
      e(t, s);
    });
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
   * @param  {ASS_Style} event
   */
  createStyle(e) {
    this.sendMessage("createStyle", { style: e });
  }
  /**
   * Overwrite the data of the style with the specified index.
   * @param  {ASS_Style} event
   * @param  {Number} index
   */
  setStyle(e, t) {
    this.sendMessage("setStyle", { event: e, index: t });
  }
  /**
   * Remove the style with the specified index.
   * @param  {Number} index
   */
  removeStyle(e) {
    this.sendMessage("removeStyle", { index: e });
  }
  /**
   * Get all ASS styles.
   * @param  {function(Error|null, ASS_Style)} callback Function to callback when worker returns the styles.
   */
  getStyles(e) {
    this._fetchFromWorker({
      target: "getStyles"
    }, (t, { styles: s }) => {
      e(t, s);
    });
  }
  /**
   * Adds a font to the renderer.
   * @param  {String|Uint8Array} font Font to add.
   */
  addFont(e) {
    this.sendMessage("addFont", { font: e });
  }
  _sendLocalFont(e) {
    try {
      queryLocalFonts().then((t) => {
        const s = t == null ? void 0 : t.find((a) => a.fullName.toLowerCase() === e);
        s && s.blob().then((a) => {
          a.arrayBuffer().then((n) => {
            this.addFont(new Uint8Array(n));
          });
        });
      });
    } catch (t) {
      console.warn("Local fonts API:", t);
    }
  }
  _getLocalFont({ font: e }) {
    var t;
    try {
      (t = navigator == null ? void 0 : navigator.permissions) != null && t.query ? navigator.permissions.query({ name: "local-fonts" }).then((s) => {
        s.state === "granted" && this._sendLocalFont(e);
      }) : this._sendLocalFont(e);
    } catch (s) {
      console.warn("Local fonts API:", s);
    }
  }
  _unbusy() {
    this._lastDemandTime ? this._demandRender(this._lastDemandTime) : this.busy = !1;
  }
  _handleRVFC(e, { mediaTime: t, width: s, height: a }) {
    if (this._destroyed)
      return null;
    this.busy ? this._lastDemandTime = { mediaTime: t, width: s, height: a } : (this.busy = !0, this._demandRender({ mediaTime: t, width: s, height: a })), this._video.requestVideoFrameCallback(this._handleRVFC.bind(this));
  }
  _demandRender({ mediaTime: e, width: t, height: s }) {
    this._lastDemandTime = null, (t !== this._videoWidth || s !== this._videoHeight) && (this._videoWidth = t, this._videoHeight = s, this.resize()), this.sendMessage("demand", { time: e + this.timeOffset });
  }
  _render({ images: e, async: t, times: s, width: a, height: n }) {
    this._unbusy();
    const r = Date.now();
    (this._canvasctrl.width !== a || this._canvasctrl.height !== n) && (this._canvasctrl.width = a, this._canvasctrl.height = n), this._ctx.clearRect(0, 0, this._canvasctrl.width, this._canvasctrl.height);
    for (const i of e)
      i.image && (t ? (this._ctx.drawImage(i.image, i.x, i.y), i.image.close()) : (this._bufferCanvas.width = i.w, this._bufferCanvas.height = i.h, this._bufferCtx.putImageData(new ImageData(this._fixAlpha(new Uint8ClampedArray(i.image)), i.w, i.h), 0, 0), this._ctx.drawImage(this._bufferCanvas, i.x, i.y)));
    if (this.debug) {
      s.drawTime = Date.now() - r;
      let i = 0;
      for (const o in s)
        i += s[o];
      console.log("Bitmaps: " + e.length + " Total: " + Math.round(i) + "ms", s);
    }
  }
  _fixAlpha(e) {
    if (h._hasAlphaBug)
      for (let t = 3; t < e.length; t += 4)
        e[t] = e[t] > 1 ? e[t] : 1;
    return e;
  }
  _ready() {
    this._init(), this.dispatchEvent(new CustomEvent("ready"));
  }
  /**
   * Send data and execute function in the worker.
   * @param  {String} target Target function.
   * @param  {Object} [data] Data for function.
   * @param  {Transferable[]} [transferable] Array of transferables.
   */
  async sendMessage(e, t = {}, s) {
    await this._loaded, s ? this._worker.postMessage({
      target: e,
      transferable: s,
      ...t
    }, [...s]) : this._worker.postMessage({
      target: e,
      ...t
    });
  }
  _fetchFromWorker(e, t) {
    try {
      const s = e.target, a = setTimeout(() => {
        r(new Error("Error: Timeout while try to fetch " + s));
      }, 5e3), n = ({ data: i }) => {
        i.target === s && (t(null, i), this._worker.removeEventListener("message", n), this._worker.removeEventListener("error", r), clearTimeout(a));
      }, r = (i) => {
        t(i), this._worker.removeEventListener("message", n), this._worker.removeEventListener("error", r), clearTimeout(a);
      };
      this._worker.addEventListener("message", n), this._worker.addEventListener("error", r), this._worker.postMessage(e);
    } catch (s) {
      this._error(s);
    }
  }
  _console({ content: e, command: t }) {
    console[t].apply(console, JSON.parse(e));
  }
  _onmessage({ data: e }) {
    this["_" + e.target] && this["_" + e.target](e);
  }
  _error(e) {
    const t = e instanceof Error ? e : e instanceof ErrorEvent ? e.error : new Error(e), s = e instanceof Event ? new ErrorEvent(e.type, e) : new ErrorEvent("error", { error: t });
    this.dispatchEvent(s), console.error(t);
  }
  _removeListeners() {
    this._video && (this._ro && this._ro.unobserve(this._video), this._video.removeEventListener("timeupdate", this._boundTimeUpdate), this._video.removeEventListener("progress", this._boundTimeUpdate), this._video.removeEventListener("waiting", this._boundTimeUpdate), this._video.removeEventListener("seeking", this._boundTimeUpdate), this._video.removeEventListener("playing", this._boundTimeUpdate), this._video.removeEventListener("ratechange", this._boundSetRate), this._video.removeEventListener("resize", this._boundResize));
  }
  /**
   * Destroy the object, worker, listeners and all data.
   * @param  {String} [err] Error to throw when destroying.
   */
  destroy(e) {
    e && this._error(e), this._video && this._canvasParent && this._video.parentNode.removeChild(this._canvasParent), this._destroyed = !0, this._removeListeners(), this.sendMessage("destroy"), this._worker.terminate();
  }
};
let _ = h;
// test support for WASM, ImageData, alphaBug, but only once, on init so it doesn't run when first running the page
v(_, "_supportsWebAssembly", null), v(_, "_hasAlphaBug", null);
export {
  _ as default
};
