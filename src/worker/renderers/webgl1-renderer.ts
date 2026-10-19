import { WebGLRendererBase, type AtlasItem } from './webgl-base.ts'

import type { ASSImage } from '../util.ts'

// GLSL ES 1.0 Vertex Shader with Instancing (using extension)
const VERTEX_SHADER = /* glsl */`
precision highp float;

// Quad position attribute (0,0), (1,0), (0,1), (1,0), (1,1), (0,1)
attribute vec2 a_quadPos;

uniform vec2 u_resolution;
uniform vec2 u_atlasSize;

// Instance attributes
attribute vec4 a_destRect;  // x, y, w, h
attribute vec2 a_srcXY;     // atlas x, y
attribute vec4 a_color;     // r, g, b, a

varying highp vec2 v_quadPos;
varying highp vec2 v_srcUV;
varying highp vec2 v_sizeUV;
varying vec4 v_color;

void main() {
  vec2 pixelPos = a_destRect.xy + a_quadPos * a_destRect.zw;
  vec2 clipPos = (pixelPos / u_resolution) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;

  gl_Position = vec4(clipPos, 0.0, 1.0);
  v_quadPos = a_quadPos;
  v_srcUV = a_srcXY / u_atlasSize;
  v_sizeUV = a_destRect.zw / u_atlasSize;
  v_color = a_color;
}
`

// GLSL ES 1.0 Fragment Shader
// WebGL1 has no texture arrays or texelFetch, so images are packed into 2D atlas pages.
const FRAGMENT_SHADER = /* glsl */`
precision mediump float;

uniform sampler2D u_tex;
uniform mat3 u_colorMatrix;

varying highp vec2 v_quadPos;
varying highp vec2 v_srcUV;
varying highp vec2 v_sizeUV;
varying vec4 v_color;

void main() {
  // The alpha channel contains the mask.
  float mask = texture2D(u_tex, v_srcUV + v_quadPos * v_sizeUV).a;

  // Apply color matrix conversion (identity if no conversion needed)
  vec3 correctedColor = u_colorMatrix * v_color.rgb;

  // libass color alpha: 0 = opaque, 255 = transparent (inverted)
  float colorAlpha = 1.0 - v_color.a;

  // Final alpha = colorAlpha * mask
  float a = colorAlpha * mask;

  // Premultiplied alpha output
  gl_FragColor = vec4(correctedColor * a, a);
}
`

const INITIAL_INSTANCES = 256
const ATLAS_ROUND = 64
const MAX_ATLAS_PAGES = 64
const MAX_ATLAS_BYTES = 256 * 1024 * 1024

interface WebGL1AtlasItem extends AtlasItem {
  packW: number
  uploadStrided: boolean
}

export class WebGL1Renderer extends WebGLRendererBase<WebGLRenderingContext> {
  // Extensions
  instancedArraysExt!: ANGLE_instanced_arrays

  // Uniform locations
  u_tex: WebGLUniformLocation | null = null
  u_atlasSize: WebGLUniformLocation | null = null

  // Attribute locations
  a_quadPos = -1
  a_destRect = -1
  a_srcXY = -1
  a_color = -1

  // Quad vertex buffer (shared for all instances)
  quadPosBuffer!: WebGLBuffer

  // Instance attribute buffers
  instanceDestRectBuffer!: WebGLBuffer
  instanceSrcBuffer!: WebGLBuffer
  instanceColorBuffer!: WebGLBuffer

  // Instance data arrays
  instanceDestRectData = new Float32Array(INITIAL_INSTANCES * 4)
  instanceSrcData = new Float32Array(INITIAL_INSTANCES * 2)
  instanceColorData = new Float32Array(INITIAL_INSTANCES * 4)
  instanceCapacity = 0

  atlasPages: WebGLTexture[] = []
  atlasSize = 0
  maxTextureSize = 0
  uploadCache = new Set<string>()

  // A reusable buffer for strided bitmap data
  tightData: Uint8Array | null = null

  constructor (canvas: OffscreenCanvas) {
    super(canvas)
    this._initGL()
  }

  _initGL () {
    const gl = this.canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: false,
      stencil: false,
      desynchronized: true,
      powerPreference: 'default'
    })

    if (!gl) {
      throw new Error('Could not get WebGL context')
    }
    this.gl = gl

    if (!gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision) {
      throw new Error('WebGL1 does not support highp texture coordinates')
    }

    this.atlasPages = []
    this.atlasSize = 0
    this.uploadCache.clear()
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE)

    // Get instanced arrays extension (required for instancing in WebGL1)
    const instancedArraysExt = this.gl.getExtension('ANGLE_instanced_arrays')
    if (!instancedArraysExt) {
      throw new Error('ANGLE_instanced_arrays extension not supported')
    }
    this.instancedArraysExt = instancedArraysExt

    this.createProgram(VERTEX_SHADER, FRAGMENT_SHADER)

    this.u_resolution = this.gl.getUniformLocation(this.program, 'u_resolution')
    this.u_tex = this.gl.getUniformLocation(this.program, 'u_tex')
    this.u_colorMatrix = this.gl.getUniformLocation(this.program, 'u_colorMatrix')
    this.u_atlasSize = this.gl.getUniformLocation(this.program, 'u_atlasSize')

    this.a_quadPos = this.gl.getAttribLocation(this.program, 'a_quadPos')
    this.a_destRect = this.gl.getAttribLocation(this.program, 'a_destRect')
    this.a_srcXY = this.gl.getAttribLocation(this.program, 'a_srcXY')
    this.a_color = this.gl.getAttribLocation(this.program, 'a_color')

    // Create quad position buffer (6 vertices for 2 triangles)
    this.quadPosBuffer = this.gl.createBuffer()
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadPosBuffer)
    const quadPositions = new Float32Array([
      0.0, 0.0,
      1.0, 0.0,
      0.0, 1.0,
      1.0, 0.0,
      1.0, 1.0,
      0.0, 1.0
    ])
    this.gl.bufferData(this.gl.ARRAY_BUFFER, quadPositions, this.gl.STATIC_DRAW)

    // Create instance attribute buffers
    this.instanceDestRectBuffer = this.gl.createBuffer()
    this.instanceSrcBuffer = this.gl.createBuffer()
    this.instanceColorBuffer = this.gl.createBuffer()

    this.instanceCapacity = 0
    this.ensureInstanceCapacity(INITIAL_INSTANCES)

    // Set up vertex attributes
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadPosBuffer)
    this.gl.enableVertexAttribArray(this.a_quadPos)
    this.gl.vertexAttribPointer(this.a_quadPos, 2, this.gl.FLOAT, false, 0, 0)

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceDestRectBuffer)
    this.gl.enableVertexAttribArray(this.a_destRect)
    this.gl.vertexAttribPointer(this.a_destRect, 4, this.gl.FLOAT, false, 0, 0)
    this.instancedArraysExt.vertexAttribDivisorANGLE(this.a_destRect, 1)

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceSrcBuffer)
    this.gl.enableVertexAttribArray(this.a_srcXY)
    this.gl.vertexAttribPointer(this.a_srcXY, 2, this.gl.FLOAT, false, 0, 0)
    this.instancedArraysExt.vertexAttribDivisorANGLE(this.a_srcXY, 1)

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceColorBuffer)
    this.gl.enableVertexAttribArray(this.a_color)
    this.gl.vertexAttribPointer(this.a_color, 4, this.gl.FLOAT, false, 0, 0)
    this.instancedArraysExt.vertexAttribDivisorANGLE(this.a_color, 1)

    this.applyCommonState(this.u_tex)
    this.gl.uniform2f(this.u_atlasSize, 1, 1)
  }

  ensureInstanceCapacity (count: number) {
    if (count <= this.instanceCapacity) return

    this.instanceCapacity = Math.max(count, this.instanceCapacity * 2, INITIAL_INSTANCES)
    this.instanceDestRectData = new Float32Array(this.instanceCapacity * 4)
    this.instanceSrcData = new Float32Array(this.instanceCapacity * 2)
    this.instanceColorData = new Float32Array(this.instanceCapacity * 4)

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceDestRectBuffer)
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceCapacity * 16, this.gl.DYNAMIC_DRAW)

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceSrcBuffer)
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceCapacity * 8, this.gl.DYNAMIC_DRAW)

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceColorBuffer)
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceCapacity * 16, this.gl.DYNAMIC_DRAW)
  }

  createAtlasPage (size: number) {
    const texture = this.gl.createTexture()
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture)
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.ALPHA,
      size,
      size,
      0,
      this.gl.ALPHA,
      this.gl.UNSIGNED_BYTE,
      null
    )

    // Set texture parameters
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE)

    return texture
  }

  ensureAtlas (size: number, pages: number) {
    if (this.atlasSize !== size) {
      for (const page of this.atlasPages) this.gl.deleteTexture(page)
      this.atlasPages = []
      this.atlasSize = size
      this.uploadCache.clear()
    }

    while (this.atlasPages.length < pages) {
      this.atlasPages.push(this.createAtlasPage(size))
    }
  }

  render (images: ASSImage[], heap: Uint8Array): void {
    if (!this.gl || !this.beginFrame(images)) return

    const items: WebGL1AtlasItem[] = []
    let maxDimension = 0
    let totalArea = 0

    for (const img of images) {
      if (img.w <= 0 || img.h <= 0 || img.w > this.maxTextureSize || img.h > this.maxTextureSize) continue

      // WebGL1 has no UNPACK_ROW_LENGTH. Upload the stride as the texture width instead of copying rows.
      let uploadStrided = img.stride >= img.w && img.stride <= this.maxTextureSize &&
        img.bitmap + img.stride * img.h <= heap.length
      let packW = uploadStrided ? img.stride : img.w

      if (packW > this.maxTextureSize) {
        uploadStrided = false
        packW = img.w
      }

      items.push({
        img,
        packW,
        uploadStrided,
        x: 0,
        y: 0,
        layer: 0,
        sourceKey: img.cache_id && `${img.cache_id}:${img.bitmap}:${img.w}:${img.h}:${img.stride}`
      })

      maxDimension = Math.max(maxDimension, packW, img.h)
      totalArea += packW * img.h
    }

    if (items.length === 0) {
      this.gl.flush()
      return
    }

    const requestedSize = Math.max(ATLAS_ROUND, Math.ceil(Math.max(maxDimension, Math.ceil(Math.sqrt(totalArea))) / ATLAS_ROUND) * ATLAS_ROUND)
    let size = Math.min(this.maxTextureSize, Math.max(this.atlasSize, requestedSize))

    // Pack images into atlas pages.
    let maxPages = Math.max(1, Math.min(MAX_ATLAS_PAGES, Math.floor(MAX_ATLAS_BYTES / (size * size))))
    let pageCount = this.packAtlas(items, size)

    if (pageCount > maxPages && size < this.maxTextureSize) {
      size = this.maxTextureSize
      maxPages = Math.max(1, Math.min(MAX_ATLAS_PAGES, Math.floor(MAX_ATLAS_BYTES / (size * size))))
      pageCount = this.packAtlas(items, size)
    }

    if (pageCount > maxPages) {
      console.warn('JASSUB: frame exceeds WebGL1 atlas capacity')
      this.gl.flush()
      return
    }

    this.ensureAtlas(size, pageCount)
    this.ensureInstanceCapacity(items.length)

    const oldCache = this.uploadCache
    this.uploadCache = new Set<string>()

    const pageItems: WebGL1AtlasItem[][] = Array.from({ length: pageCount }, () => [])
    for (const item of items) pageItems[item.layer]!.push(item)

    // Upload only changed images.
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      const page = pageItems[pageIndex]!
      if (!page.length) continue

      this.gl.bindTexture(this.gl.TEXTURE_2D, this.atlasPages[pageIndex]!)

      for (const item of page) {
        const key = item.sourceKey && `${item.sourceKey}:${item.layer}:${item.x}:${item.y}`

        if (key) {
          if (oldCache.has(key) || this.uploadCache.has(key)) {
            this.uploadCache.add(key)
            continue
          }
          this.uploadCache.add(key)
        }

        const { img } = item

        if (item.uploadStrided) {
          this.gl.texSubImage2D(
            this.gl.TEXTURE_2D,
            0,
            item.x,
            item.y,
            item.packW,
            img.h,
            this.gl.ALPHA,
            this.gl.UNSIGNED_BYTE,
            heap.subarray(img.bitmap, img.bitmap + img.stride * img.h)
          )
        } else {
          const length = img.w * img.h
          let tightData = this.tightData
          if (!tightData || tightData.length < length) tightData = this.tightData = new Uint8Array(length)

          const sourceView = heap.subarray(img.bitmap, img.bitmap + img.stride * img.h)
          for (let y = 0; y < img.h; y++) {
            const srcOffset = y * img.stride
            tightData.set(sourceView.subarray(srcOffset, srcOffset + img.w), y * img.w)
          }

          this.gl.texSubImage2D(
            this.gl.TEXTURE_2D,
            0,
            item.x,
            item.y,
            img.w,
            img.h,
            this.gl.ALPHA,
            this.gl.UNSIGNED_BYTE,
            tightData.subarray(0, length)
          )
        }
      }
    }

    // Draw one instanced batch per page.
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      const page = pageItems[pageIndex]!
      if (!page.length) continue

      for (let i = 0; i < page.length; i++) {
        const { img, x, y } = page[i]!
        const d = i * 4
        const s = i * 2
        const c = i * 4

        this.instanceDestRectData[d] = img.dst_x
        this.instanceDestRectData[d + 1] = img.dst_y
        this.instanceDestRectData[d + 2] = img.w
        this.instanceDestRectData[d + 3] = img.h

        this.instanceSrcData[s] = x
        this.instanceSrcData[s + 1] = y

        this.instanceColorData[c] = ((img.color >>> 24) & 0xFF) / 255
        this.instanceColorData[c + 1] = ((img.color >>> 16) & 0xFF) / 255
        this.instanceColorData[c + 2] = ((img.color >>> 8) & 0xFF) / 255
        this.instanceColorData[c + 3] = (img.color & 0xFF) / 255
      }

      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceDestRectBuffer)
      this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.instanceDestRectData.subarray(0, page.length * 4))

      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceSrcBuffer)
      this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.instanceSrcData.subarray(0, page.length * 2))

      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceColorBuffer)
      this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.instanceColorData.subarray(0, page.length * 4))

      this.gl.bindTexture(this.gl.TEXTURE_2D, this.atlasPages[pageIndex]!)
      this.gl.uniform2f(this.u_atlasSize, this.atlasSize, this.atlasSize)
      this.instancedArraysExt.drawArraysInstancedANGLE(this.gl.TRIANGLES, 0, 6, page.length)
    }

    this.gl.flush()
  }

  destroy () {
    if (!this.gl) return

    // Delete atlas pages.
    for (const page of this.atlasPages) this.gl.deleteTexture(page)
    this.atlasPages = []
    this.uploadCache.clear()

    this.gl.deleteBuffer(this.quadPosBuffer)
    this.gl.deleteBuffer(this.instanceDestRectBuffer)
    this.gl.deleteBuffer(this.instanceSrcBuffer)
    this.gl.deleteBuffer(this.instanceColorBuffer)
    this.gl.deleteProgram(this.program)

    this.quadPosBuffer = this.instanceDestRectBuffer = this.instanceSrcBuffer = this.instanceColorBuffer = this.program = this.gl = this.tightData = null!
  }
}
