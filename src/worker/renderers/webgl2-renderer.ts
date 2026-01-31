// fallback for browsers that don't support WebGL2
import { colorMatrixConversionMap, IDENTITY_MATRIX, IS_FIREFOX, SHOULD_REFERENCE_MEMORY, type ASSImage } from '../util.ts'

declare const self: DedicatedWorkerGlobalScope &
  typeof globalThis & {
    HEAPU8RAW: Uint8Array<ArrayBuffer>
    WASMMEMORY: WebAssembly.Memory
  }

// GLSL ES 3.0 Vertex Shader with Instancing
const VERTEX_SHADER = /* glsl */`#version 300 es
precision mediump float;

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
in vec4 a_color;     // r, g, b, a
in float a_texLayer;

flat out vec2 v_destXY;
flat out vec4 v_color;
flat out vec2 v_texSize;
flat out float v_texLayer;

void main() {
  vec2 quadPos = QUAD_POSITIONS[gl_VertexID];
  vec2 pixelPos = a_destRect.xy + quadPos * a_destRect.zw;
  vec2 clipPos = (pixelPos / u_resolution) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;

  gl_Position = vec4(clipPos, 0.0, 1.0);
  v_destXY = a_destRect.xy;
  v_color = a_color;
  v_texSize = a_destRect.zw;
  v_texLayer = a_texLayer;
}
`

// GLSL ES 3.0 Fragment Shader - use texelFetch for pixel-perfect sampling
const FRAGMENT_SHADER = /* glsl */`#version 300 es
precision mediump float;
precision mediump sampler2DArray;

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
    discard;
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
const MAX_INSTANCES = 256 // Maximum instances per draw call

export class WebGL2Renderer {
  canvas: OffscreenCanvas | null = null
  gl: WebGL2RenderingContext | null = null
  program: WebGLProgram | null = null
  vao: WebGLVertexArrayObject | null = null

  // Uniform locations
  u_resolution: WebGLUniformLocation | null = null
  u_texArray: WebGLUniformLocation | null = null
  u_colorMatrix: WebGLUniformLocation | null = null

  // Instance attribute buffers
  instanceDestRectBuffer: WebGLBuffer | null = null
  instanceColorBuffer: WebGLBuffer | null = null
  instanceTexLayerBuffer: WebGLBuffer | null = null

  // Instance data arrays
  instanceDestRectData: Float32Array
  instanceColorData: Float32Array
  instanceTexLayerData: Float32Array

  texArray: WebGLTexture | null = null
  texArrayWidth = 0
  texArrayHeight = 0

  colorMatrix: Float32Array = IDENTITY_MATRIX

  constructor () {
    this.instanceDestRectData = new Float32Array(MAX_INSTANCES * 4)
    this.instanceColorData = new Float32Array(MAX_INSTANCES * 4)
    this.instanceTexLayerData = new Float32Array(MAX_INSTANCES)
  }

  _scheduledResize?: { width: number, height: number }

  resizeCanvas (width: number, height: number) {
    // WebGL2 doesn't allow 0-sized canvases
    if (width <= 0 || height <= 0) return

    this._scheduledResize = { width, height }
  }

  setCanvas (canvas: OffscreenCanvas) {
    this.canvas = canvas
    this.gl = canvas.getContext('webgl2', {
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
    this.u_texArray = this.gl.getUniformLocation(this.program, 'u_texArray')
    this.u_colorMatrix = this.gl.getUniformLocation(this.program, 'u_colorMatrix')

    // Create instance attribute buffers
    this.instanceDestRectBuffer = this.gl.createBuffer()
    this.instanceColorBuffer = this.gl.createBuffer()
    this.instanceTexLayerBuffer = this.gl.createBuffer()

    // Create a VAO (required for WebGL2)
    this.vao = this.gl.createVertexArray()
    this.gl.bindVertexArray(this.vao)

    // Setup instance attributes
    const destRectLoc = this.gl.getAttribLocation(this.program, 'a_destRect')
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceDestRectBuffer)
    this.gl.enableVertexAttribArray(destRectLoc)
    this.gl.vertexAttribPointer(destRectLoc, 4, this.gl.FLOAT, false, 0, 0)
    this.gl.vertexAttribDivisor(destRectLoc, 1)

    const colorLoc = this.gl.getAttribLocation(this.program, 'a_color')
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceColorBuffer)
    this.gl.enableVertexAttribArray(colorLoc)
    this.gl.vertexAttribPointer(colorLoc, 4, this.gl.FLOAT, false, 0, 0)
    this.gl.vertexAttribDivisor(colorLoc, 1)

    const texLayerLoc = this.gl.getAttribLocation(this.program, 'a_texLayer')
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceTexLayerBuffer)
    this.gl.enableVertexAttribArray(texLayerLoc)
    this.gl.vertexAttribPointer(texLayerLoc, 1, this.gl.FLOAT, false, 0, 0)
    this.gl.vertexAttribDivisor(texLayerLoc, 1)

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
      null // Firefox cries about uninitialized data, but is slower with zero initialized data...
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

    // HACK 1 and 2 [see above for explanation]
    if ((self.HEAPU8RAW.buffer !== self.WASMMEMORY.buffer) || SHOULD_REFERENCE_MEMORY) {
      heap = self.HEAPU8RAW = new Uint8Array(self.WASMMEMORY.buffer)
    }

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
    let maxW = this.texArrayWidth
    let maxH = this.texArrayHeight
    const validImages: ASSImage[] = []

    for (const img of images) {
      if (img.w <= 0 || img.h <= 0) continue
      validImages.push(img)
      if (img.w > maxW) maxW = img.w
      if (img.h > maxH) maxH = img.h
    }

    if (validImages.length === 0) return

    // Resize texture array if needed
    if (maxW > this.texArrayWidth || maxH > this.texArrayHeight) {
      this.createTexArray(maxW, maxH)
    }

    // Process images in chunks that fit within texture array size
    const batchSize = Math.min(TEX_ARRAY_SIZE, MAX_INSTANCES)

    for (let batchStart = 0; batchStart < validImages.length; batchStart += batchSize) {
      const batchEnd = Math.min(batchStart + batchSize, validImages.length)
      let instanceCount = 0

      // Upload textures for this batch
      for (let i = batchStart; i < batchEnd; i++) {
        const img = validImages[i]!
        const layer = instanceCount

        // Upload bitmap data to texture array layer
        this.gl.pixelStorei(this.gl.UNPACK_ROW_LENGTH, img.stride)

        if (IS_FIREFOX) {
          // HACK 3 [see above for explanation]
          const sourceView = new Uint8Array(heap.buffer, img.bitmap, img.stride * img.h)
          const bitmapData = new Uint8Array(sourceView)

          this.gl.texSubImage3D(
            this.gl.TEXTURE_2D_ARRAY,
            0,
            0, 0, layer, // x, y, z offset
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
            0, 0, layer, // x, y, z offset
            img.w,
            img.h,
            1, // depth (1 layer)
            this.gl.RED,
            this.gl.UNSIGNED_BYTE,
            heap,
            img.bitmap
          )
        }
        // Fill instance data
        const idx = instanceCount * 4
        this.instanceDestRectData[idx] = img.dst_x
        this.instanceDestRectData[idx + 1] = img.dst_y
        this.instanceDestRectData[idx + 2] = img.w
        this.instanceDestRectData[idx + 3] = img.h

        this.instanceColorData[idx] = ((img.color >>> 24) & 0xFF) / 255
        this.instanceColorData[idx + 1] = ((img.color >>> 16) & 0xFF) / 255
        this.instanceColorData[idx + 2] = ((img.color >>> 8) & 0xFF) / 255
        this.instanceColorData[idx + 3] = (img.color & 0xFF) / 255

        this.instanceTexLayerData[instanceCount] = layer

        instanceCount++
      }

      this.gl.pixelStorei(this.gl.UNPACK_ROW_LENGTH, 0)

      if (instanceCount === 0) continue
      // Upload instance data to buffers
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceDestRectBuffer)
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceDestRectData.subarray(0, instanceCount * 4), this.gl.DYNAMIC_DRAW)

      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceColorBuffer)
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceColorData.subarray(0, instanceCount * 4), this.gl.DYNAMIC_DRAW)

      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceTexLayerBuffer)
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceTexLayerData.subarray(0, instanceCount), this.gl.DYNAMIC_DRAW)

      // Single instanced draw call
      this.gl.drawArraysInstanced(this.gl.TRIANGLES, 0, 6, instanceCount)
    }
  }

  destroy () {
    if (this.gl) {
      if (this.texArray) {
        this.gl.deleteTexture(this.texArray)
        this.texArray = null
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
