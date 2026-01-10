import type { ASSImage } from '../jassub'
import { IDENTITY_MATRIX, type Renderer } from './renderer'

// GLSL ES 3.0 Vertex Shader - simple per-draw-call approach
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
uniform vec4 u_destRect;  // x, y, w, h
uniform vec4 u_color;     // r, g, b, a
uniform float u_texLayer;

flat out vec2 v_destXY;
flat out vec4 v_color;
flat out vec2 v_texSize;
flat out float v_texLayer;

void main() {
  vec2 quadPos = QUAD_POSITIONS[gl_VertexID];
  vec2 pixelPos = u_destRect.xy + quadPos * u_destRect.zw;
  vec2 clipPos = (pixelPos / u_resolution) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;

  gl_Position = vec4(clipPos, 0.0, 1.0);
  v_destXY = u_destRect.xy;
  v_color = u_color;
  v_texSize = u_destRect.zw;
  v_texLayer = u_texLayer;
}
`

// GLSL ES 3.0 Fragment Shader - use texelFetch for pixel-perfect sampling
const FRAGMENT_SHADER = /* glsl */`#version 300 es
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray u_texArray;
uniform mat3 u_colorMatrix;
uniform vec2 u_resolution;

flat in vec2 v_destXY;
flat in vec4 v_color;
flat in vec2 v_texSize;
flat in float v_texLayer;

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
    fragColor = vec4(0.0);
    return;
  }

  // texelFetch: integer coords, no interpolation, no precision issues
  float mask = texelFetch(u_texArray, ivec3(texCoord, int(v_texLayer)), 0).r;

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

// Maximum images per batch (limited by UBO size)
const MAX_IMAGES_PER_BATCH = 256

// Texture array dimensions - will be resized as needed
const INITIAL_TEX_SIZE = 512
const MAX_TEX_SIZE = 2048

export class WebGL2Renderer implements Renderer {
  private gl: WebGL2RenderingContext | null = null
  private program: WebGLProgram | null = null
  private canvas: OffscreenCanvas | null = null

  // Uniform locations
  private resolutionLoc: WebGLUniformLocation | null = null
  private colorMatrixLoc: WebGLUniformLocation | null = null
  private texArrayLoc: WebGLUniformLocation | null = null
  private destRectLoc: WebGLUniformLocation | null = null
  private colorLoc: WebGLUniformLocation | null = null
  private texLayerLoc: WebGLUniformLocation | null = null

  // VAO (required for WebGL2 drawing)
  private vao: WebGLVertexArrayObject | null = null

  // Texture array for all subtitle bitmaps
  private texArray: WebGLTexture | null = null
  private texArrayWidth = INITIAL_TEX_SIZE
  private texArrayHeight = INITIAL_TEX_SIZE
  private texArrayLayers = 16

  // Debug flag
  private _debugOnce = false

  // Current color matrix (identity by default)
  private colorMatrix = new Float32Array([
    1, 0, 0,
    0, 1, 0,
    0, 0, 1
  ])

  private _ready: Promise<void>

  constructor () {
    // WebGL2 init is synchronous, but we keep the promise pattern for interface consistency
    this._ready = Promise.resolve()
  }

  ready () {
    return this._ready
  }

  async setCanvas (canvas: OffscreenCanvas, width: number, height: number) {
    if (width <= 0 || height <= 0) return

    canvas.width = width
    canvas.height = height

    if (!this.gl) {
      this.canvas = canvas
      const gl = canvas.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        desynchronized: true
      })

      if (!gl) {
        throw new Error('WebGL2 not supported')
      }

      this.gl = gl
      this._initGL()
    }

    this.gl.viewport(0, 0, width, height)

    if (this.resolutionLoc) {
      this.gl.uniform2f(this.resolutionLoc, width, height)
    }
  }

  private _initGL () {
    const gl = this.gl!

    // Create shader program
    const vertShader = this._compileShader(gl.VERTEX_SHADER, VERTEX_SHADER)
    const fragShader = this._compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER)

    this.program = gl.createProgram()!
    gl.attachShader(this.program, vertShader)
    gl.attachShader(this.program, fragShader)
    gl.linkProgram(this.program)

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error('Shader link failed: ' + gl.getProgramInfoLog(this.program))
    }

    gl.deleteShader(vertShader)
    gl.deleteShader(fragShader)

    gl.useProgram(this.program)

    // Create and bind VAO (required for WebGL2)
    this.vao = gl.createVertexArray()
    gl.bindVertexArray(this.vao)

    // Get uniform locations
    this.resolutionLoc = gl.getUniformLocation(this.program, 'u_resolution')
    this.colorMatrixLoc = gl.getUniformLocation(this.program, 'u_colorMatrix')
    this.texArrayLoc = gl.getUniformLocation(this.program, 'u_texArray')
    this.destRectLoc = gl.getUniformLocation(this.program, 'u_destRect')
    this.colorLoc = gl.getUniformLocation(this.program, 'u_color')
    this.texLayerLoc = gl.getUniformLocation(this.program, 'u_texLayer')

    // Create texture array
    this._createTexArray()

    // Set up blending (premultiplied alpha)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

    // Set texture unit
    gl.uniform1i(this.texArrayLoc, 0)

    // Set initial color matrix
    gl.uniformMatrix3fv(this.colorMatrixLoc, false, this.colorMatrix)
  }

  private _compileShader (type: number, source: string): WebGLShader {
    const gl = this.gl!
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader)
      gl.deleteShader(shader)
      throw new Error('Shader compile failed: ' + info)
    }

    return shader
  }

  private _createTexArray () {
    const gl = this.gl!

    if (this.texArray) {
      gl.deleteTexture(this.texArray)
    }

    this.texArray = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texArray)

    // Allocate texture array storage
    gl.texImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      gl.R8,
      this.texArrayWidth,
      this.texArrayHeight,
      this.texArrayLayers,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      null
    )

    // No filtering needed - we use texelFetch with integer coords
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  async setColorMatrix (matrix?: Float32Array<ArrayBuffer>) {
    if (matrix) {
      // Convert from padded (12 floats) to mat3 (9 floats)
      this.colorMatrix[0] = matrix[0]!
      this.colorMatrix[1] = matrix[1]!
      this.colorMatrix[2] = matrix[2]!
      this.colorMatrix[3] = matrix[4]!
      this.colorMatrix[4] = matrix[5]!
      this.colorMatrix[5] = matrix[6]!
      this.colorMatrix[6] = matrix[8]!
      this.colorMatrix[7] = matrix[9]!
      this.colorMatrix[8] = matrix[10]!
    } else {
      // Identity
      this.colorMatrix.set([1, 0, 0, 0, 1, 0, 0, 0, 1])
    }

    if (this.gl && this.colorMatrixLoc) {
      this.gl.uniformMatrix3fv(this.colorMatrixLoc, false, this.colorMatrix)
    }
  }

  render (images: ASSImage[], heap: Uint8Array): void {
    const gl = this.gl
    if (!gl || !this.program) return

    // Clear canvas
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    if (images.length === 0) return

    // Check if we need to resize texture array
    let maxW = 0
    let maxH = 0
    for (const img of images) {
      if (img.w > maxW) maxW = img.w
      if (img.h > maxH) maxH = img.h
    }

    const needsResize = maxW > this.texArrayWidth || maxH > this.texArrayHeight || images.length > this.texArrayLayers
    if (needsResize) {
      this.texArrayWidth = Math.min(Math.max(this.texArrayWidth, maxW), MAX_TEX_SIZE)
      this.texArrayHeight = Math.min(Math.max(this.texArrayHeight, maxH), MAX_TEX_SIZE)
      this.texArrayLayers = Math.max(this.texArrayLayers, images.length)
      this._createTexArray()
    }

    // Set up GL state
    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texArray)

    // Draw each image with per-draw-call uniforms
    for (let i = 0; i < images.length; i++) {
      const img = images[i]!
      if (img.w <= 0 || img.h <= 0) continue

      // Upload bitmap to texture array layer
      this._uploadBitmap(i, img, heap)

      // Set uniforms for this image
      gl.uniform4f(this.destRectLoc, img.dst_x, img.dst_y, img.w, img.h)
      gl.uniform4f(
        this.colorLoc,
        ((img.color >>> 24) & 0xFF) / 255,
        ((img.color >>> 16) & 0xFF) / 255,
        ((img.color >>> 8) & 0xFF) / 255,
        (img.color & 0xFF) / 255
      )
      gl.uniform1f(this.texLayerLoc, i)

      // Draw this quad
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }

    const err = gl.getError()
    if (err !== gl.NO_ERROR) {
      console.error('WebGL2 error after draw:', err)
    }
  }

  private _uploadBitmap (layer: number, img: ASSImage, heap: Uint8Array) {
    const gl = this.gl!

    // Copy bitmap data row by row to handle stride
    const bitmapData = new Uint8Array(img.w * img.h)
    for (let y = 0; y < img.h; y++) {
      const srcOffset = img.bitmap + y * img.stride
      const dstOffset = y * img.w
      for (let x = 0; x < img.w; x++) {
        bitmapData[dstOffset + x] = heap[srcOffset + x]!
      }
    }

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)

    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0, 0, layer,
      img.w, img.h, 1,
      gl.RED,
      gl.UNSIGNED_BYTE,
      bitmapData
    )
  }

  destroy () {
    const gl = this.gl
    if (!gl) return

    if (this.program) {
      gl.deleteProgram(this.program)
      this.program = null
    }


    if (this.texArray) {
      gl.deleteTexture(this.texArray)
      this.texArray = null
    }

    this.gl = null
    this.canvas = null
  }
}
