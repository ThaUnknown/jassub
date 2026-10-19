// fallback for browsers that don't support WebGL2
import { colorMatrixConversionMap, IDENTITY_MATRIX, IS_FIREFOX, IS_SAFARI, SHOULD_REFERENCE_MEMORY, type ASSImage } from '../util.ts'

declare const self: DedicatedWorkerGlobalScope &
  typeof globalThis & {
    HEAPU8RAW: Uint8Array<ArrayBuffer>
    WASMMEMORY: WebAssembly.Memory
  }

// GLSL ES 3.0 Vertex Shader with Instancing
const VERTEX_SHADER = /* glsl */`#version 300 es
precision highp float;

const vec2 QUAD_POSITIONS[6] = vec2[6](
  vec2(0.0, 0.0),
  vec2(1.0, 0.0),
  vec2(0.0, 1.0),
  vec2(1.0, 0.0),
  vec2(1.0, 1.0),
  vec2(0.0, 1.0)
);

uniform vec2 u_resolution;

// Instance attributes
in vec4 a_destRect;  // x, y, w, h
in vec2 a_srcXY;     // atlas x, y
in vec4 a_color;     // r, g, b, a
in float a_layer;    // atlas layer

flat out vec2 v_destXY;
flat out vec4 v_color;
flat out vec2 v_texSize;
flat out vec2 v_srcXY;
flat out float v_layer;

void main() {
  vec2 quadPos = QUAD_POSITIONS[gl_VertexID];
  vec2 pixelPos = a_destRect.xy + quadPos * a_destRect.zw;
  vec2 clipPos = (pixelPos / u_resolution) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;

  gl_Position = vec4(clipPos, 0.0, 1.0);
  v_destXY = a_destRect.xy;
  v_color = a_color;
  v_texSize = a_destRect.zw;
  v_srcXY = a_srcXY;
  v_layer = a_layer;
}
`

// GLSL ES 3.0 Fragment Shader - use texelFetch for pixel-perfect sampling
const FRAGMENT_SHADER = /* glsl */`#version 300 es
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray u_atlas;
uniform mat3 u_colorMatrix;
uniform vec2 u_resolution;

flat in vec2 v_destXY;
flat in vec4 v_color;
flat in vec2 v_texSize;
flat in vec2 v_srcXY;
flat in float v_layer;

out vec4 fragColor;

void main() {
  // Flip Y: WebGL's gl_FragCoord.y is 0 at bottom, but destXY.y is from top
  vec2 fragPos = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);

  // Calculate local position within the quad (screen coords)
  vec2 localPos = fragPos - v_destXY;

  // Convert to integer texel coordinates for texelFetch
  ivec2 texCoord = ivec2(floor(localPos));

  // Bounds check (prevents out-of-bounds access)
  ivec2 texSizeI = ivec2(v_texSize);
  if (texCoord.x < 0 || texCoord.y < 0 || texCoord.x >= texSizeI.x || texCoord.y >= texSizeI.y) {
    discard;
  }

  // texelFetch: integer coords, no interpolation, no precision issues
  float mask = texelFetch(u_atlas, ivec3(ivec2(v_srcXY) + texCoord, int(v_layer)), 0).r;

  // Apply color matrix conversion (identity if no conversion needed)
  vec3 correctedColor = u_colorMatrix * v_color.rgb;

  // libass color alpha: 0 = opaque, 255 = transparent (inverted)
  float colorAlpha = 1.0 - v_color.a;

  // Final alpha = colorAlpha * mask
  float a = colorAlpha * mask;

  // Premultiplied alpha output
  fragColor = vec4(correctedColor * a, a);
}
`

const ATLAS_PADDING = 1
const INITIAL_INSTANCES = 256
// One instance is 4 floats (dest rect), 2 floats (atlas position), 4 normalized bytes (color) and 1 float (atlas layer)
const INSTANCE_STRIDE = 32

interface AtlasItem {
  img: ASSImage
  x: number
  y: number
  layer: number
  sourceKey: string | 0
}

interface AtlasTexture {
  texture: WebGLTexture
  size: number
  depth: number
}

// Dedupe identical sources, place tallest-first, keep original draw order.
function packAtlas (items: AtlasItem[], size: number) {
  const placed = new Map<string, AtlasItem>()
  let layer = 0
  let x = 0
  let y = 0
  let shelfHeight = 0

  for (const item of [...items].sort((a, b) => b.img.h - a.img.h)) {
    const { img, sourceKey } = item

    const cached = sourceKey && placed.get(sourceKey)
    if (cached) {
      item.x = cached.x
      item.y = cached.y
      item.layer = cached.layer
      continue
    }

    if (x + img.w > size) {
      x = 0
      y += shelfHeight + ATLAS_PADDING
    }
    if (y + img.h > size) {
      layer++
      x = 0
      y = 0
    }
    if (x === 0) shelfHeight = img.h

    item.x = x
    item.y = y
    item.layer = layer
    if (sourceKey) placed.set(sourceKey, item)
    x += img.w + ATLAS_PADDING
  }

  return layer + 1
}

export class WebGL2Renderer {
  canvas
  gl!: WebGL2RenderingContext
  program!: WebGLProgram
  vao!: WebGLVertexArrayObject

  // Uniform locations
  u_resolution: WebGLUniformLocation | null = null
  u_atlas: WebGLUniformLocation | null = null
  u_colorMatrix: WebGLUniformLocation | null = null

  // Interleaved instance buffer: dest rect, atlas position, then color
  instanceBuffer!: WebGLBuffer
  instanceData!: ArrayBuffer
  instanceFloats!: Float32Array
  instanceBytes!: Uint8Array
  instanceCapacity = 0

  atlas: AtlasTexture | null = null
  maxTextureSize = 0
  maxArrayTextureLayers = 0
  uploadCache = new Set<string>()

  colorMatrix: Float32Array = IDENTITY_MATRIX

  _createInstanceData () {
    this.instanceData = new ArrayBuffer(this.instanceCapacity * INSTANCE_STRIDE)
    this.instanceFloats = new Float32Array(this.instanceData)
    this.instanceBytes = new Uint8Array(this.instanceData)
  }

  ensureInstanceCapacity (count: number) {
    if (count <= this.instanceCapacity) return

    this.instanceCapacity = Math.max(count, this.instanceCapacity * 2, INITIAL_INSTANCES)
    this._createInstanceData()
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer)
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceCapacity * INSTANCE_STRIDE, this.gl.DYNAMIC_DRAW)
  }

  _scheduledResize?: { width: number, height: number }

  resizeCanvas (width: number, height: number) {
    // WebGL2 doesn't allow 0-sized canvases
    if (!width || !height) return
    if (this.canvas.width === width && this.canvas.height === height) return

    this._scheduledResize = { width, height }
  }

  constructor (canvas: OffscreenCanvas) {
    this.canvas = canvas
    this._initGL()

    canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault()
      this.gl = null!
    })
    canvas.addEventListener('webglcontextrestored', () => this._initGL())
  }

  _initGL () {
    const gl = this.canvas.getContext('webgl2', {
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
      throw new Error('Could not get WebGL2 context')
    }
    this.gl = gl

    this.maxTextureSize = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE)
    this.maxArrayTextureLayers = this.gl.getParameter(this.gl.MAX_ARRAY_TEXTURE_LAYERS)
    this.atlas = null
    this.uploadCache.clear()

    // Create shaders
    const vertexShader = this.createShader(this.gl.VERTEX_SHADER, VERTEX_SHADER)
    const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, FRAGMENT_SHADER)

    if (!vertexShader || !fragmentShader) {
      throw new Error('Failed to create shaders')
    }

    // Create program
    this.program = this.gl.createProgram()
    this.gl.attachShader(this.program, vertexShader)
    this.gl.attachShader(this.program, fragmentShader)
    this.gl.linkProgram(this.program)

    if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
      const info = this.gl.getProgramInfoLog(this.program)
      throw new Error('Failed to link program: ' + info)
    }

    this.gl.deleteShader(vertexShader)
    this.gl.deleteShader(fragmentShader)

    // Get uniform locations
    this.u_resolution = this.gl.getUniformLocation(this.program, 'u_resolution')
    this.u_atlas = this.gl.getUniformLocation(this.program, 'u_atlas')
    this.u_colorMatrix = this.gl.getUniformLocation(this.program, 'u_colorMatrix')

    // Create the interleaved instance buffer
    this.instanceBuffer = this.gl.createBuffer()
    this.instanceCapacity = 0
    this.ensureInstanceCapacity(INITIAL_INSTANCES)

    // Create a VAO (required for WebGL2)
    this.vao = this.gl.createVertexArray()
    this.gl.bindVertexArray(this.vao)

    // Setup instance attributes
    const destRectLoc = this.gl.getAttribLocation(this.program, 'a_destRect')
    this.gl.enableVertexAttribArray(destRectLoc)
    this.gl.vertexAttribPointer(destRectLoc, 4, this.gl.FLOAT, false, INSTANCE_STRIDE, 0)
    this.gl.vertexAttribDivisor(destRectLoc, 1)

    const srcXYLoc = this.gl.getAttribLocation(this.program, 'a_srcXY')
    this.gl.enableVertexAttribArray(srcXYLoc)
    this.gl.vertexAttribPointer(srcXYLoc, 2, this.gl.FLOAT, false, INSTANCE_STRIDE, 16)
    this.gl.vertexAttribDivisor(srcXYLoc, 1)

    const colorLoc = this.gl.getAttribLocation(this.program, 'a_color')
    this.gl.enableVertexAttribArray(colorLoc)
    this.gl.vertexAttribPointer(colorLoc, 4, this.gl.UNSIGNED_BYTE, true, INSTANCE_STRIDE, 24)
    this.gl.vertexAttribDivisor(colorLoc, 1)

    const layerLoc = this.gl.getAttribLocation(this.program, 'a_layer')
    this.gl.enableVertexAttribArray(layerLoc)
    this.gl.vertexAttribPointer(layerLoc, 1, this.gl.FLOAT, false, INSTANCE_STRIDE, 28)
    this.gl.vertexAttribDivisor(layerLoc, 1)

    // Set up blending for premultiplied alpha
    this.gl.enable(this.gl.BLEND)
    this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA)

    // Use the program
    this.gl.useProgram(this.program)

    // Set texture unit
    this.gl.uniform1i(this.u_atlas, 0)

    // Set initial color matrix
    this.gl.uniformMatrix3fv(this.u_colorMatrix, false, this.colorMatrix)

    // Set one-time GL state
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1)
    this.gl.clearColor(0, 0, 0, 0)
    this.gl.activeTexture(this.gl.TEXTURE0)

    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    this.gl.uniform2f(this.u_resolution, this.canvas.width, this.canvas.height)
  }

  createShader (type: number, source: string): WebGLShader | null {
    const shader = this.gl.createShader(type)!
    this.gl.shaderSource(shader, source)
    this.gl.compileShader(shader)

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const info = this.gl.getShaderInfoLog(shader)
      console.log(info)
      this.gl.deleteShader(shader)
      return null
    }

    return shader
  }

  // Set the color matrix for color space conversion.
  // Pass null or undefined to use identity (no conversion).
  setColorMatrix (subtitleColorSpace?: 'BT601' | 'BT709' | 'SMPTE240M' | 'FCC', videoColorSpace?: 'BT601' | 'BT709') {
    this.colorMatrix = (subtitleColorSpace && videoColorSpace && colorMatrixConversionMap[subtitleColorSpace]?.[videoColorSpace]) ?? IDENTITY_MATRIX
    if (this.gl && this.u_colorMatrix) {
      this.gl.useProgram(this.program)
      this.gl.uniformMatrix3fv(this.u_colorMatrix, false, this.colorMatrix)
    }
  }

  createAtlasTexture (size: number, depth: number) {
    if (this.atlas) {
      this.gl.deleteTexture(this.atlas.texture)
    }

    const texture = this.gl.createTexture()
    this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, texture)

    // Allocate storage for texture
    this.gl.texImage3D(
      this.gl.TEXTURE_2D_ARRAY,
      0,
      this.gl.R8,
      size,
      size,
      depth,
      0,
      this.gl.RED,
      this.gl.UNSIGNED_BYTE,
      null // Firefox cries about uninitialized data, but is slower with zero initialized data...
    )

    // Set texture parameters (no filtering needed for texelFetch, but set anyway)
    this.gl.texParameteri(this.gl.TEXTURE_2D_ARRAY, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST)
    this.gl.texParameteri(this.gl.TEXTURE_2D_ARRAY, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST)
    this.gl.texParameteri(this.gl.TEXTURE_2D_ARRAY, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE)
    this.gl.texParameteri(this.gl.TEXTURE_2D_ARRAY, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE)
    this.gl.texParameteri(this.gl.TEXTURE_2D_ARRAY, this.gl.TEXTURE_MAX_LEVEL, 0)

    this.atlas = { texture, size, depth }
  }

  render (images: ASSImage[], heap: Uint8Array): void {
    if (!this.gl) return

    // Apply a scheduled resize right before rendering, so the resize and the
    // first draw happen in one call and the resized buffer is never presented
    // on its own.
    if (this._scheduledResize) {
      const { width, height } = this._scheduledResize
      this._scheduledResize = undefined
      this.canvas.width = width
      this.canvas.height = height

      // Update viewport and resolution uniform
      this.gl.viewport(0, 0, width, height)
      this.gl.uniform2f(this.u_resolution, width, height)
    }

    // Clear canvas
    this.gl.clear(this.gl.COLOR_BUFFER_BIT)

    if (images.length === 0) {
      this.gl.flush()
      return
    }

    // Filter valid images and build atlas items in one pass
    let maxDimension = 0
    const items: AtlasItem[] = []

    for (const img of images) {
      if (img.w <= 0 || img.h <= 0 || img.w > this.maxTextureSize || img.h > this.maxTextureSize) continue
      items.push({
        img,
        x: 0,
        y: 0,
        layer: 0,
        sourceKey: img.cache_id && `${img.cache_id}:${img.bitmap}:${img.w}:${img.h}:${img.stride}`
      })
      maxDimension = Math.max(maxDimension, img.w, img.h)
    }

    if (items.length === 0) {
      this.gl.flush()
      return
    }

    const initialSize = Math.min(this.maxTextureSize, 2 ** Math.max(0, Math.ceil(Math.log2(maxDimension))))
    let size = Math.max(this.atlas?.size ?? 0, initialSize)
    const maxLayers = this.maxArrayTextureLayers || 256

    let pageCount = packAtlas(items, size)
    // triggered when a LOT of small textures are created, so small atlas, a lot of images, somewhat cheap-ish to recalculate
    while (pageCount > maxLayers && size < this.maxTextureSize) {
      size = Math.min(this.maxTextureSize, size * 2)
      pageCount = packAtlas(items, size)
    }

    if (pageCount > maxLayers) {
      console.warn('JASSUB: frame exceeds texture array capacity')
      this.gl.flush()
      return
    }

    const oldCache = this.uploadCache

    // Resize atlas texture if needed
    if (!this.atlas || this.atlas.size < size || this.atlas.depth < pageCount) {
      this.createAtlasTexture(size, Math.max(this.atlas?.depth ?? 0, pageCount))
      oldCache.clear()
    }

    this.ensureInstanceCapacity(items.length)

    this.uploadCache = new Set<string>()
    let instanceCount = 0

    // HACK 1 and 2 [see above for explanation]
    if ((self.HEAPU8RAW.buffer !== self.WASMMEMORY.buffer) || SHOULD_REFERENCE_MEMORY) {
      heap = self.HEAPU8RAW = new Uint8Array(self.WASMMEMORY.buffer)
    }

    // Upload textures
    for (const { img, x, y, layer, sourceKey } of items) {
      const key = sourceKey && `${sourceKey}:${x}:${y}:${layer}`
      let cached = false

      if (key) {
        cached = oldCache.has(key) || this.uploadCache.has(key)
        this.uploadCache.add(key)
      }

      if (!cached) {
        // Upload bitmap data to texture array layer
        this.gl.pixelStorei(this.gl.UNPACK_ROW_LENGTH, img.stride)

        if (IS_FIREFOX || IS_SAFARI) {
          // HACK 3 [see util.ts for explanation]
          const sourceView = new Uint8Array(heap.buffer, img.bitmap, img.stride * img.h)
          const bitmapData = new Uint8Array(sourceView)

          this.gl.texSubImage3D(
            this.gl.TEXTURE_2D_ARRAY,
            0,
            x, y, layer, // x, y, z offset
            img.w,
            img.h,
            1, // depth (1 layer)
            this.gl.RED,
            this.gl.UNSIGNED_BYTE,
            bitmapData
          )
        } else {
          this.gl.texSubImage3D(
            this.gl.TEXTURE_2D_ARRAY,
            0,
            x, y, layer, // x, y, z offset
            img.w,
            img.h,
            1, // depth (1 layer)
            this.gl.RED,
            this.gl.UNSIGNED_BYTE,
            heap,
            img.bitmap
          )
        }
      }
      // Fill the interleaved instance data
      const f = instanceCount * 8
      this.instanceFloats[f] = img.dst_x
      this.instanceFloats[f + 1] = img.dst_y
      this.instanceFloats[f + 2] = img.w
      this.instanceFloats[f + 3] = img.h
      this.instanceFloats[f + 4] = x
      this.instanceFloats[f + 5] = y
      this.instanceFloats[f + 7] = layer

      const b = instanceCount * INSTANCE_STRIDE + 24
      this.instanceBytes[b] = (img.color >>> 24) & 0xFF
      this.instanceBytes[b + 1] = (img.color >>> 16) & 0xFF
      this.instanceBytes[b + 2] = (img.color >>> 8) & 0xFF
      this.instanceBytes[b + 3] = img.color & 0xFF

      instanceCount++
    }

    this.gl.pixelStorei(this.gl.UNPACK_ROW_LENGTH, 0)

    if (instanceCount !== 0) {
      // Upload the instance data in one call
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer)
      this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.instanceBytes, 0, instanceCount * INSTANCE_STRIDE)

      // Single instanced draw call
      this.gl.drawArraysInstanced(this.gl.TRIANGLES, 0, 6, instanceCount)
    }

    // Submit the queued commands before the task ends, so the compositor picks
    // up this frame.
    this.gl.flush()
  }

  destroy () {
    this.uploadCache.clear()

    if (!this.gl) return

    if (this.atlas) this.gl.deleteTexture(this.atlas.texture)

    this.gl.deleteBuffer(this.instanceBuffer)
    this.gl.deleteVertexArray(this.vao)
    this.gl.deleteProgram(this.program)

    this.instanceBuffer = this.vao = this.program = this.gl = this.atlas = null!
  }
}
