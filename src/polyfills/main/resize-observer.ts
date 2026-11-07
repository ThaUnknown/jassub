interface Watched {
  target: Element
  width: number
  height: number
}

type Callback = (entries: Array<{ target: Element, contentRect: { width: number, height: number } }>, observer: ResizeObserverPolyfill) => void

const observers = new Set<ResizeObserverPolyfill>()
let frame = 0

function check () {
  frame = 0
  for (const observer of observers) observer._check()
  if (observers.size) frame = requestAnimationFrame(check)
}

function start () {
  if (!frame) frame = requestAnimationFrame(check)
}

class ResizeObserverPolyfill {
  _callback: Callback
  _watched: Watched[] = []

  constructor (callback: Callback) {
    this._callback = callback
  }

  observe (target: Element) {
    if (this._watched.some(entry => entry.target === target)) return
    // The native observer reports the initial size, a size of -1 forces that first report.
    this._watched.push({ target, width: -1, height: -1 })
    observers.add(this)
    start()
  }

  unobserve (target: Element) {
    this._watched = this._watched.filter(entry => entry.target !== target)
    if (!this._watched.length) observers.delete(this)
  }

  disconnect () {
    this._watched = []
    observers.delete(this)
  }

  _check () {
    const changed: Watched[] = []
    for (const entry of this._watched) {
      const width = entry.target.clientWidth
      const height = entry.target.clientHeight
      if (width === entry.width && height === entry.height) continue
      entry.width = width
      entry.height = height
      changed.push(entry)
    }
    if (!changed.length) return
    this._callback(changed.map(({ target, width, height }) => ({ target, contentRect: { width, height } })), this)
  }
}

export function installResizeObserver () {
  if (typeof ResizeObserver === 'function') return
  ;(self as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverPolyfill
  window.addEventListener('resize', () => { for (const observer of observers) observer._check() })
}
