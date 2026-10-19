import { colorMatrixConversionMap, IDENTITY_MATRIX, type ASSImage } from '../util.ts'

// GLSL ES 1.0 Vertex Shader with Instancing (using extension)
const VERTEX_SHADER = /* glsl */`
precision mediump float;

// Quad position attribute (0,0), (1,0), (0,1), (1,0), (1,1), (0,1)
attribute vec2 a_quadPos;

uniform vec2 u_resolution;

// Instance attributes
attribute vec4 a_destRect;  // x, y, w, h
attribute vec4 a_color;     // r, g, b, a

varying vec2 v_destXY;
varying vec4 v_color;
varying vec2 v_texSize;
varying vec2 v_texCoord;
varying vec2 v_normalizedImageSize;

uniform vec2 u_texDimensions;

void main() {
  vec2 pixelPos = a_destRect.xy + a_quadPos * a_destRect.zw;
  vec2 clipPos = (pixelPos / u_resolution) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;

  gl_Position = vec4(clipPos, 0.0, 1.0);
  v_destXY = a_destRect.xy;
  v_color = a_color;
  v_texSize = a_destRect.zw;
  v_texCoord = a_quadPos;
  v_normalizedImageSize = a_destRect.zw / u_texDimensions;
}
`

// GLSL ES 1.0 Fragment Shader
// WebGL1 doesn't support texture arrays or texelFetch, so we use individual textures
const FRAGMENT_SHADER = /* glsl */`
precision mediump float;

uniform sampler2D u_tex;
uniform mat3 u_colorMatrix;
uniform vec2 u_resolution;

varying vec2 v_destXY;
varying vec4 v_color;
varying vec2 v_texSize;
varying vec2 v_texCoord;
varying vec2 v_normalizedImageSize;

void main() {
  // The alpha channel contains the mask.
  float mask = texture2D(u_tex, v_texCoord * v_normalizedImageSize).a;

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

// Configuration
const MAX_INSTANCES = 256 // Maximum instances per draw call

export class WebGL1Renderer {
  canvas
  gl!: WebGLRenderingContext
  program!: WebGLProgram

  // Extensions
  instancedArraysExt!: ANGLE_instanced_arrays

  // Uniform locations
  u_resolution: WebGLUniformLocation | null = null
  u_tex: WebGLUniformLocation | null = null
  u_colorMatrix: WebGLUniformLocation | null = null
  u_texDimensions: WebGLUniformLocation | null = null

  // Attribute locations
  a_quadPos = -1
  a_destRect = -1
  a_color = -1

  // Quad vertex buffer (shared for all instances)
  quadPosBuffer!: WebGLBuffer

  // Instance attribute buffers
  instanceDestRectBuffer!: WebGLBuffer
  instanceColorBuffer!: WebGLBuffer

  // Instance data arrays
  instanceDestRectData = new Float32Array(MAX_INSTANCES * 4)
  instanceColorData = new Float32Array(MAX_INSTANCES * 4)

  // Texture cache (since WebGL1 doesn't support texture arrays)
  textureCache = new Map<number, {
    texture: WebGLTexture
    texWidth: number
    texHeight: number
    cacheId: number
    bitmap: number
    width: number
    stride: number
  }>()

  // A reusable buffer for strided bitmap data
  tightData: Uint8Array | null = null

  colorMatrix: Float32Array = IDENTITY_MATRIX

  _scheduledResize?: { width: number, height: number }

  resizeCanvas (width: number, height: number) {
    // WebGL doesn't allow 0-sized canvases
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

    this.textureCache.clear()

    // Get instanced arrays extension (required for instancing in WebGL1)
    const instancedArraysExt = this.gl.getExtension('ANGLE_instanced_arrays')
    if (!instancedArraysExt) {
      throw new Error('ANGLE_instanced_arrays extension not supported')
    }
    this.instancedArraysExt = instancedArraysExt

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

    // Get uniform locations
    this.u_resolution = this.gl.getUniformLocation(this.program, 'u_resolution')
    this.u_tex = this.gl.getUniformLocation(this.program, 'u_tex')
    this.u_colorMatrix = this.gl.getUniformLocation(this.program, 'u_colorMatrix')
    this.u_texDimensions = this.gl.getUniformLocation(this.program, 'u_texDimensions')

    // Get attribute locations
    this.a_quadPos = this.gl.getAttribLocation(this.program, 'a_quadPos')
    this.a_destRect = this.gl.getAttribLocation(this.program, 'a_destRect')
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
    this.instanceColorBuffer = this.gl.createBuffer()

    // Set up vertex attributes
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadPosBuffer)
    this.gl.enableVertexAttribArray(this.a_quadPos)
    this.gl.vertexAttribPointer(this.a_quadPos, 2, this.gl.FLOAT, false, 0, 0)

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceDestRectBuffer)
    this.gl.enableVertexAttribArray(this.a_destRect)
    this.gl.vertexAttribPointer(this.a_destRect, 4, this.gl.FLOAT, false, 0, 0)
    this.instancedArraysExt.vertexAttribDivisorANGLE(this.a_destRect, 1)

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceColorBuffer)
    this.gl.enableVertexAttribArray(this.a_color)
    this.gl.vertexAttribPointer(this.a_color, 4, this.gl.FLOAT, false, 0, 0)
    this.instancedArraysExt.vertexAttribDivisorANGLE(this.a_color, 1)

    // Set up blending for premultiplied alpha
    this.gl.enable(this.gl.BLEND)
    this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA)

    // Use the program
    this.gl.useProgram(this.program)

    // Set texture unit
    this.gl.uniform1i(this.u_tex, 0)

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

  createTexture (width: number, height: number) {
    const texture = this.gl.createTexture()
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture)

    // Allocate storage for the mask texture.
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.ALPHA,
      width,
      height,
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

    // Process images individually (WebGL1 limitation: no texture arrays)
    for (let i = 0; i < images.length; i++) {
      const img = images[i]!
      if (img.w <= 0 || img.h <= 0) continue

      // WebGL1 has no UNPACK_ROW_LENGTH. Upload the stride as the texture
      // width instead of copying rows. The shader samples only the image width.
      const stridedLength = img.stride * img.h
      const canUploadStrided = img.stride >= img.w && img.bitmap + stridedLength <= heap.length
      const texWidth = canUploadStrided ? img.stride : img.w
      const texHeight = img.h

      let entry = this.textureCache.get(i)
      let resized = false
      if (entry?.texWidth !== texWidth || entry.texHeight !== texHeight) {
        if (entry) this.gl.deleteTexture(entry.texture)
        entry = {
          texture: this.createTexture(texWidth, texHeight),
          texWidth,
          texHeight,
          cacheId: 0,
          bitmap: 0,
          width: 0,
          stride: 0
        }
        this.textureCache.set(i, entry)
        resized = true
      }

      const cached = !resized && img.cache_id !== 0 &&
        entry.cacheId === img.cache_id &&
        entry.bitmap === img.bitmap &&
        entry.width === img.w &&
        entry.stride === img.stride

      this.gl.bindTexture(this.gl.TEXTURE_2D, entry.texture)

      if (cached) {
        // The composite cache did not change, so the texture is current.
      } else if (canUploadStrided) {
        this.gl.texSubImage2D(
          this.gl.TEXTURE_2D,
          0,
          0, 0, // x, y offset
          texWidth,
          texHeight,
          this.gl.ALPHA,
          this.gl.UNSIGNED_BYTE,
          heap.subarray(img.bitmap, img.bitmap + stridedLength)
        )
      } else {
        // The padding is outside the heap. Copy the rows to a tight buffer.
        const length = img.w * img.h
        let tightData = this.tightData
        if (!tightData || tightData.length < length) tightData = this.tightData = new Uint8Array(length)

        const sourceView = new Uint8Array(heap.buffer, img.bitmap, img.stride * img.h)
        for (let y = 0; y < img.h; y++) {
          const srcOffset = y * img.stride
          tightData.set(sourceView.subarray(srcOffset, srcOffset + img.w), y * img.w)
        }

        this.gl.texSubImage2D(
          this.gl.TEXTURE_2D,
          0,
          0, 0, // x, y offset
          img.w,
          img.h,
          this.gl.ALPHA,
          this.gl.UNSIGNED_BYTE,
          tightData.subarray(0, length)
        )
      }

      entry.cacheId = img.cache_id
      entry.bitmap = img.bitmap
      entry.width = img.w
      entry.stride = img.stride

      // Fill instance data (single instance)
      this.instanceDestRectData[0] = img.dst_x
      this.instanceDestRectData[1] = img.dst_y
      this.instanceDestRectData[2] = img.w
      this.instanceDestRectData[3] = img.h

      this.instanceColorData[0] = ((img.color >>> 24) & 0xFF) / 255
      this.instanceColorData[1] = ((img.color >>> 16) & 0xFF) / 255
      this.instanceColorData[2] = ((img.color >>> 8) & 0xFF) / 255
      this.instanceColorData[3] = (img.color & 0xFF) / 255

      // Upload instance data to buffers
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceDestRectBuffer)
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceDestRectData.subarray(0, 4), this.gl.DYNAMIC_DRAW)

      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceColorBuffer)
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceColorData.subarray(0, 4), this.gl.DYNAMIC_DRAW)

      // Set texture dimensions uniform
      this.gl.uniform2f(this.u_texDimensions, texWidth, texHeight)

      // Single instanced draw call
      this.instancedArraysExt.drawArraysInstancedANGLE(this.gl.TRIANGLES, 0, 6, 1)
    }

    // Submit the queued commands before the task ends, so the compositor picks
    // up this frame.
    this.gl.flush()
  }

  destroy () {
    if (!this.gl) return
    // Delete all cached textures
    for (const entry of this.textureCache.values()) {
      this.gl.deleteTexture(entry.texture)
    }
    this.textureCache.clear()

    this.gl.deleteBuffer(this.quadPosBuffer)
    this.gl.deleteBuffer(this.instanceDestRectBuffer)
    this.gl.deleteBuffer(this.instanceColorBuffer)
    this.gl.deleteProgram(this.program)

    this.quadPosBuffer = this.instanceDestRectBuffer = this.instanceColorBuffer = this.program = this.gl = this.tightData = null!
  }
}
