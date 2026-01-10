import type { ASSImage } from '../jassub'

declare const self: DedicatedWorkerGlobalScope &
  typeof globalThis & {
    HEAPU8RAW: Uint8Array<ArrayBuffer>
    WASMMEMORY: WebAssembly.Memory
  }

// @ts-expect-error new experimental API
const SUPPORTS_GROWTH = !!WebAssembly.Memory.prototype.toResizableBuffer

const IDENTITY_MATRIX = new Float32Array([
  1, 0, 0,
  0, 1, 0,
  0, 0, 1
])

// Color matrix conversion map - mat3x3 for WebGL2
// Each matrix converts FROM the key color space TO the nested key color space
export const colorMatrixConversionMap = {
  BT601: {
    BT709: new Float32Array([
      1.0863, 0.0965, -0.01411,
      -0.0723, 0.8451, -0.0277,
      -0.0141, 0.0584, 1.0418
    ]),
    BT601: IDENTITY_MATRIX
  },
  BT709: {
    BT601: new Float32Array([
      0.9137, 0.0784, 0.0079,
      -0.1049, 1.1722, -0.0671,
      0.0096, 0.0322, 0.9582
    ]),
    BT709: IDENTITY_MATRIX
  },
  FCC: {
    BT709: new Float32Array([
      1.0873, -0.0736, -0.0137,
      0.0974, 0.8494, 0.0531,
      -0.0127, -0.0251, 1.0378
    ]),
    BT601: new Float32Array([
      1.001, -0.0008, -0.0002,
      0.0009, 1.005, -0.006,
      0.0013, 0.0027, 0.996
    ])
  },
  SMPTE240M: {
    BT709: new Float32Array([
      0.9993, 0.0006, 0.0001,
      -0.0004, 0.9812, 0.0192,
      -0.0034, -0.0114, 1.0148
    ]),
    BT601: new Float32Array([
      0.913, 0.0774, 0.0096,
      -0.1051, 1.1508, -0.0456,
      0.0063, 0.0207, 0.973
    ])
  }
} as const

export type ColorSpace = keyof typeof colorMatrixConversionMap

// GLSL ES 3.0 Vertex Shader
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

// Texture array configuration
const TEX_ARRAY_SIZE = 64 // Fixed layer count
const TEX_INITIAL_SIZE = 256 // Initial width/height

export class WebGL2Renderer {
  gl: WebGL2RenderingContext | null = null
  program: WebGLProgram | null = null
  vao: WebGLVertexArrayObject | null = null

  // Uniform locations
  u_resolution: WebGLUniformLocation | null = null
  u_destRect: WebGLUniformLocation | null = null
  u_color: WebGLUniformLocation | null = null
  u_texArray: WebGLUniformLocation | null = null
  u_colorMatrix: WebGLUniformLocation | null = null
  u_texLayer: WebGLUniformLocation | null = null

  // Single texture array instead of individual textures
  texArray: WebGLTexture | null = null
  texArrayWidth = 0
  texArrayHeight = 0

  colorMatrix: Float32Array = IDENTITY_MATRIX

  setCanvas (canvas: OffscreenCanvas, width: number, height: number) {
    // WebGL2 doesn't allow 0-sized canvases
    if (width <= 0 || height <= 0) return

    canvas.width = width
    canvas.height = height

    if (!this.gl) {
      // Get canvas context
      // Note: preserveDrawingBuffer is false (default) - the browser handles
      // buffer swaps for OffscreenCanvas, avoiding flicker
      this.gl = canvas.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        desynchronized: true
      })

      if (!this.gl) {
        throw new Error('Could not get WebGL2 context')
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

      this.gl.deleteShader(vertexShader)
      this.gl.deleteShader(fragmentShader)

      // Get uniform locations
      this.u_resolution = this.gl.getUniformLocation(this.program, 'u_resolution')
      this.u_destRect = this.gl.getUniformLocation(this.program, 'u_destRect')
      this.u_color = this.gl.getUniformLocation(this.program, 'u_color')
      this.u_texArray = this.gl.getUniformLocation(this.program, 'u_texArray')
      this.u_colorMatrix = this.gl.getUniformLocation(this.program, 'u_colorMatrix')
      this.u_texLayer = this.gl.getUniformLocation(this.program, 'u_texLayer')

      // Create a VAO (required for WebGL2)
      this.vao = this.gl.createVertexArray()
      this.gl.bindVertexArray(this.vao)

      // Set up blending for premultiplied alpha
      this.gl.enable(this.gl.BLEND)
      this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA)

      // Use the program
      this.gl.useProgram(this.program)

      // Set texture unit
      this.gl.uniform1i(this.u_texArray, 0)

      // Set initial color matrix
      this.gl.uniformMatrix3fv(this.u_colorMatrix, false, this.colorMatrix)

      // Set one-time GL state
      this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1)
      this.gl.clearColor(0, 0, 0, 0)
      this.gl.activeTexture(this.gl.TEXTURE0)

      // Create initial texture array
      this.createTexArray(TEX_INITIAL_SIZE, TEX_INITIAL_SIZE)
    }

    // Update viewport and resolution uniform
    this.gl.viewport(0, 0, width, height)
    this.gl.uniform2f(this.u_resolution, width, height)
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

  /**
     * Set the color matrix for color space conversion.
     * Pass null or undefined to use identity (no conversion).
     */
  setColorMatrix (subtitleColorSpace?: 'BT601' | 'BT709' | 'SMPTE240M' | 'FCC', videoColorSpace?: 'BT601' | 'BT709') {
    this.colorMatrix = (subtitleColorSpace && videoColorSpace && colorMatrixConversionMap[subtitleColorSpace]?.[videoColorSpace]) ?? IDENTITY_MATRIX
    if (this.gl && this.u_colorMatrix && this.program) {
      this.gl.useProgram(this.program)
      this.gl.uniformMatrix3fv(this.u_colorMatrix, false, this.colorMatrix)
    }
  }

  createTexArray (width: number, height: number) {
    if (this.texArray) {
      this.gl!.deleteTexture(this.texArray)
    }

    this.texArray = this.gl!.createTexture()
    this.gl!.bindTexture(this.gl!.TEXTURE_2D_ARRAY, this.texArray)

    // Allocate storage for texture array
    this.gl!.texImage3D(
      this.gl!.TEXTURE_2D_ARRAY,
      0,
      this.gl!.R8,
      width,
      height,
      TEX_ARRAY_SIZE,
      0,
      this.gl!.RED,
      this.gl!.UNSIGNED_BYTE,
      null
    )

    // Set texture parameters (no filtering needed for texelFetch, but set anyway)
    this.gl!.texParameteri(this.gl!.TEXTURE_2D_ARRAY, this.gl!.TEXTURE_MIN_FILTER, this.gl!.NEAREST)
    this.gl!.texParameteri(this.gl!.TEXTURE_2D_ARRAY, this.gl!.TEXTURE_MAG_FILTER, this.gl!.NEAREST)
    this.gl!.texParameteri(this.gl!.TEXTURE_2D_ARRAY, this.gl!.TEXTURE_WRAP_S, this.gl!.CLAMP_TO_EDGE)
    this.gl!.texParameteri(this.gl!.TEXTURE_2D_ARRAY, this.gl!.TEXTURE_WRAP_T, this.gl!.CLAMP_TO_EDGE)

    this.texArrayWidth = width
    this.texArrayHeight = height
  }

  render (images: ASSImage[], heap: Uint8Array): void {
    if (!this.gl || !this.program || !this.vao || !this.texArray) return

    // Hack: work around shared memory issues, webGL doesnt support shared memory, so there are race conditions when growing memory
    if ((self.HEAPU8RAW.buffer !== self.WASMMEMORY.buffer) || SUPPORTS_GROWTH) {
      heap = self.HEAPU8RAW = new Uint8Array(self.WASMMEMORY.buffer)
    }

    // Clear canvas
    this.gl.clear(this.gl.COLOR_BUFFER_BIT)

    // Find max dimensions needed
    let maxW = this.texArrayWidth
    let maxH = this.texArrayHeight
    for (const img of images) {
      if (img.w > maxW) maxW = img.w
      if (img.h > maxH) maxH = img.h
    }

    // Resize texture array if needed
    if (maxW > this.texArrayWidth || maxH > this.texArrayHeight) {
      this.createTexArray(maxW, maxH)
      this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, this.texArray)
    }

    // Render each image
    for (let i = 0, texLayer = 0; i < images.length; i++) {
      const img = images[i]!

      // Skip images with invalid dimensions
      if (img.w <= 0 || img.h <= 0) continue

      // Use modulo to cycle through layers if we have more images than layers
      const layer = texLayer % TEX_ARRAY_SIZE
      texLayer++

      // Upload bitmap data to texture array layer
      this.gl.pixelStorei(this.gl.UNPACK_ROW_LENGTH, img.stride)

      this.gl.texSubImage3D(
        this.gl.TEXTURE_2D_ARRAY,
        0,
        0, 0, layer, // x, y, z offset
        img.w,
        img.h,
        1, // depth (1 layer)
        this.gl.RED,
        this.gl.UNSIGNED_BYTE,
        heap,
        img.bitmap
      )

      this.gl.pixelStorei(this.gl.UNPACK_ROW_LENGTH, 0)

      // Set uniforms
      this.gl.uniform4f(this.u_destRect, img.dst_x, img.dst_y, img.w, img.h)
      this.gl.uniform1f(this.u_texLayer, layer)

      // color (RGBA from 0xRRGGBBAA)
      this.gl.uniform4f(
        this.u_color,
        ((img.color >>> 24) & 0xFF) / 255,
        ((img.color >>> 16) & 0xFF) / 255,
        ((img.color >>> 8) & 0xFF) / 255,
        (img.color & 0xFF) / 255
      )

      // 6 vertices for quad
      this.gl.drawArrays(this.gl.TRIANGLES, 0, 6)
    }
  }

  destroy () {
    if (this.gl) {
      if (this.texArray) {
        this.gl.deleteTexture(this.texArray)
        this.texArray = null
      }

      if (this.vao) {
        this.gl.deleteVertexArray(this.vao)
        this.vao = null
      }

      if (this.program) {
        this.gl.deleteProgram(this.program)
        this.program = null
      }

      this.gl = null
    }
  }
}
