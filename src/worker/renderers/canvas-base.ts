import { IDENTITY_MATRIX } from '../color-conversions'

import type { ASSImage } from '../util.ts'

interface Segment { x: number, y: number, w: number }
// the top edge of the used area of an atlas page, as segments from left to right
type Skyline = Segment[]

// the segment where a rectangle starts, and the y where it rests
interface Spot { index: number, y: number }

// find the lowest spot, then the leftmost, where a w x h rectangle fits in a page of width x height, return false if it does not fit
// the result goes into spot, so a search does not allocate
function findSpot (segments: Skyline, w: number, h: number, width: number, height: number, spot: Spot) {
  // a spot must be lower than bestY, so the first spot that fits wins a tie
  let bestY = height - h + 1
  const count = segments.length
  for (let i = 0; i < count; i++) {
    const segment = segments[i]!
    const end = segment.x + w
    if (end > width) break
    // the rectangle rests at least on this segment, so it cannot be lower than the best spot
    if (segment.y >= bestY) continue

    // the rectangle rests on the highest segment under it
    let y = segment.y
    for (let j = i + 1; j < count; j++) {
      const next = segments[j]!
      if (next.x >= end) break
      if (next.y > y) {
        y = next.y
        if (y >= bestY) break
      }
    }

    if (y < bestY) {
      bestY = y
      spot.index = i
      spot.y = y
    }
  }
  return bestY <= height - h
}

// place a w x h rectangle at the spot, and return its x
function addSegment (segments: Skyline, { index, y }: Spot, w: number, h: number) {
  const x = segments[index]!.x
  const end = x + w
  const top = y + h

  // replace the segments under the rectangle, and shorten the one it covers in part
  let last = index
  while (last < segments.length && segments[last]!.x + segments[last]!.w <= end) last++
  if (last < segments.length && segments[last]!.x < end) {
    const partial = segments[last]!
    partial.w -= end - partial.x
    partial.x = end
  }
  segments.splice(index, last - index, { x, y: top, w })

  // merge the neighbours of the same height
  if (index + 1 < segments.length && segments[index + 1]!.y === top) {
    segments[index]!.w += segments[index + 1]!.w
    segments.splice(index + 1, 1)
  }
  if (index > 0 && segments[index - 1]!.y === top) {
    segments[index - 1]!.w += segments[index]!.w
    segments.splice(index, 1)
  }

  return x
}

export interface AtlasItem {
  img: ASSImage
  packW?: number
  sourceKey: string | 0
  x: number
  y: number
  layer: number
}

export class CanvasRendererBase {
  canvas
  _scheduledResize?: { width: number, height: number }
  colorMatrix: Float32Array = IDENTITY_MATRIX

  constructor (canvas: OffscreenCanvas) {
    this.canvas = canvas
  }

  static isSupported<T extends CanvasRendererBase> (this: new (canvas: OffscreenCanvas) => T, canvas: OffscreenCanvas) {
    try {
      return new this(canvas)
    } catch (e) {}
  }

  resizeCanvas (width: number, height: number) {
    // WebGL doesn't allow 0-sized canvases. A matching size cancels any pending
    // resize, otherwise a later draw would apply an older size to a newer frame.
    this._scheduledResize = !width || !height ||
      (this.canvas.width === width && this.canvas.height === height)
      ? undefined
      : { width, height }
  }

  applyScheduledResize () {
    // Apply a scheduled resize right before rendering, so the resize and the
    // first draw happen in one call and the resized buffer is never presented
    // on its own.
    if (!this._scheduledResize) return

    const resize = this._scheduledResize
    this._scheduledResize = undefined
    this.canvas.width = resize.width
    this.canvas.height = resize.height
    return resize
  }

  // Skyline bottom-left packing, identical sources are placed once
  // anyPage lets an image go on any page, WebGL1 and the 2D renderer draw page by page, so they only fill the last page to keep the draw order
  packAtlas (items: AtlasItem[], width: number, padding = 0, anyPage = false, height = width) {
    const placed = new Map<string, AtlasItem>()
    const pages: Skyline[] = []
    const spot: Spot = { index: 0, y: 0 }
    // the padding goes after each image, so a page holds width + padding x height + padding
    width += padding
    height += padding

    for (const item of items) {
      const { img, sourceKey } = item

      const cached = sourceKey && placed.get(sourceKey)
      if (cached) {
        item.x = cached.x
        item.y = cached.y
        item.layer = cached.layer
        continue
      }

      const w = (item.packW ?? img.w) + padding
      const h = img.h + padding

      let layer = anyPage ? 0 : Math.max(0, pages.length - 1)
      while (layer < pages.length && !findSpot(pages[layer]!, w, h, width, height, spot)) layer++

      if (layer === pages.length) {
        // the callers size the page to the largest image, so it fits in the top left corner of a new page
        pages.push([{ x: 0, y: 0, w: width }])
        if (!anyPage) placed.clear()
        spot.index = 0
        spot.y = 0
      }

      item.x = addSegment(pages[layer]!, spot, w, h)
      item.y = spot.y
      item.layer = layer
      if (sourceKey) placed.set(sourceKey, item)
    }

    return pages.length
  }

  destroy () {}
}
