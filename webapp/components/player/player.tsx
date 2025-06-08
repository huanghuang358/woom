import { useEffect, useRef, useState } from 'react'
import { useAtom } from 'jotai'
import WaveSurfer from 'wavesurfer.js'
import RecordPlugin from 'wavesurfer.js/dist/plugins/record'
import SvgProgress from '../svg/progress'
import { deviceSpeakerAtom, speakerStatusAtom } from '../../store/atom'
import {
  SvgMuted,
  SvgUnmuted,
  SvgFullscreen,
  SvgExitFullscreen,
  SvgPictureInPicture,
} from '../svg/player'

function AudioWave(props: { stream: MediaStream }) {
  const refWave = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (refWave.current && !!props.stream?.getAudioTracks().length) {
      const wavesurfer = WaveSurfer.create({
        container: refWave.current,
        waveColor: 'rgb(200, 100, 0)',
        progressColor: 'rgb(100, 50, 0)',
      })

      const record = wavesurfer.registerPlugin(RecordPlugin.create())
      const { onDestroy, onEnd } = record.renderMicStream(new MediaStream(props.stream.getAudioTracks()))

      return () => {
        onDestroy()
        onEnd()
        wavesurfer.destroy()
      }
    }
  }, [refWave.current, props.stream])

  return <div ref={refWave}></div>
}

export default function Player(props: { stream: MediaStream, muted: boolean, audio?: boolean, video?: boolean, width: string }) {
  const refCanvas = useRef<HTMLCanvasElement>(null)
  const [showAudio, setShowAudio] = useState(false)
  const audioTrack = props.stream.getAudioTracks()[0]
  const videoTrack = props.stream.getVideoTracks()[0]
  const [currentDeviceSpeaker] = useAtom(deviceSpeakerAtom)
  const [speakerStatus] = useAtom(speakerStatusAtom)
  const refPlayPromise = useRef<Promise<void> | null>(null)
  const refControls = useRef<HTMLDivElement>(null)
  const [showControls, setShowControls] = useState(false)
  const refTimeoutId = useRef<NodeJS.Timeout | null>(null)
  const [isMuted, setIsMuted] = useState(false)
  const [isFullScreened, setIsFullscreened] = useState(false)

  const handleMouseMove = () => {
    setShowControls(true)
    if (refTimeoutId.current) clearTimeout(refTimeoutId.current)
    const newTimeout = setTimeout(() => {
      setShowControls(false)
    }, 2000)
    refTimeoutId.current = newTimeout
  }

  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false)
    } else {
      setIsMuted(true)
    }
  }
  const isFullscreenSupported = () => {
    const container = refCanvas.current?.parentElement
    return (
      typeof document.exitFullscreen === 'function' &&
    typeof container?.requestFullscreen === 'function'
    )
  }

  const toggleFullscreen = () => {
    const container = refCanvas.current!.parentElement!
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      container.requestFullscreen()
    }
  }

  const togglePictureInPicture = () => {

  }
  useEffect(() => {
    const onFullScreenChange = () => document.fullscreenElement ? setIsFullscreened(true) : setIsFullscreened(false)
    if (isFullscreenSupported()) document.addEventListener('fullscreenchange', onFullScreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFullScreenChange)
    }
  }, [])

  useEffect(() => {
    const container = refControls.current?.parentElement
    container?.addEventListener('mousemove', handleMouseMove)
    return () => {
      container?.removeEventListener('mousemove', handleMouseMove)
    }
  }, [])

  useEffect(() => {
    setIsMuted(!speakerStatus)
  }, [speakerStatus])

  useEffect(() => {
    if (audioTrack && !videoTrack) {
      setShowAudio(true)
    } else {
      setShowAudio(false)
    }
    if (!props.audio) setIsMuted(true)
    if (audioTrack && props.audio) {
      const el = document.createElement('audio')
      el.srcObject = new MediaStream([audioTrack])

      if (el.setSinkId) {
        el.setSinkId(currentDeviceSpeaker)
      }

      el.muted = !speakerStatus || isMuted
      refPlayPromise.current = el.play()

      return () => {
        refPlayPromise.current?.finally(() => {
          el.pause()
          el.srcObject = null
          el.remove()
        })
      }
    }
  }, [audioTrack, videoTrack, currentDeviceSpeaker, speakerStatus, isMuted])

  useEffect(() => {
    let done = false
    const video = document.createElement('video')
    video.muted = props.muted
    if (refCanvas.current && videoTrack) {
      video.srcObject = new MediaStream([videoTrack])
      const rect = refCanvas.current.parentElement!.getBoundingClientRect()
      refCanvas.current.width = rect.width
      refCanvas.current.height = rect.height
      const ctx = refCanvas.current.getContext('2d')
      function draw() {
        if (video && ctx && refCanvas.current) {
          ctx.drawImage(video, 0, 0, refCanvas.current.width, refCanvas.current.height)
        }
        if (!done) window.requestAnimationFrame(draw)
      }
      video.onloadeddata = () => {
        if (video) {
          video.play()
          draw()
        }
      }
    }
    return () => {
      done = true
      if (video) {
        video.onloadeddata = null
        video.remove()
      }
    }
  }, [videoTrack])

  // NOTE: iOS can't display video
  // https://webkit.org/blog/6784/new-video-policies-for-ios/
  //
  // TODO:
  // We need customs video element
  // - disable default `controls`
  // - we don't need button play / pause
  // - we don't need button progress bar
  // - NOTE: video element don't has `audioTrack`, So volume button is unavailable
  // - NOTE: `pointerEvents: 'none'` (I forget why has this in video element. removed)
  return (
    <center
      className={`relative flex flex-col justify-center min-h-60 ${
        window.matchMedia('(orientation: portrait)').matches ? 'aspect-[3/4]' : 'aspect-[4/3]'
      }`}
      style={{ width: props.width }}
    >
      {!props.stream.getTracks().length ? <center><SvgProgress /></center> : null}
      <canvas
        className="rounded-xl"
        ref={refCanvas}
        style={props.stream?.getVideoTracks().length
          ? { display: props.video ? 'inline' : 'none'}
          : { height: '0px' }}
      />
      {!props.video || showAudio
        ? <AudioWave stream={props.stream} />
        : null
      }
      <div
        className={`absolute bottom-0 left-0 right-0 rounded-b-xl px-4 py-3 flex justify-between items-center transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        ref={refControls}
      >
        <button
          className="rounded-md disabled:bg-gray-400 disabled:opacity-70"
          onClick={toggleMute}
          disabled={!props.audio || !speakerStatus}
        >
          {isMuted ? <SvgMuted /> : <SvgUnmuted />}
        </button>
        <div
          className="space-x-2"
        >
          <button
            className="rounded-md disabled:bg-gray-400 disabled:opacity-70"
            onClick={toggleFullscreen}
            disabled={!isFullscreenSupported()}
          >
            {isFullScreened ? <SvgExitFullscreen /> : <SvgFullscreen />}
          </button>
          <button
            className="rounded-md disabled:bg-gray-400 disabled:opacity-70"
            onClick={togglePictureInPicture}
          >
            <SvgPictureInPicture />
          </button>
        </div>
      </div>
    </center>
  )
}
