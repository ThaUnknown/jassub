var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
if (!("requestVideoFrameCallback" in HTMLVideoElement.prototype) && "getVideoPlaybackQuality" in HTMLVideoElement.prototype) {
  HTMLVideoElement.prototype._rvfcpolyfillmap = {};
  HTMLVideoElement.prototype.requestVideoFrameCallback = function(callback) {
    const quality = this.getVideoPlaybackQuality();
    const baseline = this.mozPresentedFrames || this.mozPaintedFrames || quality.totalVideoFrames - quality.droppedVideoFrames;
    const check = (old, now2) => {
      const newquality = this.getVideoPlaybackQuality();
      const presentedFrames = this.mozPresentedFrames || this.mozPaintedFrames || newquality.totalVideoFrames - newquality.droppedVideoFrames;
      if (presentedFrames > baseline) {
        const processingDuration = this.mozFrameDelay || newquality.totalFrameDelay - quality.totalFrameDelay || 0;
        const timediff = now2 - old;
        callback(now2, {
          presentationTime: now2 + processingDuration * 1e3,
          expectedDisplayTime: now2 + timediff,
          width: this.videoWidth,
          height: this.videoHeight,
          mediaTime: Math.max(0, this.currentTime || 0) + timediff / 1e3,
          presentedFrames,
          processingDuration
        });
        delete this._rvfcpolyfillmap[handle];
      } else {
        this._rvfcpolyfillmap[handle] = requestAnimationFrame((newer) => check(now2, newer));
      }
    };
    const handle = Date.now();
    const now = performance.now();
    this._rvfcpolyfillmap[handle] = requestAnimationFrame((newer) => check(now, newer));
    return handle;
  };
  HTMLVideoElement.prototype.cancelVideoFrameCallback = function(handle) {
    cancelAnimationFrame(this._rvfcpolyfillmap[handle]);
    delete this._rvfcpolyfillmap[handle];
  };
}
const _JASSUB = class extends EventTarget {
  constructor(options = {}) {
    var _a, _b, _c, _d;
    super();
    if (!globalThis.Worker) {
      this.destroy("Worker not supported");
    }
    _JASSUB._test();
    const blendMode = options.blendMode || "js";
    const asyncRender = typeof createImageBitmap !== "undefined" && ((_a = options.asyncRender) != null ? _a : true);
    const offscreenRender = typeof OffscreenCanvas !== "undefined" && ((_b = options.offscreenRender) != null ? _b : true);
    this._onDemandRender = "requestVideoFrameCallback" in HTMLVideoElement.prototype && options.video && ((_c = options.onDemandRender) != null ? _c : true);
    this.timeOffset = options.timeOffset || 0;
    this._video = options.video;
    this._canvasParent = null;
    if (this._video) {
      this._canvasParent = document.createElement("div");
      this._canvasParent.className = "JASSUB";
      this._canvasParent.style.position = "relative";
      if (this._video.nextSibling) {
        this._video.parentNode.insertBefore(this._canvasParent, this._video.nextSibling);
      } else {
        this._video.parentNode.appendChild(this._canvasParent);
      }
    } else if (!this._canvas) {
      this.destroy("Don't know where to render: you should give video or canvas in options.");
    }
    this._canvas = options.canvas || document.createElement("canvas");
    this._canvas.style.display = "block";
    this._canvas.style.position = "absolute";
    this._canvas.style.pointerEvents = "none";
    this._canvasParent.appendChild(this._canvas);
    this._bufferCanvas = document.createElement("canvas");
    this._bufferCtx = this._bufferCanvas.getContext("2d");
    this._canvasctrl = offscreenRender ? this._canvas.transferControlToOffscreen() : this._canvas;
    this._ctx = !offscreenRender && this._canvasctrl.getContext("2d");
    this._lastRenderTime = 0;
    this.debug = !!options.debug;
    this.prescaleFactor = options.prescaleFactor || 1;
    this.prescaleHeightLimit = options.prescaleHeightLimit || 1080;
    this.maxRenderHeight = options.maxRenderHeight || 0;
    this._worker = new Worker(_JASSUB._supportsWebAssembly ? options.workerUrl || "jassub-worker.js" : options.legacyWorkerUrl || "jassub-worker-legacy.js");
    this._worker.onmessage = (e) => this._onmessage(e);
    this._worker.onerror = (e) => this._error(e);
    this._worker.postMessage({
      target: "init",
      asyncRender,
      width: this._canvas.width,
      height: this._canvas.height,
      preMain: true,
      blendMode,
      subUrl: options.subUrl,
      subContent: options.subContent || null,
      fonts: options.fonts || [],
      availableFonts: options.availableFonts || { "liberation sans": "./default.woff2" },
      fallbackFont: options.fallbackFont || "liberation sans",
      debug: this.debug,
      targetFps: options.targetFps || 24,
      dropAllAnimations: options.dropAllAnimations,
      libassMemoryLimit: options.libassMemoryLimit || 0,
      libassGlyphLimit: options.libassGlyphLimit || 0,
      hasAlphaBug: _JASSUB._hasAlphaBug,
      useLocalFonts: "queryLocalFonts" in self && ((_d = options.useLocalFonts) != null ? _d : true)
    });
    if (offscreenRender === true)
      this.sendMessage("offscreenCanvas", null, [this._canvasctrl]);
    this._boundResize = this.resize.bind(this);
    this._boundTimeUpdate = this._timeupdate.bind(this);
    this._boundSetRate = this.setRate.bind(this);
    this.setVideo(options.video);
    if (this._onDemandRender) {
      this.busy = false;
      this._video.requestVideoFrameCallback(this._demandRender.bind(this));
    }
  }
  static _test() {
    if (_JASSUB._supportsWebAssembly !== null)
      return null;
    const canvas1 = document.createElement("canvas");
    const ctx1 = canvas1.getContext("2d", { willReadFrequently: true });
    if (typeof ImageData.prototype.constructor === "function") {
      try {
        new ImageData(new Uint8ClampedArray([0, 0, 0, 0]), 1, 1);
      } catch (e) {
        console.log("detected that ImageData is not constructable despite browser saying so");
        window.ImageData = function(data, width, height) {
          const imageData = ctx1.createImageData(width, height);
          if (data)
            imageData.data.set(data);
          return imageData;
        };
      }
    }
    try {
      if (typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function") {
        const module = new WebAssembly.Module(Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0));
        if (module instanceof WebAssembly.Module) {
          _JASSUB._supportsWebAssembly = new WebAssembly.Instance(module) instanceof WebAssembly.Instance;
        }
      }
    } catch (e) {
      _JASSUB._supportsWebAssembly = false;
    }
    const canvas2 = document.createElement("canvas");
    const ctx2 = canvas2.getContext("2d");
    canvas1.width = canvas2.width = 1;
    canvas1.height = canvas2.height = 1;
    ctx1.clearRect(0, 0, 1, 1);
    ctx2.clearRect(0, 0, 1, 1);
    const prePut = ctx2.getImageData(0, 0, 1, 1).data;
    ctx1.putImageData(new ImageData(new Uint8ClampedArray([0, 255, 0, 0]), 1, 1), 0, 0);
    ctx2.drawImage(canvas1, 0, 0);
    const postPut = ctx2.getImageData(0, 0, 1, 1).data;
    _JASSUB._hasAlphaBug = prePut[1] !== postPut[1];
    if (_JASSUB._hasAlphaBug)
      console.log("Detected a browser having issue with transparent pixels, applying workaround");
    canvas2.remove();
  }
  resize(width = 0, height = 0, top = 0, left = 0) {
    let videoSize = null;
    if ((!width || !height) && this._video) {
      videoSize = this._getVideoPosition();
      const newsize = this._computeCanvasSize((videoSize.width || 0) * (window.devicePixelRatio || 1), (videoSize.height || 0) * (window.devicePixelRatio || 1));
      width = newsize.width;
      height = newsize.height;
      top = videoSize.y - (this._canvasParent.getBoundingClientRect().top - this._video.getBoundingClientRect().top);
      left = videoSize.x;
    }
    if (videoSize != null) {
      this._canvas.style.top = top + "px";
      this._canvas.style.left = left + "px";
      this._canvas.style.width = videoSize.width + "px";
      this._canvas.style.height = videoSize.height + "px";
    }
    if (!(this._canvasctrl.width === width && this._canvasctrl.height === height)) {
      if (this._resizeTimeoutBuffer) {
        clearTimeout(this._resizeTimeoutBuffer);
        this._resizeTimeoutBuffer = setTimeout(() => {
          this._resizeTimeoutBuffer = void 0;
          this._canvasctrl.width = width;
          this._canvasctrl.height = height;
          this.sendMessage("canvas", { width, height });
        }, 100);
      } else {
        this._canvasctrl.width = width;
        this._canvasctrl.height = height;
        this.sendMessage("canvas", { width, height });
        this._resizeTimeoutBuffer = setTimeout(() => {
          this._resizeTimeoutBuffer = void 0;
        }, 100);
      }
    }
  }
  _getVideoPosition() {
    const videoRatio = this._video.videoWidth / this._video.videoHeight;
    const { offsetWidth, offsetHeight } = this._video;
    const elementRatio = offsetWidth / offsetHeight;
    let width = offsetWidth;
    let height = offsetHeight;
    if (elementRatio > videoRatio) {
      width = Math.floor(offsetHeight * videoRatio);
    } else {
      height = Math.floor(offsetWidth / videoRatio);
    }
    const x = (offsetWidth - width) / 2;
    const y = (offsetHeight - height) / 2;
    return { width, height, x, y };
  }
  _computeCanvasSize(width = 0, height = 0) {
    const scalefactor = this.prescaleFactor <= 0 ? 1 : this.prescaleFactor;
    if (height <= 0 || width <= 0) {
      width = 0;
      height = 0;
    } else {
      const sgn = scalefactor < 1 ? -1 : 1;
      let newH = height;
      if (sgn * newH * scalefactor <= sgn * this.prescaleHeightLimit) {
        newH *= scalefactor;
      } else if (sgn * newH < sgn * this.prescaleHeightLimit) {
        newH = this.prescaleHeightLimit;
      }
      if (this.maxRenderHeight > 0 && newH > this.maxRenderHeight)
        newH = this.maxRenderHeight;
      width *= newH / height;
      height = newH;
    }
    return { width, height };
  }
  _timeupdate({ type }) {
    const eventmap = {
      seeking: true,
      waiting: true,
      playing: false
    };
    const playing = eventmap[type];
    if (playing != null)
      this._playstate = playing;
    this.setCurrentTime(this._video.paused || this._playstate, this._video.currentTime + this.timeOffset);
  }
  setVideo(video) {
    if (video instanceof HTMLVideoElement) {
      this._removeListeners();
      this._video = video;
      if (this._onDemandRender !== true) {
        this._playstate = video.paused;
        video.addEventListener("timeupdate", this._boundTimeUpdate, false);
        video.addEventListener("progress", this._boundTimeUpdate, false);
        video.addEventListener("waiting", this._boundTimeUpdate, false);
        video.addEventListener("seeking", this._boundTimeUpdate, false);
        video.addEventListener("playing", this._boundTimeUpdate, false);
        video.addEventListener("ratechange", this._boundSetRate, false);
      }
      if (video.videoWidth > 0)
        this.resize();
      video.addEventListener("resize", this._boundResize);
      if (typeof ResizeObserver !== "undefined") {
        if (!this._ro)
          this._ro = new ResizeObserver(() => this.resize());
        this._ro.observe(video);
      }
    } else {
      this._error("Video element invalid!");
    }
  }
  runBenchmark() {
    this.sendMessage("runBenchmark");
  }
  setTrackByUrl(url) {
    this.sendMessage("setTrackByUrl", { url });
  }
  setTrack(content) {
    this.sendMessage("setTrack", { content });
  }
  freeTrack() {
    this.sendMessage("freeTrack");
  }
  setIsPaused(isPaused) {
    this.sendMessage("video", { isPaused });
  }
  setRate(rate) {
    this.sendMessage("video", { rate });
  }
  setCurrentTime(isPaused, currentTime, rate) {
    this.sendMessage("video", { isPaused, currentTime, rate });
  }
  createEvent(event) {
    this.sendMessage("createEvent", { event });
  }
  setEvent(event, index) {
    this.sendMessage("setEvent", { event, index });
  }
  removeEvent(index) {
    this.sendMessage("removeEvent", { index });
  }
  getEvents(callback) {
    this._fetchFromWorker({
      target: "getEvents"
    }, (err, { events }) => {
      callback(err, events);
    });
  }
  createStyle(style) {
    this.sendMessage("createStyle", { style });
  }
  setStyle(event, index) {
    this.sendMessage("setStyle", { event, index });
  }
  removeStyle(index) {
    this.sendMessage("removeStyle", { index });
  }
  getStyles(callback) {
    this._fetchFromWorker({
      target: "getStyles"
    }, (err, { styles }) => {
      callback(err, styles);
    });
  }
  addFont(font) {
    this.sendMessage("addFont", { font });
  }
  _sendLocalFont(font) {
    try {
      queryLocalFonts().then((fontData) => {
        const filtered = fontData && fontData.filter((obj) => obj.fullName.toLowerCase() === font);
        if (filtered && filtered.length) {
          filtered[0].blob().then((blob) => {
            blob.arrayBuffer().then((buffer) => {
              this.addFont(new Uint8Array(buffer));
            });
          });
        }
      });
    } catch (e) {
      console.warn("Local fonts API:", e);
    }
  }
  _getLocalFont({ font }) {
    var _a;
    try {
      if ((_a = navigator == null ? void 0 : navigator.permissions) == null ? void 0 : _a.query) {
        navigator.permissions.query({ name: "local-fonts" }).then((permission) => {
          if (permission.state === "granted") {
            this._sendLocalFont(font);
          }
        });
      } else {
        this._sendLocalFont(font);
      }
    } catch (e) {
      console.warn("Local fonts API:", e);
    }
  }
  _unbusy() {
    this.busy = false;
  }
  _demandRender(now, metadata) {
    if (this._destroyed)
      return null;
    if (!this.busy) {
      this.busy = true;
      this.sendMessage("demand", { time: metadata.mediaTime + this.timeOffset });
    }
    this._video.requestVideoFrameCallback(this._demandRender.bind(this));
  }
  _render({ images, async, times }) {
    const drawStartTime = Date.now();
    this._ctx.clearRect(0, 0, this._canvasctrl.width, this._canvasctrl.height);
    for (const image of images) {
      if (image.image) {
        if (async) {
          this._ctx.drawImage(image.image, image.x, image.y);
          image.image.close();
        } else {
          this._bufferCanvas.width = image.w;
          this._bufferCanvas.height = image.h;
          this._bufferCtx.putImageData(new ImageData(this._fixAlpha(new Uint8ClampedArray(image.image)), image.w, image.h), 0, 0);
          this._ctx.drawImage(this._bufferCanvas, image.x, image.y);
        }
      }
    }
    if (this.debug) {
      times.drawTime = Date.now() - drawStartTime;
      let total = 0;
      for (const key in times)
        total += times[key];
      console.log("Bitmaps: " + images.length + " Total: " + Math.round(total) + "ms", times);
    }
  }
  _fixAlpha(uint8) {
    if (_JASSUB._hasAlphaBug) {
      for (let j = 3; j < uint8.length; j += 4) {
        uint8[j] = uint8[j] > 1 ? uint8[j] : 1;
      }
    }
    return uint8;
  }
  _ready() {
    this.dispatchEvent(new CustomEvent("ready"));
  }
  sendMessage(target, data = {}, transferable) {
    if (transferable) {
      this._worker.postMessage({
        target,
        transferable,
        ...data
      }, [...transferable]);
    } else {
      this._worker.postMessage({
        target,
        ...data
      });
    }
  }
  _fetchFromWorker(workerOptions, callback) {
    try {
      const target = workerOptions.target;
      const timeout = setTimeout(() => {
        reject(new Error("Error: Timeout while try to fetch " + target));
      }, 5e3);
      const resolve = ({ data }) => {
        if (data.target === target) {
          callback(null, data);
          this._worker.removeEventListener("message", resolve);
          this._worker.removeEventListener("error", reject);
          clearTimeout(timeout);
        }
      };
      const reject = (event) => {
        callback(event);
        this._worker.removeEventListener("message", resolve);
        this._worker.removeEventListener("error", reject);
        clearTimeout(timeout);
      };
      this._worker.addEventListener("message", resolve);
      this._worker.addEventListener("error", reject);
      this._worker.postMessage(workerOptions);
    } catch (error) {
      this._error(error);
    }
  }
  _console({ content, command }) {
    console[command].apply(console, JSON.parse(content));
  }
  _onmessage({ data }) {
    if (this["_" + data.target])
      this["_" + data.target](data);
  }
  _error(err) {
    if (!(err instanceof ErrorEvent))
      this.dispatchEvent(new ErrorEvent("error", { message: err instanceof Error ? err.cause : err }));
    throw err instanceof Error ? err : new Error(err instanceof ErrorEvent ? err.message : "error", { cause: err });
  }
  _removeListeners() {
    if (this._video) {
      if (this._ro)
        this._ro.unobserve(this._video);
      this._video.removeEventListener("timeupdate", this._boundTimeUpdate);
      this._video.removeEventListener("progress", this._boundTimeUpdate);
      this._video.removeEventListener("waiting", this._boundTimeUpdate);
      this._video.removeEventListener("seeking", this._boundTimeUpdate);
      this._video.removeEventListener("playing", this._boundTimeUpdate);
      this._video.removeEventListener("ratechange", this._boundSetRate);
      this._video.removeEventListener("resize", this._boundResize);
    }
  }
  destroy(err) {
    if (err)
      this._error(err);
    if (this._video)
      this._video.parentNode.removeChild(this._canvasParent);
    this._destroyed = true;
    this._removeListeners();
    this.sendMessage("destroy");
    this._worker.terminate();
  }
};
let JASSUB = _JASSUB;
__publicField(JASSUB, "_supportsWebAssembly", null);
__publicField(JASSUB, "_hasAlphaBug", null);
export { JASSUB as default };
