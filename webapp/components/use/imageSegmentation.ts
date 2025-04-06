import { ImageSegmenter, type ImageSegmenterResult } from '@mediapipe/tasks-vision'

// import mediapipe wasm files as url https://vite.dev/guide/assets#explicit-url-imports
import wasmLoaderPath from '@mediapipe/tasks-vision/wasm/vision_wasm_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm?url'

import backgroundImgSrc from '@/assets/background.jpg?url'
import modelAssetPath from '@/assets/models/selfie_multiclass_256x256.tflite?url'

const wasmFileset = {
  wasmLoaderPath,
  wasmBinaryPath
}

export class VirtualBackgroundStream {
  private deviceId: string
  private webcamRunning: boolean
  private segmenter: ImageSegmenter | null
  private backgroundImage: HTMLImageElement
  private videoWidth: number
  private videoHeight: number

  private video: HTMLVideoElement
  private canvas: HTMLCanvasElement
  private canvasCtx: CanvasRenderingContext2D
  private tempCanvas: HTMLCanvasElement
  private tempCtx: CanvasRenderingContext2D
  private tempCanvas2: HTMLCanvasElement
  private tempCtx2: CanvasRenderingContext2D
  private tempCanvas3: HTMLCanvasElement
  private tempCtx3: CanvasRenderingContext2D

  constructor(deviceId: string) {
    this.deviceId = deviceId
    this.webcamRunning = false
    this.segmenter = null
    this.backgroundImage = new Image()
    this.backgroundImage.src = backgroundImgSrc
    if (window.matchMedia('(orientation: portrait)').matches) {
      this.videoWidth = 480
      this.videoHeight = 640
    } else {
      this.videoWidth = 640
      this.videoHeight = 480
    }

    this.video = document.createElement('video')

    this.canvas = document.createElement('canvas')
    this.canvas.width = this.videoWidth
    this.canvas.height = this.videoHeight
    this.canvasCtx = this.canvas.getContext('2d')!

    this.tempCanvas = document.createElement('canvas')
    this.tempCanvas.width = this.videoWidth
    this.tempCanvas.height = this.videoHeight
    this.tempCtx = this.tempCanvas.getContext('2d')!

    this.tempCanvas2 = document.createElement('canvas')
    this.tempCanvas2.width = this.videoWidth
    this.tempCanvas2.height = this.videoHeight
    this.tempCtx2 = this.tempCanvas2.getContext('2d')!

    this.tempCanvas3 = document.createElement('canvas')
    this.tempCanvas3.width = this.videoWidth
    this.tempCanvas3.height = this.videoHeight
    this.tempCtx3 = this.tempCanvas3.getContext('2d')!
  }

  private async createImageSegmenter() {
    try {
      this.segmenter = await ImageSegmenter.createFromOptions(wasmFileset, {
        baseOptions: {
          modelAssetPath,
          delegate: 'GPU'
        },
        outputCategoryMask: true,
        runningMode: 'VIDEO'
      })
    } catch (error) {
      console.error('failed to create a segmenter:', error)
    }
  }

  private callbackForVideo = (segmentationResult: ImageSegmenterResult) => {
    if (!segmentationResult || !segmentationResult.categoryMask) return
    const imageData = this.tempCtx.getImageData(0, 0, this.video.videoWidth, this.video.videoHeight).data
    const imageData2 = this.tempCtx2.getImageData(0, 0, this.video.videoWidth, this.video.videoHeight).data
    // get results of segmentation
    // 0 - background
    // 1 - hair
    // 2 - body-skin
    // 3 - face-skin
    // 4 - clothes
    // 5 - others (accessories)
    const maskData = segmentationResult.categoryMask.getAsFloat32Array().map(val => Math.round(val * 255.0))
    const categoryChosen = 0

    // draw the top layer on tempCanvas
    {
      for (let i = 0; i < maskData.length; ++i) {
        const maskVal = maskData[i]
        const j = i * 4
        // set chosen pixels to transparent
        if (maskVal == categoryChosen) {
          imageData[j + 3] = 0 // alpha channel
        }
      }

      const uint8Array = new Uint8ClampedArray(imageData.buffer)
      const dataNew = new ImageData(
        uint8Array,
        this.video.videoWidth,
        this.video.videoHeight
      )

      this.tempCtx.putImageData(dataNew, 0, 0)
    }

    // draw the middle layer on tempCanvas3
    {
      for (let i = 0; i < maskData.length; ++i) {
        const maskVal = maskData[i]
        const maskValL = (i % this.videoWidth) > ((i - 4) % this.videoWidth) ? maskData.slice(i - 4, i) : maskData.slice(i, i)
        const maskValR = (i % this.videoWidth) < ((i + 4) % this.videoWidth) ? maskData.slice(i + 1, i + 1 + 4) : maskData.slice(i + 1, i + 1)
        const j = i * 4
        // set chosen pixels to transparent
        if (maskVal == categoryChosen) {
          if (maskValL.some(val => val != categoryChosen) || maskValR.some(val => val != categoryChosen)) {
            imageData2[j + 3] = 255 // alpha channel
          } else {
            imageData2[j + 3] = 0 // alpha channel
          }
        }
      }

      const uint8Array2 = new Uint8ClampedArray(imageData2.buffer)
      const dataNew2 = new ImageData(
        uint8Array2,
        this.video.videoWidth,
        this.video.videoHeight
      )

      // put segmented frame onto tempCanvas3
      this.tempCtx3.clearRect(0, 0, this.videoWidth, this.videoHeight)
      this.tempCtx2.putImageData(dataNew2, 0, 0)
      this.tempCtx3.drawImage(this.tempCanvas2, 0, 0)
      this.tempCtx3.filter = 'blur(0.1rem)'
    }

    // draw the bottom layer on canvas
    {
      this.canvasCtx.clearRect(0, 0, this.videoWidth, this.videoHeight)
      if (this.backgroundImage.complete && this.backgroundImage.naturalHeight !== 0) {
        this.canvasCtx.drawImage(this.backgroundImage, 0, 0, this.video.videoWidth, this.video.videoHeight)
      }
    }

    // put three layers together
    this.canvasCtx.drawImage(this.tempCanvas3, 0, 0)
    this.canvasCtx.drawImage(this.tempCanvas, 0, 0)

    window.requestAnimationFrame(this.predictWebcam)
  }

  private predictWebcam = () => {
    if (!this.segmenter || !this.webcamRunning) return
    try {
      // draw video frame on tempCanvas
      this.tempCtx.drawImage(this.video, 0, 0, this.video.videoWidth, this.video.videoHeight)
      this.tempCtx2.drawImage(this.video, 0, 0, this.video.videoWidth, this.video.videoHeight)
      this.segmenter.segmentForVideo(this.video, performance.now(), this.callbackForVideo)
    } catch (error) {
      console.error('error when processing frame:', error)
    }
  }

  public async startStream(): Promise<MediaStream> {
    try {
      if (!this.segmenter) {
        await this.createImageSegmenter()
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: this.deviceId
        }
      })
      return new Promise(resolve => {
        this.video.srcObject = stream
        this.video.onloadeddata = async () => {
          this.video.play()
          this.webcamRunning = true
          this.predictWebcam()
          resolve(this.canvas.captureStream())
        }
      })
    } catch (error) {
      console.error('failed to activate webcam:', error)
      return new Promise(resolve => resolve(new MediaStream()))
    }
  }

  public destroyStream = () => {
    const stream = this.video.srcObject as MediaStream
    if (stream === null) return
    this.webcamRunning = false
    const tracks = stream.getTracks()
    tracks.forEach(track => track.stop())
    this.video.srcObject = null
    this.canvasCtx.clearRect(0, 0, this.videoWidth, this.videoHeight)
  }
}
