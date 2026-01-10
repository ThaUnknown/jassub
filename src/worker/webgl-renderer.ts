import type { ASSImage } from '../jassub'

declare const self: DedicatedWorkerGlobalScope &
  typeof globalThis & {
    HEAPU8RAW: Uint8Array<ArrayBuffer>
    WASMMEMORY: WebAssembly.Memory
  }

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

// GLSL Vertex Shader
const VERTEX_SHADER = `#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform vec4 u_destRect;    // x, y, w, h
uniform vec4 u_color;       // RGBA

out vec2 v_texCoord;
out vec4 v_color;

// Quad vertices (0,0 to 1,1)
const vec2 QUAD_POSITIONS[6] = vec2[6](
    vec2(0.0, 0.0),
    vec2(1.0, 0.0),
    vec2(0.0, 1.0),
    vec2(1.0, 0.0),
    vec2(1.0, 1.0),
    vec2(0.0, 1.0)
);

void main() {
    vec2 quadPos = QUAD_POSITIONS[gl_VertexID];
    
    // Calculate pixel position
    vec2 pixelPos = u_destRect.xy + quadPos * u_destRect.zw;
    
    // Convert to clip space (-1 to 1)
    vec2 clipPos = (pixelPos / u_resolution) * 2.0 - 1.0;
    clipPos.y = -clipPos.y;  // Flip Y for canvas coordinates
    
    gl_Position = vec4(clipPos, 0.0, 1.0);
    v_texCoord = quadPos;
    v_color = u_color;
}
`

// GLSL Fragment Shader
const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform mat3 u_colorMatrix;

in vec2 v_texCoord;
in vec4 v_color;

out vec4 fragColor;

void main() {
    // Sample texture
    float mask = texture(u_texture, v_texCoord).r;
    
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

interface TextureInfo {
    texture: WebGLTexture
    width: number
    height: number
}

export class WebGL2Renderer {
  gl: WebGL2RenderingContext | null = null
  program: WebGLProgram | null = null
  vao: WebGLVertexArrayObject | null = null

  // Uniform locations
  u_resolution: WebGLUniformLocation | null = null
  u_destRect: WebGLUniformLocation | null = null
  u_color: WebGLUniformLocation | null = null
  u_texture: WebGLUniformLocation | null = null
  u_colorMatrix: WebGLUniformLocation | null = null

  // Textures created on-demand (no fixed limit)
  textures: TextureInfo[] = []

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
        stencil: false
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

      // Get uniform locations
      this.u_resolution = this.gl.getUniformLocation(this.program, 'u_resolution')
      this.u_destRect = this.gl.getUniformLocation(this.program, 'u_destRect')
      this.u_color = this.gl.getUniformLocation(this.program, 'u_color')
      this.u_texture = this.gl.getUniformLocation(this.program, 'u_texture')
      this.u_colorMatrix = this.gl.getUniformLocation(this.program, 'u_colorMatrix')

      // Create a VAO (required for WebGL2)
      this.vao = this.gl.createVertexArray()
      this.gl.bindVertexArray(this.vao)

      // Set up blending for premultiplied alpha
      this.gl.enable(this.gl.BLEND)
      this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA)

      // Use the program
      this.gl.useProgram(this.program)

      // Set texture unit
      this.gl.uniform1i(this.u_texture, 0)

      // Set initial color matrix
      this.gl.uniformMatrix3fv(this.u_colorMatrix, false, this.colorMatrix)

      // Set one-time GL state
      this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1)
      this.gl.clearColor(0, 0, 0, 0)
      this.gl.activeTexture(this.gl.TEXTURE0)
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

  createTextureInfo (width: number, height: number): TextureInfo {
    const texture = this.gl!.createTexture()

    this.gl!.bindTexture(this.gl!.TEXTURE_2D, texture)

    // Set texture parameters for nearest-neighbor sampling (pixel-perfect)
    this.gl!.texParameteri(this.gl!.TEXTURE_2D, this.gl!.TEXTURE_MIN_FILTER, this.gl!.NEAREST)
    this.gl!.texParameteri(this.gl!.TEXTURE_2D, this.gl!.TEXTURE_MAG_FILTER, this.gl!.NEAREST)
    this.gl!.texParameteri(this.gl!.TEXTURE_2D, this.gl!.TEXTURE_WRAP_S, this.gl!.CLAMP_TO_EDGE)
    this.gl!.texParameteri(this.gl!.TEXTURE_2D, this.gl!.TEXTURE_WRAP_T, this.gl!.CLAMP_TO_EDGE)

    return {
      texture,
      width,
      height
    }
  }

  render (images: ASSImage[], heap: Uint8Array): void {
    if (!this.gl || !this.program || !this.vao) return

    // Hack: work around shared memory issues, webGL doesnt support shared memory, so there are race conditions when growing memory
    if (self.HEAPU8RAW.buffer !== self.WASMMEMORY.buffer) {
      heap = self.HEAPU8RAW = new Uint8Array(self.WASMMEMORY.buffer)
    }

    // Clear canvas
    this.gl.clear(this.gl.COLOR_BUFFER_BIT)

    // Grow texture array if needed
    while (this.textures.length < images.length) {
      this.textures.push(this.createTextureInfo(64, 64))
    }

    // Render each image
    for (let i = 0, texIndex = -1; i < images.length; i++) {
      const img = images[i]!

      // Skip images with invalid dimensions
      if (img.w <= 0 || img.h <= 0) continue

      const texInfo = this.textures[++texIndex]!

      // Bind texture
      this.gl.bindTexture(this.gl.TEXTURE_2D, texInfo.texture)

      // Upload bitmap data using bytesPerRow to handle stride
      // Only need stride * (h-1) + w bytes per ASS spec
      this.gl.pixelStorei(this.gl.UNPACK_ROW_LENGTH, img.stride) // Source rows are stride bytes apart

      // Recreate texture if size changed (use actual w, not stride)
      if (texInfo.width === img.w && texInfo.height === img.h) {
        this.gl.texSubImage2D(
          this.gl.TEXTURE_2D,
          0,
          0,
          0,
          img.w, // But we only copy w pixels per row
          img.h,
          this.gl.RED,
          this.gl.UNSIGNED_BYTE,
          heap,
          img.bitmap
        )
      } else {
        this.gl.texImage2D(
          this.gl.TEXTURE_2D,
          0,
          this.gl.R8,
          img.w,
          img.h,
          0,
          this.gl.RED,
          this.gl.UNSIGNED_BYTE,
          heap,
          img.bitmap
        )
        texInfo.width = img.w
        texInfo.height = img.h
      }

      // Reset unpack parameters
      this.gl.pixelStorei(this.gl.UNPACK_ROW_LENGTH, 0)

      // destRect
      this.gl.uniform4f(
        this.u_destRect,
        img.dst_x,
        img.dst_y,
        img.w,
        img.h
      )

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
      for (const tex of this.textures) {
        this.gl.deleteTexture(tex.texture)
      }
      this.textures = []

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
