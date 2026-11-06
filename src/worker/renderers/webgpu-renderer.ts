// WARN:
// This has been deprecated as WebGL is simply faster
// The masks go into one storage buffer, and the fragment shader reads their bytes directly.
// This removes the atlas packing and the texture uploads. The new masks of a frame go into a mapped upload buffer with one CPU copy,
// then the GPU copies them to the bitmap buffer, and one instanced draw renders the frame.
import { CanvasRendererBase } from './canvas-base.ts'
import { MAX_ATLAS_SCREENS } from './webgl-base.ts'

import type { ASSImage } from '../util.ts'

const SHADER = /* wgsl */`
struct Uniforms {
  colorMatrix: mat3x3f,
  colorOffset: vec3f,
  resolution: vec2f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) origin: vec2f,
  // byte offset of the mask in the bitmap buffer, then the stride of the mask
  @location(1) @interpolate(flat) bitmap: vec2u,
  // premultiplied color
  @location(2) @interpolate(flat) color: vec4f,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> bitmaps: array<u32>;

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) dest: vec2i,
  @location(1) size: vec2u,
  @location(2) bitmap: vec2u,
  // libass 0xRRGGBBAA, read as little-endian bytes, so this is (A, B, G, R)
  @location(3) color: vec4f,
) -> VertexOutput {
  // triangle strip corners: (0, 0), (1, 0), (0, 1), (1, 1)
  let corner = vec2f(f32(vertexIndex & 1u), f32(vertexIndex >> 1u));
  let pixel = vec2f(dest) + corner * vec2f(size);

  var output: VertexOutput;
  output.position = vec4f(pixel / uniforms.resolution * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 0.0, 1.0);
  output.origin = vec2f(dest);
  output.bitmap = bitmap;

  // The color is the same for the full image, so convert it once per vertex and not once per pixel.
  // libass alpha: 0 is opaque, 255 is transparent
  let alpha = 1.0 - color.x;
  let rgb = clamp(uniforms.colorMatrix * color.wzy + uniforms.colorOffset, vec3f(0.0), vec3f(1.0));
  output.color = vec4f(rgb * alpha, alpha);
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  // position.xy is the pixel center, the quad starts on a whole pixel, so the conversion floors to the texel
  let texel = vec2u(input.position.xy - input.origin);
  let index = input.bitmap.x + texel.y * input.bitmap.y + texel.x;
  let mask = f32((bitmaps[index >> 2u] >> ((index & 3u) * 8u)) & 0xFFu) / 255.0;
  return input.color * mask;
}
`

// dest (2 x i32), size (2 x u16), bitmap offset (u32), stride (u32), color (u32)
const INSTANCE_STRIDE = 24
const INSTANCE_WORDS = INSTANCE_STRIDE / 4
const INITIAL_INSTANCES = 256
// mat3x3f (3 padded columns), vec3f offset, vec2f resolution, padded to 16 bytes
const UNIFORM_FLOATS = 20
const MIN_BITMAP_BYTES = 1 << 20
const MIN_UPLOAD_BYTES = 1 << 16
const MAX_UPLOAD_BUFFERS = 3

const align8 = (value: number) => (value + 7) & ~7

// libass guarantees only stride * (h - 1) + w bytes for a bitmap
const bitmapBytes = (img: ASSImage) => img.stride * (img.h - 1) + img.w

// copies from a SharedArrayBuffer with relaxed atomics 8 bytes at a time only when the source and
// the destination have the same alignment, otherwise it copies 1 byte at a time
const slotBytes = (img: ASSImage) => align8(bitmapBytes(img) + 7)
const cacheKey = (img: ASSImage) => img.cache_id && `${img.cache_id}:${img.bitmap}:${img.w}:${img.h}:${img.stride}`

export class WebGPURenderer extends CanvasRendererBase {
  device!: GPUDevice
  context!: GPUCanvasContext
  pipeline!: GPURenderPipeline
  format!: GPUTextureFormat

  uniformBuffer!: GPUBuffer
  uniforms = new Float32Array(UNIFORM_FLOATS)
  uniformsDirty = true

  bindGroup!: GPUBindGroup
  bitmapBuffer!: GPUBuffer
  bitmapCapacity = 0
  // the next free byte in the bitmap buffer, the buffer is filled from the start and reset when it is full
  bitmapCursor = 0
  // cache key to the byte offset of the mask in the bitmap buffer
  bitmapCache = new Map<string, number>()
  // mapped buffers that copy the new masks to the GPU
  uploadBuffers: GPUBuffer[] = []
  // resolves when the GPU completes the last submitted frame
  lastFrame?: Promise<void>

  instanceBuffer!: GPUBuffer
  instanceCapacity = 0
  instanceData!: ArrayBuffer
  instanceInts!: Int32Array
  instanceWords!: Uint32Array

  static async isSupported (canvas: OffscreenCanvas) {
    try {
      const device = await WebGPURenderer.requestDevice()
      if (device) return new WebGPURenderer(canvas, device)
    } catch (e) {
      console.warn('JASSUB: could not start WebGPU', e)
    }
  }

  static async requestDevice () {
    const adapter = await navigator.gpu?.requestAdapter()
    if (!adapter) return
    return await adapter.requestDevice({
      requiredLimits: {
        maxBufferSize: adapter.limits.maxBufferSize,
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize
      }
    })
  }

  constructor (canvas: OffscreenCanvas, device: GPUDevice) {
    super(canvas)
    const context = canvas.getContext('webgpu')
    if (!context) throw new Error('Could not get WebGPU context')
    this.context = context
    this.format = navigator.gpu.getPreferredCanvasFormat()
    this._initDevice(device)
  }

  _initDevice (device: GPUDevice) {
    this.device = device
    this.context.configure({ device, format: this.format, alphaMode: 'premultiplied' })

    const module = device.createShaderModule({ code: SHADER })
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vertexMain',
        buffers: [{
          arrayStride: INSTANCE_STRIDE,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'sint32x2' },
            { shaderLocation: 1, offset: 8, format: 'uint16x2' },
            { shaderLocation: 2, offset: 12, format: 'uint32x2' },
            { shaderLocation: 3, offset: 20, format: 'unorm8x4' }
          ]
        }]
      },
      fragment: {
        module,
        entryPoint: 'fragmentMain',
        targets: [{
          format: this.format,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
          }
        }]
      },
      primitive: { topology: 'triangle-strip' }
    })

    this.uniformBuffer = device.createBuffer({ size: UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.uniformsDirty = true
    this.setColorConversion(this.colorMatrix)

    this.bitmapCapacity = 0
    this.instanceCapacity = 0
    // the buffers of a lost device destroy themselves when their mapAsync() fails
    this.uploadBuffers = []
    this.lastFrame = undefined
    this.ensureBitmapCapacity(MIN_BITMAP_BYTES)
    this.ensureInstanceCapacity(INITIAL_INSTANCES)

    // A lost device draws nothing, so start a new device and draw the last frame again.
    device.lost.then(async info => {
      if (info.reason === 'destroyed' || this.device !== device) return
      console.warn('JASSUB: WebGPU device lost', info.message)
      const next = await WebGPURenderer.requestDevice()
      if (!next || this.device !== device) return
      this._initDevice(next)
      this.canvas.dispatchEvent(new Event('webglcontextrestored'))
    }, () => {})
  }

  setColorConversion (matrix: Float32Array) {
    this.colorMatrix = matrix
    // WGSL pads each mat3x3f column and the vec3f offset to 4 floats
    for (let column = 0; column < 4; column++) {
      this.uniforms.set(matrix.subarray(column * 3, column * 3 + 3), column * 4)
    }
    this.uniformsDirty = true
  }

  ensureBitmapCapacity (bytes: number) {
    if (bytes <= this.bitmapCapacity) return

    this.bitmapBuffer?.destroy()
    this.bitmapCapacity = align8(bytes)
    this.bitmapBuffer = this.device.createBuffer({ size: this.bitmapCapacity, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    this.bitmapCache.clear()
    this.bitmapCursor = 0

    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.bitmapBuffer } }
      ]
    })
  }

  ensureInstanceCapacity (count: number) {
    if (count <= this.instanceCapacity) return

    this.instanceCapacity = Math.max(count, this.instanceCapacity * 2, INITIAL_INSTANCES)
    this.instanceData = new ArrayBuffer(this.instanceCapacity * INSTANCE_STRIDE)
    this.instanceInts = new Int32Array(this.instanceData)
    this.instanceWords = new Uint32Array(this.instanceData)
    this.instanceBuffer?.destroy()
    this.instanceBuffer = this.device.createBuffer({ size: this.instanceCapacity * INSTANCE_STRIDE, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
  }

  // Find the masks that are not in the bitmap buffer, and make sure they fit.
  // Return the maximum bytes to upload, or -1 if the frame cannot fit.
  reserveBitmaps (images: ASSImage[]) {
    let totalBytes = 0
    let missingBytes = 0
    for (const img of images) {
      const bytes = slotBytes(img)
      totalBytes += bytes
      const key = cacheKey(img)
      if (!key || !this.bitmapCache.has(key)) missingBytes += bytes
    }

    if (this.bitmapCursor + missingBytes <= this.bitmapCapacity) return missingBytes

    // The buffer is full, start again from the start with only the masks of this frame.
    // The GPU queue runs the writes after the draws of the earlier frames, so this does not change a frame in flight.
    this.bitmapCache.clear()
    this.bitmapCursor = 0
    if (totalBytes <= this.bitmapCapacity) return totalBytes

    const limit = Math.min(
      this.device.limits.maxStorageBufferBindingSize,
      this.device.limits.maxBufferSize,
      Math.max(MIN_BITMAP_BYTES, MAX_ATLAS_SCREENS * this.canvas.width * this.canvas.height)
    )
    if (totalBytes > limit) return -1

    // Room for 2 frames, so a frame with only some new masks does not start again each time.
    this.ensureBitmapCapacity(Math.min(limit, Math.max(totalBytes * 2, this.bitmapCapacity * 2)))
    return totalBytes
  }

  // The promise resolves when the GPU completes the previous frame. The main thread waits for it before it sends the next frame,
  // so a slow GPU drops frames instead of queuing them, and the worker thread does not block like with gl.finish().
  // The wait is for the previous frame, like gl.finish() at the start of a WebGL frame, so the GPU work of a frame
  // runs at the same time as libass renders the next frame.
  render (images: ASSImage[], heap: Uint8Array): Promise<void> | undefined {
    if (!this.device) return

    this.applyScheduledResize()
    if (this.uniforms[16] !== this.canvas.width || this.uniforms[17] !== this.canvas.height) {
      this.uniforms[16] = this.canvas.width
      this.uniforms[17] = this.canvas.height
      this.uniformsDirty = true
    }
    if (this.uniformsDirty) {
      this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniforms)
      this.uniformsDirty = false
    }

    let instanceCount = 0
    let uploadBuffer: GPUBuffer | undefined
    // reserveBitmaps() can start the bitmap buffer again, so read the start of the upload after it
    let uploadStart = 0
    if (images.length) {
      const uploadBytes = this.reserveBitmaps(images)
      if (uploadBytes < 0) {
        console.warn('JASSUB: frame exceeds WebGPU buffer capacity')
      } else {
        uploadStart = this.bitmapCursor
        if (uploadBytes) uploadBuffer = this.acquireUploadBuffer(uploadBytes)
        instanceCount = this.writeImages(images, heap, uploadBuffer, uploadBytes)
      }
    }

    const encoder = this.device.createCommandEncoder()
    // the GPU copies the new masks from the upload buffer to the bitmap buffer before the draw
    const uploadSize = this.bitmapCursor - uploadStart
    if (uploadBuffer && uploadSize > 0) {
      encoder.copyBufferToBuffer(uploadBuffer, 0, this.bitmapBuffer, uploadStart, uploadSize)
    }
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: [0, 0, 0, 0],
        loadOp: 'clear',
        storeOp: 'store'
      }]
    })
    if (instanceCount) {
      pass.setPipeline(this.pipeline)
      pass.setBindGroup(0, this.bindGroup)
      pass.setVertexBuffer(0, this.instanceBuffer)
      pass.draw(4, instanceCount)
    }
    pass.end()
    this.device.queue.submit([encoder.finish()])
    if (uploadBuffer) this.releaseUploadBuffer(uploadBuffer)

    const previous = this.lastFrame
    this.lastFrame = this.device.queue.onSubmittedWorkDone()
    return previous
  }

  // Copy the new masks to the mapped upload buffer and fill the instance data. Return the instance count.
  writeImages (images: ASSImage[], heap: Uint8Array, uploadBuffer: GPUBuffer | undefined, uploadBytes: number) {
    this.ensureInstanceCapacity(images.length)

    // The mapped range is shared memory with the GPU process, so this is the only CPU copy of a mask.
    const upload = uploadBuffer && new Uint8Array(uploadBuffer.getMappedRange(0, uploadBytes))
    const uploadStart = this.bitmapCursor

    const ints = this.instanceInts
    const words = this.instanceWords
    for (let i = 0; i < images.length; i++) {
      const img = images[i]!
      const key = cacheKey(img)
      let offset = key ? this.bitmapCache.get(key) : undefined

      if (offset === undefined) {
        offset = this.bitmapCursor + (img.bitmap & 7)
        upload!.set(heap.subarray(img.bitmap, img.bitmap + bitmapBytes(img)), offset - uploadStart)
        this.bitmapCursor += slotBytes(img)
        if (key) this.bitmapCache.set(key, offset)
      }

      const base = i * INSTANCE_WORDS
      ints[base] = img.dst_x
      ints[base + 1] = img.dst_y
      words[base + 2] = img.w | (img.h << 16)
      words[base + 3] = offset
      words[base + 4] = img.stride
      words[base + 5] = img.color
    }

    uploadBuffer?.unmap()
    this.device.queue.writeBuffer(this.instanceBuffer, 0, this.instanceData, 0, images.length * INSTANCE_STRIDE)

    return images.length
  }

  // Take the smallest mapped upload buffer that holds size bytes, or make a new one.
  acquireUploadBuffer (size: number) {
    let best = -1
    for (let i = 0; i < this.uploadBuffers.length; i++) {
      const buffer = this.uploadBuffers[i]!
      if (buffer.size >= size && (best < 0 || buffer.size < this.uploadBuffers[best]!.size)) best = i
    }
    if (best >= 0) return this.uploadBuffers.splice(best, 1)[0]!

    // a power of 2 size lets later frames of a different size use the buffer again
    return this.device.createBuffer({
      size: Math.max(MIN_UPLOAD_BYTES, 2 ** Math.ceil(Math.log2(size))),
      usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true
    })
  }

  // Map the upload buffer again when the GPU completes the copy, then keep it for a later frame.
  releaseUploadBuffer (buffer: GPUBuffer) {
    const device = this.device
    buffer.mapAsync(GPUMapMode.WRITE).then(() => {
      if (this.device !== device) return buffer.destroy()
      this.uploadBuffers.push(buffer)
      // keep the largest buffers, a frame needs only 1 or 2 when the GPU keeps up
      if (this.uploadBuffers.length > MAX_UPLOAD_BUFFERS) {
        this.uploadBuffers.sort((a, b) => b.size - a.size)
        this.uploadBuffers.pop()!.destroy()
      }
    }, () => buffer.destroy())
  }

  destroy () {
    this.bitmapCache.clear()
    if (!this.device) return
    const device = this.device
    this.device = null!
    this.context.unconfigure()
    for (const buffer of this.uploadBuffers) buffer.destroy()
    this.uploadBuffers = []
    device.destroy()
    this.bitmapBuffer = this.instanceBuffer = this.uniformBuffer = this.bindGroup = this.pipeline = null!
    this.lastFrame = undefined
  }
}
