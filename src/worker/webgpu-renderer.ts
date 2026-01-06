import type { ASSImage } from '../jassub'

const IDENTITY_MATRIX = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0
])

// Color matrix conversion map - mat3x3 pre-padded for WGSL (each column padded to vec4f)
// Each matrix converts FROM the key color space TO the nested key color space
export const colorMatrixConversionMap = {
  BT601: {
    BT709: new Float32Array([
      1.0863, 0.0965, -0.0141, 0,
      -0.0723, 0.8451, -0.0277, 0,
      -0.014, 0.0584, 1.0418, 0
    ]),
    BT601: IDENTITY_MATRIX
  },
  BT709: {
    BT601: new Float32Array([
      0.9137, -0.1049, 0.0096, 0,
      0.0784, 1.1722, 0.0322, 0,
      0.0079, -0.0671, 0.9582, 0
    ]),
    BT709: IDENTITY_MATRIX
  },
  FCC: {
    BT709: new Float32Array([
      1.0873, 0.0974, -0.0127, 0,
      -0.0736, 0.8494, -0.0251, 0,
      -0.0137, 0.0531, 1.0378, 0
    ]),
    BT601: new Float32Array([
      1.001, 0.0009, 0.0013, 0,
      -0.0008, 1.005, 0.0027, 0,
      -0.0002, -0.006, 0.996, 0
    ])
  },
  SMPTE240M: {
    BT709: new Float32Array([
      0.9993, -0.0004, -0.0034, 0,
      0.0006, 0.9812, -0.0114, 0,
      0.0001, 0.0192, 1.0148, 0
    ]),
    BT601: new Float32Array([
      0.913, -0.1051, 0.0063, 0,
      0.0774, 1.1508, 0.0207, 0,
      0.0096, -0.0456, 0.973, 0
    ])
  }
} as const

export type ColorSpace = keyof typeof colorMatrixConversionMap

// WGSL Vertex Shader
const VERTEX_SHADER = /* wgsl */`
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) destXY: vec2f,   // destination top-left (flat, no interpolation)
  @location(1) @interpolate(flat) color: vec4f,
  @location(2) @interpolate(flat) texSize: vec2f,
}

struct Uniforms {
  resolution: vec2f,
}

struct ImageData {
  destRect: vec4f,   // x, y, w, h
  srcInfo: vec4f,    // texW, texH, stride, 0
  color: vec4f,      // RGBA
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> imageData: ImageData;

// Quad vertices (two triangles)
const QUAD_POSITIONS = array<vec2f, 6>(
  vec2f(0.0, 0.0),
  vec2f(1.0, 0.0),
  vec2f(0.0, 1.0),
  vec2f(1.0, 0.0),
  vec2f(1.0, 1.0),
  vec2f(0.0, 1.0)
);

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var output: VertexOutput;
  
  let quadPos = QUAD_POSITIONS[vertexIndex];
  let wh = imageData.destRect.zw;
  
  // Calculate pixel position
  let pixelPos = imageData.destRect.xy + quadPos * wh;
  
  // Convert to clip space (-1 to 1)
  var clipPos = (pixelPos / uniforms.resolution) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;  // Flip Y for canvas coordinates
  
  output.position = vec4f(clipPos, 0.0, 1.0);
  output.destXY = imageData.destRect.xy;
  output.color = imageData.color;
  output.texSize = imageData.srcInfo.xy;
  
  return output;
}
`

// WGSL Fragment Shader - use textureLoad with integer coords for pixel-perfect sampling
const FRAGMENT_SHADER = /* wgsl */`
@group(0) @binding(3) var tex: texture_2d<f32>;
@group(0) @binding(4) var<uniform> colorMatrix: mat3x3f;

struct FragmentInput {
  @builtin(position) fragCoord: vec4f,
  @location(0) @interpolate(flat) destXY: vec2f,
  @location(1) @interpolate(flat) color: vec4f,
  @location(2) @interpolate(flat) texSize: vec2f,
}

@fragment
fn fragmentMain(input: FragmentInput) -> @location(0) vec4f {
  // Calculate integer texel coordinates from fragment position
  // fragCoord.xy is the pixel center (e.g., 0.5, 1.5, 2.5...)
  let texCoord = vec2i(floor(input.fragCoord.xy - input.destXY));
  
  // Bounds check (should not be needed but prevents any out-of-bounds access)
  let texSizeI = vec2i(input.texSize);
  if (texCoord.x < 0 || texCoord.y < 0 || texCoord.x >= texSizeI.x || texCoord.y >= texSizeI.y) {
    return vec4f(0.0);
  }
  
  // Load texel directly using integer coordinates - no interpolation, no precision issues
  let mask = textureLoad(tex, texCoord, 0).r;
  
  // Apply color matrix conversion (identity if no conversion needed)
  let correctedColor = colorMatrix * input.color.rgb;
  
  // libass color alpha: 0 = opaque, 255 = transparent (inverted)
  let colorAlpha = 1.0 - input.color.a;
  
  // Final alpha = colorAlpha * mask (like libass: alpha * mask)
  let a = colorAlpha * mask;
  
  // Premultiplied alpha output
  return vec4f(correctedColor * a, a);
}
`

interface TextureInfo {
  texture: GPUTexture
  view: GPUTextureView
  width: number
  height: number
}

export class WebGPURenderer {
  device: GPUDevice | null = null
  context: GPUCanvasContext | null = null
  pipeline: GPURenderPipeline | null = null
  bindGroupLayout: GPUBindGroupLayout | null = null

  // Uniform buffer
  uniformBuffer: GPUBuffer | null = null

  // Color matrix buffer (mat3x3f = 48 bytes with padding)
  colorMatrixBuffer: GPUBuffer | null = null

  // Image data buffers (created on-demand, one per image)
  imageDataBuffers: GPUBuffer[] = []

  // Textures created on-demand (no fixed limit)
  textures: TextureInfo[] = []
  pendingDestroyTextures: GPUTexture[] = []

  // eslint-disable-next-line no-undef
  format: GPUTextureFormat = 'bgra8unorm'
  _ready

  constructor () {
    // Start async initialization immediately
    this._ready = (async () => {
    // Check WebGPU support
      if (!navigator.gpu) {
        throw new Error('WebGPU not supported')
      }

      const adapter = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance'
      })

      if (!adapter) {
        throw new Error('No WebGPU adapter found')
      }

      this.device = await adapter.requestDevice()
      this.format = navigator.gpu.getPreferredCanvasFormat()

      // Create shader modules
      const vertexModule = this.device.createShaderModule({
        code: VERTEX_SHADER
      })

      const fragmentModule = this.device.createShaderModule({
        code: FRAGMENT_SHADER
      })

      // Create uniform buffer
      this.uniformBuffer = this.device.createBuffer({
        size: 16, // vec2f resolution + padding
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      })

      // Create color matrix buffer (mat3x3f requires 48 bytes: 3 vec3f padded to vec4f each)
      this.colorMatrixBuffer = this.device.createBuffer({
        size: 48, // 3 x vec4f (each column is vec3f padded to 16 bytes)
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      })
      // Initialize with identity matrix
      this.device.queue.writeBuffer(this.colorMatrixBuffer, 0, IDENTITY_MATRIX)

      // Create bind group layout (no sampler needed - using textureLoad for pixel-perfect sampling)
      this.bindGroupLayout = this.device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX,
            buffer: { type: 'uniform' }
          },
          {
            binding: 1,
            visibility: GPUShaderStage.VERTEX,
            buffer: { type: 'read-only-storage' }
          },
          {
            binding: 3,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: 'unfilterable-float' } // textureLoad requires unfilterable
          },
          {
            binding: 4,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' }
          }
        ]
      })

      // Create pipeline layout
      const pipelineLayout = this.device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout]
      })

      // Create render pipeline
      this.pipeline = this.device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
          module: vertexModule,
          entryPoint: 'vertexMain'
        },
        fragment: {
          module: fragmentModule,
          entryPoint: 'fragmentMain',
          targets: [
            {
              format: this.format,
              blend: {
                color: {
                  srcFactor: 'one',
                  dstFactor: 'one-minus-src-alpha',
                  operation: 'add'
                },
                alpha: {
                  srcFactor: 'one',
                  dstFactor: 'one-minus-src-alpha',
                  operation: 'add'
                }
              }
            }
          ]
        },
        primitive: {
          topology: 'triangle-list'
        }
      })
    })()
  }

  async setCanvas (canvas: OffscreenCanvas, width: number, height: number) {
    await this._ready
    if (!this.device) return

    // WebGPU doesn't allow 0-sized textures/swapchains
    if (width <= 0 || height <= 0) return

    canvas.width = width
    canvas.height = height

    if (!this.context) {
    // Get canvas context
      this.context = canvas.getContext('webgpu')
      if (!this.context) {
        throw new Error('Could not get WebGPU context')
      }

      this.context.configure({
        device: this.device,
        format: this.format,
        alphaMode: 'premultiplied'
      })
    }

    // Update uniform buffer with resolution
    this.device.queue.writeBuffer(
      this.uniformBuffer!,
      0,
      new Float32Array([width, height])
    )
  }

  /**
   * Set the color matrix for color space conversion.
   * Pass null or undefined to use identity (no conversion).
   * Matrix should be a pre-padded Float32Array with 12 values (3 columns × 4 floats each).
   */
  async setColorMatrix (matrix?: Float32Array<ArrayBuffer>) {
    await this._ready
    if (!this.device) return
    this.device.queue.writeBuffer(this.colorMatrixBuffer!, 0, matrix ?? IDENTITY_MATRIX)
  }

  private createTextureInfo (width: number, height: number): TextureInfo {
    const texture = this.device!.createTexture({
      size: [width, height],
      format: 'r8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    })

    return {
      texture,
      view: texture.createView(),
      width,
      height
    }
  }

  render (images: ASSImage[], heap: Uint8Array): void {
    if (!this.device || !this.context || !this.pipeline) return

    // getCurrentTexture fails if canvas has 0 dimensions
    const currentTexture = this.context.getCurrentTexture()
    if (currentTexture.width === 0 || currentTexture.height === 0) return

    const commandEncoder = this.device.createCommandEncoder()

    const textureView = currentTexture.createView()

    // Begin render pass
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store'
        }
      ]
    })

    renderPass.setPipeline(this.pipeline)

    // Grow arrays if needed
    while (this.textures.length < images.length) {
      this.textures.push(this.createTextureInfo(64, 64))
    }
    while (this.imageDataBuffers.length < images.length) {
      this.imageDataBuffers.push(this.device.createBuffer({
        size: 48, // 3 x vec4f
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      }))
    }

    // Render each image
    for (let i = 0, texIndex = -1; i < images.length; i++) {
      const img = images[i]!

      // Skip images with invalid dimensions (WebGPU doesn't allow 0-sized textures)
      if (img.w <= 0 || img.h <= 0) continue

      let texInfo = this.textures[++texIndex]!

      // Recreate texture if size changed (use actual w, not stride)
      if (texInfo.width !== img.w || texInfo.height !== img.h) {
        // Defer destruction until after submit to avoid destroying textures still in use
        this.pendingDestroyTextures.push(texInfo.texture)
        texInfo = this.createTextureInfo(img.w, img.h)
        this.textures[texIndex] = texInfo
      }

      // Upload bitmap data using bytesPerRow to handle stride
      // Only need stride * (h-1) + w bytes per ASS spec
      // this... didnt work, is the used alternative bad?
      // const dataSize = img.stride * (img.h - 1) + img.w
      // const bitmapData = heap.subarray(img.bitmap, img.bitmap + dataSize)

      // this.device.queue.writeTexture(
      //   { texture: texInfo.texture },
      //   bitmapData as unknown as ArrayBuffer,
      //   { bytesPerRow: img.stride }, // Source rows are stride bytes apart
      //   { width: img.w, height: img.h } // But we only copy w pixels per row
      // )

      this.device.queue.writeTexture(
        { texture: texInfo.texture },
        heap.buffer,
        { bytesPerRow: img.stride, offset: img.bitmap }, // Source rows are stride bytes apart
        { width: img.w, height: img.h } // But we only copy w pixels per row
      )

      // Update image data buffer
      const imageData = new Float32Array([
        // destRect
        img.dst_x, img.dst_y, img.w, img.h,
        // srcInfo
        img.w, img.h, img.stride, 0,
        // color (RGBA from 0xRRGGBBAA)
        ((img.color >>> 24) & 0xFF) / 255,
        ((img.color >>> 16) & 0xFF) / 255,
        ((img.color >>> 8) & 0xFF) / 255,
        (img.color & 0xFF) / 255
      ])

      const imageBuffer = this.imageDataBuffers[texIndex]!
      this.device.queue.writeBuffer(imageBuffer, 0, imageData)

      // Create bind group for this image (no sampler - using textureLoad)
      const bindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayout!,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer! } },
          { binding: 1, resource: { buffer: imageBuffer } },
          { binding: 3, resource: texInfo.view },
          { binding: 4, resource: { buffer: this.colorMatrixBuffer! } }
        ]
      })

      renderPass.setBindGroup(0, bindGroup)
      renderPass.draw(6) // 6 vertices for quad
    }

    renderPass.end()

    this.device.queue.submit([commandEncoder.finish()])

    // Now safe to destroy old textures
    for (const tex of this.pendingDestroyTextures) {
      tex.destroy()
    }
    this.pendingDestroyTextures = []
  }

  destroy () {
    for (const tex of this.textures) {
      tex.texture.destroy()
    }
    this.textures = []

    this.uniformBuffer?.destroy()
    this.colorMatrixBuffer?.destroy()
    for (const buf of this.imageDataBuffers) {
      buf.destroy()
    }
    this.imageDataBuffers = []

    this.device?.destroy()
    this.device = null
    this.context = null
  }
}
