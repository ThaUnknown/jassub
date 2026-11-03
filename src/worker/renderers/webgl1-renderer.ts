import { NEEDS_WASM_BUFFER_COPY, type ASSImage } from '../util.ts'

import { WebGLRendererBase, type AtlasItem } from './webgl-base.ts'

// GLSL ES 1.0 Vertex Shader. Vertex highp is mandatory.
const VERTEX_SHADER = /* glsl */`
precision highp float;

// Quad position attribute (0,0), (1,0), (0,1), (1,0), (1,1), (0,1)
attribute vec2 a_quadPos;

uniform vec2 u_resolution;
uniform vec2 u_atlasSize;

// Per-image attributes
attribute vec4 a_destRect;  // x, y, w, h
attribute vec2 a_srcXY;     // atlas x, y
attribute vec4 a_color;     // r, g, b, a

varying highp vec2 v_quadPos;
varying highp vec2 v_srcUV;
varying highp vec2 v_sizeUV;
varying mediump vec4 v_color;

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
#ifdef GL_FRAGMENT_PRECISION_HIGH
#define PRECISION highp
#else
#define PRECISION mediump
#endif

precision PRECISION float;

uniform sampler2D u_tex;
uniform mat3 u_colorMatrix;

varying PRECISION vec2 v_quadPos;
varying PRECISION vec2 v_srcUV;
varying PRECISION vec2 v_sizeUV;
varying mediump vec4 v_color;

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

// Per-image record: destination rect (4), atlas position (2), color (4).
const IMAGE_FLOATS = 10
const IMAGE_BYTES = IMAGE_FLOATS * 4

// Expanded vertex record: quad position (2) followed by the image record.
const VERTEX_FLOATS = IMAGE_FLOATS + 2
const VERTEX_BYTES = VERTEX_FLOATS * 4
const QUAD_POSITIONS = new Float32Array([
  0.0, 0.0,
  1.0, 0.0,
  0.0, 1.0,
  1.0, 0.0,
  1.0, 1.0,
  0.0, 1.0
])

interface WebGL1AtlasItem extends AtlasItem {
  packW: number
  uploadStrided: boolean
}

// highp is used when the fragment stage supports it, otherwise mediump is used with a smaller atlas so texture coordinates keep enough precision
// ANGLE_instanced_arrays is optional, without it the renderer expands each image into the vertex buffer and uses drawArrays()
export class WebGL1Renderer extends WebGLRendererBase<WebGLRenderingContext> {
  maxAtlasSize = 0
  atlasPadding = 0

  // Extensions
  instancedArraysExt: ANGLE_instanced_arrays | null = null

  // Uniform locations
  u_tex: WebGLUniformLocation | null = null
  u_atlasSize: WebGLUniformLocation | null = null

  // Attribute locations
  a_quadPos = -1
  a_destRect = -1
  a_srcXY = -1
  a_color = -1

  // Quad vertex buffer for the instanced path
  quadPosBuffer!: WebGLBuffer

  // Per-image records for the instanced path, or expanded vertices for the
  // non-instanced path. Only one layout is used at a time.
  instanceBuffer!: WebGLBuffer
  instanceData = new Float32Array(0)
  instanceCapacity = 0
  instanceStride = 0

  atlasPages: WebGLTexture[] = []
  atlasSize = 0
  maxTextureSize = 0
  uploadCache = new Set<string>()

  // A reusable copy buffer for bitmap uploads
  copyData = new Uint8Array(0)

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

    // The fragment shader picks highp or mediump from GL_FRAGMENT_PRECISION_HIGH.
    const highp = !!gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision
    this.atlasPages = []
    this.atlasSize = 0
    this.uploadCache.clear()
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE)

    this.instancedArraysExt = this.gl.getExtension('ANGLE_instanced_arrays')

    this.createProgram(VERTEX_SHADER, FRAGMENT_SHADER)

    // mediump cannot address a large atlas exactly, so size it from the reported
    // precision. In both modes, keep MAX_ATLAS_PAGES pages inside MAX_ATLAS_BYTES.
    // Growing to MAX_TEXTURE_SIZE would collapse maxPages to 1 at 4K/8K.
    const mediumpBits = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.MEDIUM_FLOAT)?.precision ?? 10
    this.maxAtlasSize = highp
      ? Math.min(this.maxTextureSize, Math.floor(Math.sqrt(MAX_ATLAS_BYTES / MAX_ATLAS_PAGES)))
      : Math.min(this.maxTextureSize, 2 ** Math.max(6, mediumpBits - 1))
    this.atlasPadding = highp ? 0 : 1

    this.u_resolution = this.gl.getUniformLocation(this.program, 'u_resolution')
    this.u_tex = this.gl.getUniformLocation(this.program, 'u_tex')
    this.u_colorMatrix = this.gl.getUniformLocation(this.program, 'u_colorMatrix')
    this.u_atlasSize = this.gl.getUniformLocation(this.program, 'u_atlasSize')

    this.a_quadPos = this.gl.getAttribLocation(this.program, 'a_quadPos')
    this.a_destRect = this.gl.getAttribLocation(this.program, 'a_destRect')
    this.a_srcXY = this.gl.getAttribLocation(this.program, 'a_srcXY')
    this.a_color = this.gl.getAttribLocation(this.program, 'a_color')

    // Create the instanced quad position buffer (6 vertices for 2 triangles)
    this.quadPosBuffer = this.gl.createBuffer()
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadPosBuffer)
    this.gl.bufferData(this.gl.ARRAY_BUFFER, QUAD_POSITIONS, this.gl.STATIC_DRAW)

    // Create the instance data buffer
    this.instanceBuffer = this.gl.createBuffer()
    this.instanceCapacity = 0
    const stride = this.instancedArraysExt ? IMAGE_FLOATS : 6 * VERTEX_FLOATS
    this.ensureInstanceCapacity(INITIAL_INSTANCES, stride)

    // Set up vertex attributes
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer)
    if (this.instancedArraysExt) {
      this.vertexAttrib(this.a_destRect, 4, IMAGE_BYTES, 0, 1)
      this.vertexAttrib(this.a_srcXY, 2, IMAGE_BYTES, 16, 1)
      this.vertexAttrib(this.a_color, 4, IMAGE_BYTES, 24, 1)

      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadPosBuffer)
      this.vertexAttrib(this.a_quadPos, 2, 0, 0)
    } else {
      this.vertexAttrib(this.a_quadPos, 2, VERTEX_BYTES, 0)
      this.vertexAttrib(this.a_destRect, 4, VERTEX_BYTES, 8)
      this.vertexAttrib(this.a_srcXY, 2, VERTEX_BYTES, 24)
      this.vertexAttrib(this.a_color, 4, VERTEX_BYTES, 32)
    }

    this.applyCommonState(this.u_tex)
    this.gl.uniform2f(this.u_atlasSize, 1, 1)
  }

  vertexAttrib (location: number, size: number, stride: number, offset: number, divisor = 0) {
    this.gl.enableVertexAttribArray(location)
    this.gl.vertexAttribPointer(location, size, this.gl.FLOAT, false, stride, offset)
    if (divisor) this.instancedArraysExt?.vertexAttribDivisorANGLE(location, divisor)
  }

  ensureInstanceCapacity (count: number, stride: number) {
    if (count <= this.instanceCapacity) return

    this.instanceCapacity = Math.max(count, this.instanceCapacity * 2, INITIAL_INSTANCES)
    this.instanceStride = stride
    this.instanceData = new Float32Array(this.instanceCapacity * stride)

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer)
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceData.byteLength, this.gl.DYNAMIC_DRAW)
  }

  writeImage (offset: number, img: ASSImage, x: number, y: number) {
    const data = this.instanceData
    data[offset] = img.dst_x
    data[offset + 1] = img.dst_y
    data[offset + 2] = img.w
    data[offset + 3] = img.h
    data[offset + 4] = x
    data[offset + 5] = y
    data[offset + 6] = ((img.color >>> 24) & 0xFF) / 255
    data[offset + 7] = ((img.color >>> 16) & 0xFF) / 255
    data[offset + 8] = ((img.color >>> 8) & 0xFF) / 255
    data[offset + 9] = (img.color & 0xFF) / 255
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

      // WebGL1 has no UNPACK_ROW_LENGTH. The stride becomes the texture width.
      // Pack rows tight only when the stride exceeds MAX_TEXTURE_SIZE.
      const uploadStrided = img.stride >= img.w && img.stride <= this.maxTextureSize
      const packW = uploadStrided ? img.stride : img.w

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
    // Keep pages inside the atlas size cap. A single larger image must
    // still fit, so maxDimension can raise the size above the cap.
    let size = Math.min(this.maxTextureSize, Math.max(this.atlasSize, requestedSize), Math.max(this.maxAtlasSize, maxDimension))

    // Pack images into atlas pages.
    let maxPages = Math.max(1, Math.min(MAX_ATLAS_PAGES, Math.floor(MAX_ATLAS_BYTES / (size * size))))
    let pageCount = this.packAtlas(items, size, this.atlasPadding)

    if (pageCount > maxPages && size < this.maxAtlasSize) {
      size = this.maxAtlasSize
      maxPages = Math.max(1, Math.min(MAX_ATLAS_PAGES, Math.floor(MAX_ATLAS_BYTES / (size * size))))
      pageCount = this.packAtlas(items, size, this.atlasPadding)
    }

    if (pageCount > maxPages) {
      console.warn('JASSUB: frame exceeds WebGL1 atlas capacity')
      this.gl.flush()
      return
    }

    this.ensureAtlas(size, pageCount)
    this.ensureInstanceCapacity(items.length, this.instanceStride)

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
          const length = img.stride * img.h
          const source = heap.subarray(img.bitmap, img.bitmap + length)

          // HACK 3 [see util.ts for explanation]
          if (NEEDS_WASM_BUFFER_COPY) {
            if (length > this.copyData.length) this.copyData = new Uint8Array(length)
            this.copyData.set(source)
          }

          this.gl.texSubImage2D(
            this.gl.TEXTURE_2D,
            0,
            item.x,
            item.y,
            item.packW,
            img.h,
            this.gl.ALPHA,
            this.gl.UNSIGNED_BYTE,
            NEEDS_WASM_BUFFER_COPY ? this.copyData.subarray(0, length) : source
          )
        } else {
          const length = img.w * img.h
          if (length > this.copyData.length) this.copyData = new Uint8Array(length)

          const sourceView = heap.subarray(img.bitmap, img.bitmap + img.stride * img.h)
          for (let y = 0; y < img.h; y++) {
            const srcOffset = y * img.stride
            this.copyData.set(sourceView.subarray(srcOffset, srcOffset + img.w), y * img.w)
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
            this.copyData.subarray(0, length)
          )
        }
      }
    }

    // Draw one batch per page.
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      const page = pageItems[pageIndex]!
      if (!page.length) continue

      for (let i = 0; i < page.length; i++) {
        const { img, x, y } = page[i]!

        if (this.instancedArraysExt) {
          this.writeImage(i * IMAGE_FLOATS, img, x, y)
        } else {
          for (let v = 0; v < 6; v++) {
            const o = (i * 6 + v) * VERTEX_FLOATS
            this.instanceData[o] = QUAD_POSITIONS[v * 2]!
            this.instanceData[o + 1] = QUAD_POSITIONS[v * 2 + 1]!
            this.writeImage(o + 2, img, x, y)
          }
        }
      }

      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer)
      this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, page.length * this.instanceStride))

      this.gl.bindTexture(this.gl.TEXTURE_2D, this.atlasPages[pageIndex]!)
      this.gl.uniform2f(this.u_atlasSize, this.atlasSize, this.atlasSize)

      if (this.instancedArraysExt) {
        this.instancedArraysExt.drawArraysInstancedANGLE(this.gl.TRIANGLES, 0, 6, page.length)
      } else {
        this.gl.drawArrays(this.gl.TRIANGLES, 0, page.length * 6)
      }
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
    this.gl.deleteBuffer(this.instanceBuffer)
    this.gl.deleteProgram(this.program)
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()

    this.quadPosBuffer = this.instanceBuffer = this.program = this.gl = this.copyData = null!
  }
}
