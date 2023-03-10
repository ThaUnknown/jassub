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
var commonjsGlobal = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : {};
const root = typeof globalThis !== "undefined" && globalThis || typeof self !== "undefined" && self || typeof commonjsGlobal !== "undefined" && commonjsGlobal;
function isConstructor(fn) {
  try {
    new fn();
  } catch (error) {
    return false;
  }
  return true;
}
if (typeof root.Event !== "function" || !isConstructor(root.Event)) {
  root.Event = function() {
    function Event2(type, options) {
      this.bubbles = !!options && !!options.bubbles;
      this.cancelable = !!options && !!options.cancelable;
      this.composed = !!options && !!options.composed;
      this.type = type;
    }
    return Event2;
  }();
}
if (typeof root.EventTarget === "undefined" || !isConstructor(root.Event)) {
  root.EventTarget = function() {
    function EventTarget2() {
      this.__listeners = /* @__PURE__ */ new Map();
    }
    EventTarget2.prototype = Object.create(Object.prototype);
    EventTarget2.prototype.addEventListener = function(type, listener, options) {
      if (arguments.length < 2) {
        throw new TypeError(
          `TypeError: Failed to execute 'addEventListener' on 'EventTarget': 2 arguments required, but only ${arguments.length} present.`
        );
      }
      const __listeners = this.__listeners;
      const actualType = type.toString();
      if (!__listeners.has(actualType)) {
        __listeners.set(actualType, /* @__PURE__ */ new Map());
      }
      const listenersForType = __listeners.get(actualType);
      if (!listenersForType.has(listener)) {
        listenersForType.set(listener, options);
      }
    };
    EventTarget2.prototype.removeEventListener = function(type, listener, _options) {
      if (arguments.length < 2) {
        throw new TypeError(
          `TypeError: Failed to execute 'addEventListener' on 'EventTarget': 2 arguments required, but only ${arguments.length} present.`
        );
      }
      const __listeners = this.__listeners;
      const actualType = type.toString();
      if (__listeners.has(actualType)) {
        const listenersForType = __listeners.get(actualType);
        if (listenersForType.has(listener)) {
          listenersForType.delete(listener);
        }
      }
    };
    EventTarget2.prototype.dispatchEvent = function(event) {
      if (!(event instanceof Event)) {
        throw new TypeError(
          `Failed to execute 'dispatchEvent' on 'EventTarget': parameter 1 is not of type 'Event'.`
        );
      }
      const type = event.type;
      const __listeners = this.__listeners;
      const listenersForType = __listeners.get(type);
      if (listenersForType) {
        for (const [listener, options] of listenersForType.entries()) {
          try {
            if (typeof listener === "function") {
              listener.call(this, event);
            } else if (listener && typeof listener.handleEvent === "function") {
              listener.handleEvent(event);
            }
          } catch (err) {
            setTimeout(() => {
              throw err;
            });
          }
          if (options && options.once) {
            listenersForType.delete(listener);
          }
        }
      }
      return true;
    };
    return EventTarget2;
  }();
}
const _JASSUB = class extends EventTarget {
  constructor(options = {}) {
    var _a, _b, _c;
    super();
    if (!globalThis.Worker) {
      this.destroy("Worker not supported");
    }
    _JASSUB._test();
    const blendMode = options.blendMode || "js";
    const asyncRender = typeof createImageBitmap !== "undefined" && ((_a = options.asyncRender) != null ? _a : true);
    const offscreenRender = typeof OffscreenCanvas !== "undefined" && ((_b = options.offscreenRender) != null ? _b : true);
    this._onDemandRender = "requestVideoFrameCallback" in HTMLVideoElement.prototype && ((_c = options.onDemandRender) != null ? _c : true);
    this.timeOffset = options.timeOffset || 0;
    this._video = options.video;
    this._videoHeight = 0;
    this._videoWidth = 0;
    this._canvas = options.canvas;
    if (this._video && !this._canvas) {
      this._canvasParent = document.createElement("div");
      this._canvasParent.className = "JASSUB";
      this._canvasParent.style.position = "relative";
      this._canvas = document.createElement("canvas");
      this._canvas.style.display = "block";
      this._canvas.style.position = "absolute";
      this._canvas.style.pointerEvents = "none";
      this._canvasParent.appendChild(this._canvas);
      if (this._video.nextSibling) {
        this._video.parentNode.insertBefore(this._canvasParent, this._video.nextSibling);
      } else {
        this._video.parentNode.appendChild(this._canvasParent);
      }
    } else if (!this._canvas) {
      this.destroy("Don't know where to render: you should give video or canvas in options.");
    }
    this._bufferCanvas = document.createElement("canvas");
    this._bufferCtx = this._bufferCanvas.getContext("2d", { desynchronized: true, willReadFrequently: true });
    this._canvasctrl = offscreenRender ? this._canvas.transferControlToOffscreen() : this._canvas;
    this._ctx = !offscreenRender && this._canvasctrl.getContext("2d", { desynchronized: true });
    this._lastRenderTime = 0;
    this.debug = !!options.debug;
    this.prescaleFactor = options.prescaleFactor || 1;
    this.prescaleHeightLimit = options.prescaleHeightLimit || 1080;
    this.maxRenderHeight = options.maxRenderHeight || 0;
    this._worker = new Worker(_JASSUB._supportsWebAssembly ? options.workerUrl || "jassub-worker.js" : options.legacyWorkerUrl || "jassub-worker-legacy.js");
    this._worker.onmessage = (e) => this._onmessage(e);
    this._worker.onerror = (e) => this._error(e);
    this._loaded = new Promise((resolve) => {
      this._init = () => {
        var _a2, _b2;
        if (this._destroyed)
          return;
        this._worker.postMessage({
          target: "init",
          asyncRender,
          onDemandRender: this._onDemandRender,
          width: this._canvasctrl.width,
          height: this._canvasctrl.height,
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
          useLocalFonts: "queryLocalFonts" in self && ((_a2 = options.useLocalFonts) != null ? _a2 : true)
        });
        if (offscreenRender === true)
          this.sendMessage("offscreenCanvas", null, [this._canvasctrl]);
        this._boundResize = this.resize.bind(this);
        this._boundTimeUpdate = this._timeupdate.bind(this);
        this._boundSetRate = this.setRate.bind(this);
        if (this._video)
          this.setVideo(options.video);
        if (this._onDemandRender) {
          this.busy = false;
          this._lastDemandTime = null;
          (_b2 = this._video) == null ? void 0 : _b2.requestVideoFrameCallback(this._handleRVFC.bind(this));
        }
        resolve();
      };
    });
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
        self.ImageData = function(data, width, height) {
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
        if (module instanceof WebAssembly.Module)
          _JASSUB._supportsWebAssembly = new WebAssembly.Instance(module) instanceof WebAssembly.Instance;
      }
    } catch (e) {
      _JASSUB._supportsWebAssembly = false;
    }
    const canvas2 = document.createElement("canvas");
    const ctx2 = canvas2.getContext("2d", { willReadFrequently: true });
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
    canvas1.remove();
    canvas2.remove();
  }
  resize(width = 0, height = 0, top = 0, left = 0, force = ((_a) => (_a = this._video) == null ? void 0 : _a.paused)()) {
    if ((!width || !height) && this._video) {
      const videoSize = this._getVideoPosition();
      let renderSize = null;
      if (this._videoWidth) {
        const widthRatio = this._video.videoWidth / this._videoWidth;
        const heightRatio = this._video.videoHeight / this._videoHeight;
        renderSize = this._computeCanvasSize((videoSize.width || 0) / widthRatio, (videoSize.height || 0) / heightRatio);
      } else {
        renderSize = this._computeCanvasSize(videoSize.width || 0, videoSize.height || 0);
      }
      width = renderSize.width;
      height = renderSize.height;
      if (this._canvasParent) {
        top = videoSize.y - (this._canvasParent.getBoundingClientRect().top - this._video.getBoundingClientRect().top);
        left = videoSize.x;
      }
      this._canvas.style.width = videoSize.width + "px";
      this._canvas.style.height = videoSize.height + "px";
    }
    this._canvas.style.top = top + "px";
    this._canvas.style.left = left + "px";
    this.sendMessage("canvas", { width, height, force: force && this.busy === false });
  }
  _getVideoPosition(width = this._video.videoWidth, height = this._video.videoHeight) {
    const videoRatio = width / height;
    const { offsetWidth, offsetHeight } = this._video;
    const elementRatio = offsetWidth / offsetHeight;
    width = offsetWidth;
    height = offsetHeight;
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
    const ratio = self.devicePixelRatio || 1;
    width = width * ratio;
    height = height * ratio;
    if (height <= 0 || width <= 0) {
      width = 0;
      height = 0;
    } else {
      const sgn = scalefactor < 1 ? -1 : 1;
      let newH = height * ratio;
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
      if (this._onDemandRender) {
        this._video.requestVideoFrameCallback(this._handleRVFC.bind(this));
      } else {
        this._playstate = video.paused;
        video.addEventListener("timeupdate", this._boundTimeUpdate, false);
        video.addEventListener("progress", this._boundTimeUpdate, false);
        video.addEventListener("waiting", this._boundTimeUpdate, false);
        video.addEventListener("seeking", this._boundTimeUpdate, false);
        video.addEventListener("playing", this._boundTimeUpdate, false);
        video.addEventListener("ratechange", this._boundSetRate, false);
        video.addEventListener("resize", this._boundResize);
      }
      if (video.videoWidth > 0)
        this.resize();
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
  _sendLocalFont(name) {
    try {
      queryLocalFonts().then((fontData) => {
        const font = fontData == null ? void 0 : fontData.find((obj) => obj.fullName.toLowerCase() === name);
        if (font) {
          font.blob().then((blob) => {
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
    if (this._lastDemandTime) {
      this._demandRender(this._lastDemandTime);
    } else {
      this.busy = false;
    }
  }
  _handleRVFC(now, { mediaTime, width, height }) {
    if (this._destroyed)
      return null;
    if (this.busy) {
      this._lastDemandTime = { mediaTime, width, height };
    } else {
      this.busy = true;
      this._demandRender({ mediaTime, width, height });
    }
    this._video.requestVideoFrameCallback(this._handleRVFC.bind(this));
  }
  _demandRender({ mediaTime, width, height }) {
    this._lastDemandTime = null;
    if (width !== this._videoWidth || height !== this._videoHeight) {
      this._videoWidth = width;
      this._videoHeight = height;
      this.resize();
    }
    this.sendMessage("demand", { time: mediaTime + this.timeOffset });
  }
  _render({ images, async, times, width, height }) {
    this._unbusy();
    const drawStartTime = Date.now();
    if (this._canvasctrl.width !== width || this._canvasctrl.height !== height) {
      this._canvasctrl.width = width;
      this._canvasctrl.height = height;
    }
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
    this._init();
    this.dispatchEvent(new CustomEvent("ready"));
  }
  async sendMessage(target, data = {}, transferable) {
    await this._loaded;
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
    this.dispatchEvent(err instanceof ErrorEvent ? new ErrorEvent(err.type, err) : new ErrorEvent("error", { cause: err instanceof Error ? err.cause : err }));
    if (!(err instanceof Error)) {
      if (err instanceof ErrorEvent) {
        err = err.error;
      } else {
        err = new Error("error", { cause: err });
      }
    }
    console.error(err);
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
    if (this._video && this._canvasParent)
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
