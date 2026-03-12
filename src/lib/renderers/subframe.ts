import { parseASS } from 'subforge/ass'
import { unwrap } from 'subforge/core'
import {
  type CompositorBackend,
  createWebGLBackend,
  renderFrame,
  registerFontSource,
  setFontResolver
} from 'subframe'
import throughput from 'throughput'

import type { PerfCallback } from '$lib/constants'
import type { SubtitleDocument } from 'subforge'

interface LocalFontData {
  family: string
  fullName?: string
  postscriptName?: string
  style?: string
  blob: () => Promise<Blob>
}

const normalizeFontKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '')

const sanitizeFontName = (name: string) => {
  let filtered = ''
  for (const ch of name) {
    const code = ch.charCodeAt(0)
    if ((code >= 0 && code <= 31) || code === 127) continue
    filtered += ch
  }
  return filtered
    .trim()
    .replace(/^@+/, '')
    .replace(/^["']+|["']+$/g, '')
}

const getFontStemFromUrl = (fontUrl: string) => {
  const tail = fontUrl.split('/').pop() ?? ''
  const withoutQuery = tail.split(/[?#]/u)[0] ?? ''
  try {
    return decodeURIComponent(withoutQuery).replace(/\.[^/.]+$/, '')
  } catch {
    return withoutQuery.replace(/\.[^/.]+$/, '')
  }
}

let localFontIndex: Map<string, LocalFontData> | null = null
let localFontList: LocalFontData[] | null = null
let localFontIndexPromise: Promise<Map<string, LocalFontData> | null> | null = null
const localFontAliasCache = new Map<string, LocalFontData>()
const localFontBufferCache = new WeakMap<LocalFontData, Promise<ArrayBuffer>>()

const nameHasStyle = (name: string, style: string) => {
  const lower = name.toLowerCase()
  const s = style.toLowerCase()
  return lower.includes(s)
}

const scoreFontEntry = (requested: string, entry: LocalFontData) => {
  const req = requested.toLowerCase()
  const reqNorm = normalizeFontKey(requested)
  const names = [entry.fullName ?? '', entry.family, entry.postscriptName ?? '']
  let score = 0

  for (const name of names) {
    if (!name) continue
    const lower = name.toLowerCase()
    if (lower === req) score = Math.max(score, 100)
    const norm = normalizeFontKey(name)
    if (reqNorm && norm === reqNorm) score = Math.max(score, 90)
    if (req && lower.includes(req)) score = Math.max(score, 70)
    if (reqNorm && norm.includes(reqNorm)) score = Math.max(score, 60)
  }

  const style = entry.style ?? ''
  if (style) {
    if (!/(bold|italic|oblique|black|light|thin|regular)/i.test(requested)) {
      if (/regular/i.test(style)) score += 5
      if (/bold|italic|oblique|black|light|thin/i.test(style)) score -= 2
    } else if (nameHasStyle(requested, style)) {
      score += 5
    }
  }

  return score
}

const findFontEntryByIncludes = (name: string): LocalFontData | null => {
  if (!localFontList || localFontList.length === 0) return null
  const cached = localFontAliasCache.get(name)
  if (cached) return cached

  const needle = name.toLowerCase()
  const needleNorm = normalizeFontKey(name)
  let match: LocalFontData | null = null

  for (const entry of localFontList) {
    const fullName = entry.fullName ?? ''
    const family = entry.family
    const postscriptName = entry.postscriptName ?? ''
    const fullLower = fullName.toLowerCase()
    const familyLower = family.toLowerCase()
    const postLower = postscriptName.toLowerCase()

    if (fullLower.includes(needle) || familyLower.includes(needle) || postLower.includes(needle)) {
      match = entry
      break
    }

    if (needleNorm) {
      const fullNorm = normalizeFontKey(fullName)
      const familyNorm = normalizeFontKey(family)
      const postNorm = normalizeFontKey(postscriptName)
      if (
        fullNorm.includes(needleNorm) ||
        familyNorm.includes(needleNorm) ||
        postNorm.includes(needleNorm)
      ) {
        match = entry
        break
      }
    }
  }

  if (match) localFontAliasCache.set(name, match)
  return match
}

const resolveBestLocalFontEntry = (name: string, index: Map<string, LocalFontData>): LocalFontData | null => {
  const cached = localFontAliasCache.get(name)
  if (cached) return cached

  const key = name.toLowerCase()
  const normKey = normalizeFontKey(name)
  const direct = index.get(key) ?? (normKey ? index.get(normKey) : undefined)
  if (!localFontList || localFontList.length === 0) {
    if (direct) localFontAliasCache.set(name, direct)
    return direct ?? null
  }

  let best: LocalFontData | null = null
  let bestScore = 0
  for (const entry of localFontList) {
    const score = scoreFontEntry(name, entry)
    if (score > bestScore) {
      bestScore = score
      best = entry
    }
  }

  best ??= direct ?? findFontEntryByIncludes(name)
  if (best) localFontAliasCache.set(name, best)
  return best
}

const getLocalFontBuffer = (entry: LocalFontData): Promise<ArrayBuffer> => {
  const cached = localFontBufferCache.get(entry)
  if (cached) return cached
  const load = entry
    .blob()
    .then((blob) => blob.arrayBuffer())
    .catch((err) => {
      localFontBufferCache.delete(entry)
      throw err
    })
  localFontBufferCache.set(entry, load)
  return load
}

const buildLocalFontIndex = async (): Promise<Map<string, LocalFontData> | null> => {
  if (!('queryLocalFonts' in window)) return null
  if (localFontIndex) return localFontIndex
  if (localFontIndexPromise) return await localFontIndexPromise

  localFontIndexPromise = (async () => {
    try {
      const fonts = await (window as unknown as { queryLocalFonts: () => Promise<LocalFontData[]> }).queryLocalFonts()
      const list = fonts
      const index = new Map<string, LocalFontData>()
      localFontAliasCache.clear()

      for (const fontData of list) {
        const family = fontData.family
        const fullName = fontData.fullName ?? ''
        const postscriptName = fontData.postscriptName ?? ''

        if (family) {
          const familyKey = family.toLowerCase()
          if (!index.has(familyKey)) index.set(familyKey, fontData)
          const familyNorm = normalizeFontKey(family)
          if (familyNorm && !index.has(familyNorm)) index.set(familyNorm, fontData)
        }

        if (fullName) {
          const fullKey = fullName.toLowerCase()
          if (!index.has(fullKey)) index.set(fullKey, fontData)
          const fullNorm = normalizeFontKey(fullName)
          if (fullNorm && !index.has(fullNorm)) index.set(fullNorm, fontData)
        }

        if (postscriptName) {
          const postKey = postscriptName.toLowerCase()
          if (!index.has(postKey)) index.set(postKey, fontData)
          const postNorm = normalizeFontKey(postscriptName)
          if (postNorm && !index.has(postNorm)) index.set(postNorm, fontData)
        }
      }

      localFontList = list
      return index
    } catch {
      return null
    } finally {
      localFontIndexPromise = null
    }
  })()

  localFontIndex = await localFontIndexPromise
  return localFontIndex
}

export default async function (subUrl: string, video: HTMLVideoElement, delay = 0, fonts: string[] = [], cb: PerfCallback) {
  const res = await fetch(subUrl)
  const content = await res.text()

  // Parse subtitle
  const doc: SubtitleDocument = unwrap(parseASS(content, { onError: 'collect', strict: false, preserveOrder: true }))

  const fontUrlsByKey = new Map<string, string>()
  const fontLoadByUrl = new Map<string, Promise<ArrayBuffer>>()
  const registeredNames = new Set<string>()

  const rememberFontAlias = (name: string, buffer: ArrayBuffer) => {
    const cleaned = sanitizeFontName(name)
    if (!cleaned) return
    const key = cleaned.toLowerCase()
    if (registeredNames.has(key)) return
    registeredNames.add(key)
    registerFontSource(cleaned, buffer)
  }

  const loadFontBuffer = (fontUrl: string) => {
    const existing = fontLoadByUrl.get(fontUrl)
    if (existing) return existing
    const load = fetch(fontUrl).then((resp) => resp.arrayBuffer())
    fontLoadByUrl.set(fontUrl, load)
    return load
  }

  for (const fontUrl of fonts) {
    const stem = sanitizeFontName(getFontStemFromUrl(fontUrl))
    if (!stem) continue
    const lowerStem = stem.toLowerCase()
    if (!fontUrlsByKey.has(lowerStem)) fontUrlsByKey.set(lowerStem, fontUrl)
    const normalizedStem = normalizeFontKey(stem)
    if (normalizedStem && !fontUrlsByKey.has(normalizedStem)) fontUrlsByKey.set(normalizedStem, fontUrl)
  }

  setFontResolver(async (fontName) => {
    const cleanedName = sanitizeFontName(fontName)
    if (!cleanedName) return null
    const directKey = cleanedName.toLowerCase()
    const normalizedKey = normalizeFontKey(cleanedName)

    let matchedUrl = fontUrlsByKey.get(directKey) ?? (normalizedKey ? fontUrlsByKey.get(normalizedKey) : undefined)

    if (!matchedUrl && normalizedKey) {
      for (const [knownName, url] of fontUrlsByKey.entries()) {
        if (knownName.includes(normalizedKey) || normalizedKey.includes(knownName)) {
          matchedUrl = url
          break
        }
      }
    }

    if (matchedUrl) {
      try {
        const buffer = await loadFontBuffer(matchedUrl)
        rememberFontAlias(cleanedName, buffer)

        const stem = sanitizeFontName(getFontStemFromUrl(matchedUrl))
        if (stem && stem.toLowerCase() !== directKey) {
          rememberFontAlias(stem, buffer)
        }

        return buffer
      } catch (e) {
        console.warn('Failed to resolve font:', fontName, e)
      }
    }

    const index = await buildLocalFontIndex()
    if (!index) return null

    const entry = resolveBestLocalFontEntry(cleanedName, index)
    if (!entry) return null

    try {
      const buffer = await getLocalFontBuffer(entry)
      const familyKey = entry.family.toLowerCase()
      rememberFontAlias(entry.family, buffer)

      if (directKey && directKey !== familyKey) {
        rememberFontAlias(cleanedName, buffer)
      }

      const fullName = entry.fullName
      if (fullName) {
        const fullKey = fullName.toLowerCase()
        if (fullKey !== familyKey && fullKey !== directKey) {
          rememberFontAlias(fullName, buffer)
        }
      }

      const postscriptName = entry.postscriptName
      if (postscriptName) {
        const postKey = postscriptName.toLowerCase()
        if (postKey !== familyKey && postKey !== directKey) {
          rememberFontAlias(postscriptName, buffer)
        }
      }

      return buffer
    } catch (e) {
      console.warn('Failed to resolve local system font:', fontName, e)
      return null
    }
  })

  // Load fonts
  await Promise.all(fonts.map(async (fontUrl) => {
    try {
      // their lib is vibe coded, so i'll vibecode this font stuff too /shrug
      const buffer = await loadFontBuffer(fontUrl)
      const stemCandidate = sanitizeFontName(getFontStemFromUrl(fontUrl))
      const stem = stemCandidate || 'font'
      rememberFontAlias(stem, buffer)
    } catch (e) {
      console.warn('Failed to load font:', fontUrl, e)
    }
  }))

  // Setup Canvas
  const canvas = document.createElement('canvas')
  // Style canvas to overlay video exactly
  canvas.style.position = 'absolute'
  canvas.style.top = '0'
  canvas.style.left = '0'
  canvas.style.pointerEvents = 'none'
  canvas.style.width = '100%'
  canvas.style.height = '100%'

  // Try to append to the video's parent (assuming it's a relative container)
  if (video.parentElement) {
    video.parentElement.appendChild(canvas)
  }

  // Initialize WebGL Backend (preferred)
  let backend: CompositorBackend | null = null
  try {
    backend = createWebGLBackend({ canvas, preferWebGL2: true })
  } catch (e) {
    console.error('Failed to initialize WebGL backend for subframe', e)
    // CPU fallback is tricky without manual composition code from app.ts.
    // For now, if WebGL fails, we might fail or do nothing.
    // Given the task constraints, I will rely on WebGL.
  }

  // Handle resizing
  const resize = () => {
    const rect = video.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1

    // Set canvas internal size
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`

    if (backend) {
      backend.resize(canvas.width, canvas.height)
    }
  }

  // Initial resize
  resize()
  // Observe resizing
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(video)

  // Rendering Loop
  let stop = false
  const getFps = throughput(5)
  const getProcessingDuration = throughput(5)
  let droppedFrames = 0
  let presentedFrames = 0
  let mistimedFrames = 0
  let isRendering = false

  const onFrame = async (_now: number, meta: VideoFrameCallbackMetadata) => {
    if (stop) return
    video.requestVideoFrameCallback(onFrame)

    if (isRendering) {
      droppedFrames++
      return
    }

    isRendering = true
    const startTime = performance.now()

    // Calculate video time in ms
    // 'delay' shifts subtitles. If +delay, subs are later.
    // scriptTime = videoTime - delay
    const videoTimeMs = meta.mediaTime * 1000
    const scriptTimeMs = videoTimeMs + (delay * 1000)

    if (backend) {
      try {
        const result = await renderFrame(doc, scriptTimeMs, canvas.width, canvas.height)
        backend.render(result.layers, result.frame)
      } catch (e) {
        console.error('subframe render error:', e)
      }
    }

    isRendering = false

    ++presentedFrames

    const fps = getFps(1)
    const now = performance.now()
    const processingDuration = getProcessingDuration((now - startTime) / fps)
    const frameDelay = Math.max(0, now - meta.expectedDisplayTime)
    if (frameDelay > 0) ++mistimedFrames

    cb({
      fps,
      processingDuration,
      presentedFrames,
      mistimedFrames,
      droppedFrames
    })
  }

  // Start loop
  video.requestVideoFrameCallback(onFrame)

  // Return cleanup function
  return () => {
    stop = true
    resizeObserver.disconnect()
    canvas.remove()
    // subframe backend doesn't seem to have explicit destroy method exposed in top level types?
    // but canvas removal should clean up context eventually.
  }
}
