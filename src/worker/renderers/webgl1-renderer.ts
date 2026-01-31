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
attribute float a_texLayer;

varying vec2 v_destXY;
varying vec4 v_color;
varying vec2 v_texSize;
varying float v_texLayer;
varying vec2 v_texCoord;

void main() {
  vec2 pixelPos = a_destRect.xy + a_quadPos * a_destRect.zw;
  vec2 clipPos = (pixelPos / u_resolution) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;

  gl_Position = vec4(clipPos, 0.0, 1.0);
  v_destXY = a_destRect.xy;
  v_color = a_color;
  v_texSize = a_destRect.zw;
  v_texLayer = a_texLayer;
  v_texCoord = a_quadPos;
}
`

// GLSL ES 1.0 Fragment Shader
// WebGL1 doesn't support texture arrays or texelFetch, so we use individual textures
const FRAGMENT_SHADER = /* glsl */`
precision mediump float;

uniform sampler2D u_tex;
uniform mat3 u_colorMatrix;
uniform vec2 u_resolution;
uniform vec2 u_texDimensions; // Actual texture dimensions

varying vec2 v_destXY;
varying vec4 v_color;
varying vec2 v_texSize;
varying float v_texLayer;
varying vec2 v_texCoord;

void main() {
  // v_texCoord is in 0-1 range for the quad
  // We need to map it to the actual image size within the texture
  // The image occupies only (v_texSize.x / u_texDimensions.x, v_texSize.y / u_texDimensions.y) of the texture
  vec2 normalizedImageSize = v_texSize / u_texDimensions;
  vec2 texCoord = v_texCoord * normalizedImageSize;

  // Sample texture (r channel contains mask)
  float mask = texture2D(u_tex, texCoord).r;

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
  canvas: OffscreenCanvas | null = null
  gl: WebGLRenderingContext | null = null
  program: WebGLProgram | null = null

  // Extensions
  instancedArraysExt: ANGLE_instanced_arrays | null = null

  // Uniform locations
  u_resolution: WebGLUniformLocation | null = null
  u_tex: WebGLUniformLocation | null = null
  u_colorMatrix: WebGLUniformLocation | null = null
  u_texDimensions: WebGLUniformLocation | null = null

  // Attribute locations
  a_quadPos = -1
  a_destRect = -1
  a_color = -1
  a_texLayer = -1

  // Quad vertex buffer (shared for all instances)
  quadPosBuffer: WebGLBuffer | null = null

  // Instance attribute buffers
  instanceDestRectBuffer: WebGLBuffer | null = null
  instanceColorBuffer: WebGLBuffer | null = null
  instanceTexLayerBuffer: WebGLBuffer | null = null

  // Instance data arrays
  instanceDestRectData: Float32Array
  instanceColorData: Float32Array
  instanceTexLayerData: Float32Array

  // Texture cache (since WebGL1 doesn't support texture arrays)
  textureCache = new Map<number, WebGLTexture>()
  textureWidth = 0
  textureHeight = 0

  colorMatrix: Float32Array = IDENTITY_MATRIX

  constructor () {
    this.instanceDestRectData = new Float32Array(MAX_INSTANCES * 4)
    this.instanceColorData = new Float32Array(MAX_INSTANCES * 4)
    this.instanceTexLayerData = new Float32Array(MAX_INSTANCES)
  }

  _scheduledResize?: { width: number, height: number }

  resizeCanvas (width: number, height: number) {
    // WebGL doesn't allow 0-sized canvases
    if (width <= 0 || height <= 0) return

    this._scheduledResize = { width, height }
  }

  setCanvas (canvas: OffscreenCanvas) {
    this.canvas = canvas
    this.gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: false,
      stencil: false,
      desynchronized: true,
      powerPreference: 'high-performance'
    })

    if (!this.gl) {
      throw new Error('Could not get WebGL context')
    }

    // Get instanced arrays extension (required for instancing in WebGL1)
    this.instancedArraysExt = this.gl.getExtension('ANGLE_instanced_arrays')
    if (!this.instancedArraysExt) {
      throw new Error('ANGLE_instanced_arrays extension not supported')
    }

    // Create shaders
    const vertexShader = this.createShader(this.gl.VERTEX_SHADER, VERTEX_SHADER)
    const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, FRAGMENT_SHADER)

    if (!vertexShader || !fragmentShader) {
      throw new Error('Failed to create shaders')
    }

    // Create program
    this.program = this.gl.createProgram()!
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
    this.a_texLayer = this.gl.getAttribLocation(this.program, 'a_texLayer')

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
    this.instanceTexLayerBuffer = this.gl.createBuffer()

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

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceTexLayerBuffer)
    this.gl.enableVertexAttribArray(this.a_texLayer)
    this.gl.vertexAttribPointer(this.a_texLayer, 1, this.gl.FLOAT, false, 0, 0)
    this.instancedArraysExt.vertexAttribDivisorANGLE(this.a_texLayer, 1)

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
  }

  createShader (type: number, source: string): WebGLShader | null {
    const shader = this.gl!.createShader(type)!
    this.gl!.shaderSource(shader, source)
    this.gl!.compileShader(shader)

    if (!this.gl!.getShaderParameter(shader, this.gl!.COMPILE_STATUS)) {
      const info = this.gl!.getShaderInfoLog(shader)
      console.log(info)
      this.gl!.deleteShader(shader)
      return null
    }

    return shader
  }

  // Set the color matrix for color space conversion.
  // Pass null or undefined to use identity (no conversion).
  setColorMatrix (subtitleColorSpace?: 'BT601' | 'BT709' | 'SMPTE240M' | 'FCC', videoColorSpace?: 'BT601' | 'BT709') {
    this.colorMatrix = (subtitleColorSpace && videoColorSpace && colorMatrixConversionMap[subtitleColorSpace]?.[videoColorSpace]) ?? IDENTITY_MATRIX
    if (this.gl && this.u_colorMatrix && this.program) {
      this.gl.useProgram(this.program)
      this.gl.uniformMatrix3fv(this.u_colorMatrix, false, this.colorMatrix)
    }
  }

  createTexture (width: number, height: number): WebGLTexture {
    const texture = this.gl!.createTexture()
    this.gl!.bindTexture(this.gl!.TEXTURE_2D, texture)

    // Allocate storage for texture (WebGL1 uses LUMINANCE instead of R8)
    this.gl!.texImage2D(
      this.gl!.TEXTURE_2D,
      0,
      this.gl!.LUMINANCE,
      width,
      height,
      0,
      this.gl!.LUMINANCE,
      this.gl!.UNSIGNED_BYTE,
      null
    )

    // Set texture parameters
    this.gl!.texParameteri(this.gl!.TEXTURE_2D, this.gl!.TEXTURE_MIN_FILTER, this.gl!.NEAREST)
    this.gl!.texParameteri(this.gl!.TEXTURE_2D, this.gl!.TEXTURE_MAG_FILTER, this.gl!.NEAREST)
    this.gl!.texParameteri(this.gl!.TEXTURE_2D, this.gl!.TEXTURE_WRAP_S, this.gl!.CLAMP_TO_EDGE)
    this.gl!.texParameteri(this.gl!.TEXTURE_2D, this.gl!.TEXTURE_WRAP_T, this.gl!.CLAMP_TO_EDGE)

    return texture
  }

  render (images: ASSImage[], heap: Uint8Array): void {
    if (!this.gl || !this.program || !this.instancedArraysExt) return

    // we scheduled a resize because changing the canvas size clears it, and we don't want it to flicker
    // so we do it here, right before rendering
    if (this._scheduledResize) {
      const { width, height } = this._scheduledResize
      this._scheduledResize = undefined
      this.canvas!.width = width
      this.canvas!.height = height

      // Update viewport and resolution uniform
      this.gl.viewport(0, 0, width, height)
      this.gl.uniform2f(this.u_resolution, width, height)
    } else {
      // Clear canvas
      this.gl.clear(this.gl.COLOR_BUFFER_BIT)
    }

    // Find max dimensions needed and filter valid images
    let maxW = this.textureWidth
    let maxH = this.textureHeight
    const validImages: ASSImage[] = []

    for (const img of images) {
      if (img.w <= 0 || img.h <= 0) continue
      validImages.push(img)
      if (img.w > maxW) maxW = img.w
      if (img.h > maxH) maxH = img.h
    }

    if (validImages.length === 0) return

    // Update texture dimensions if needed
    if (maxW > this.textureWidth || maxH > this.textureHeight) {
      this.textureWidth = maxW
      this.textureHeight = maxH
      // Clear texture cache as we need to recreate textures
      for (const texture of this.textureCache.values()) {
        this.gl.deleteTexture(texture)
      }
      this.textureCache.clear()
    }

    // Process images individually (WebGL1 limitation: no texture arrays)
    // We'll render them one by one instead of in batches
    for (let i = 0; i < validImages.length; i++) {
      const img = validImages[i]!

      // Get or create texture for this image
      let texture = this.textureCache.get(i)
      if (!texture) {
        texture = this.createTexture(this.textureWidth, this.textureHeight)
        this.textureCache.set(i, texture)
      }

      this.gl.bindTexture(this.gl.TEXTURE_2D, texture)

      // Upload bitmap data to texture
      // WebGL1 doesn't support UNPACK_ROW_LENGTH, so we need to handle strided data manually
      // Strided data - need to copy row by row to remove padding
      const sourceView = new Uint8Array(heap.buffer, img.bitmap, img.stride * img.h)
      const tightData = new Uint8Array(img.w * img.h)

      for (let y = 0; y < img.h; y++) {
        const srcOffset = y * img.stride
        const dstOffset = y * img.w
        tightData.set(sourceView.subarray(srcOffset, srcOffset + img.w), dstOffset)
      }

      this.gl.texSubImage2D(
        this.gl.TEXTURE_2D,
        0,
        0, 0, // x, y offset
        img.w,
        img.h,
        this.gl.LUMINANCE,
        this.gl.UNSIGNED_BYTE,
        tightData
      )

      // Fill instance data (single instance)
      this.instanceDestRectData[0] = img.dst_x
      this.instanceDestRectData[1] = img.dst_y
      this.instanceDestRectData[2] = img.w
      this.instanceDestRectData[3] = img.h

      this.instanceColorData[0] = ((img.color >>> 24) & 0xFF) / 255
      this.instanceColorData[1] = ((img.color >>> 16) & 0xFF) / 255
      this.instanceColorData[2] = ((img.color >>> 8) & 0xFF) / 255
      this.instanceColorData[3] = (img.color & 0xFF) / 255

      this.instanceTexLayerData[0] = 0 // Not used in WebGL1 version

      // Upload instance data to buffers
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceDestRectBuffer)
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceDestRectData.subarray(0, 4), this.gl.DYNAMIC_DRAW)

      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceColorBuffer)
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceColorData.subarray(0, 4), this.gl.DYNAMIC_DRAW)

      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceTexLayerBuffer)
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceTexLayerData.subarray(0, 1), this.gl.DYNAMIC_DRAW)

      // Set texture dimensions uniform
      this.gl.uniform2f(this.u_texDimensions, this.textureWidth, this.textureHeight)

      // Single instanced draw call
      this.instancedArraysExt.drawArraysInstancedANGLE(this.gl.TRIANGLES, 0, 6, 1)
    }
  }

  destroy () {
    if (this.gl) {
      // Delete all cached textures
      for (const texture of this.textureCache.values()) {
        this.gl.deleteTexture(texture)
      }
      this.textureCache.clear()

      if (this.quadPosBuffer) {
        this.gl.deleteBuffer(this.quadPosBuffer)
        this.quadPosBuffer = null
      }

      if (this.instanceDestRectBuffer) {
        this.gl.deleteBuffer(this.instanceDestRectBuffer)
        this.instanceDestRectBuffer = null
      }

      if (this.instanceColorBuffer) {
        this.gl.deleteBuffer(this.instanceColorBuffer)
        this.instanceColorBuffer = null
      }

      if (this.instanceTexLayerBuffer) {
        this.gl.deleteBuffer(this.instanceTexLayerBuffer)
        this.instanceTexLayerBuffer = null
      }

      if (this.program) {
        this.gl.deleteProgram(this.program)
        this.program = null
      }

      this.gl = null
    }
  }
}
