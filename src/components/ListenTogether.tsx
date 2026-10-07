import { useEffect, useRef, useState } from 'react'

interface Props {
  onBack: () => void
}

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export default function ListenTogether({ onBack }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [src, setSrc] = useState('')
  const [title, setTitle] = useState('还没有选择歌曲')
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => () => {
    if (src) URL.revokeObjectURL(src)
  }, [src])

  const choose = (file?: File) => {
    if (!file) return
    if (src) URL.revokeObjectURL(src)
    const next = URL.createObjectURL(file)
    setSrc(next)
    setTitle(file.name.replace(/\.[^.]+$/, '') || file.name)
    setCurrent(0)
    setDuration(0)
    setPlaying(false)
  }

  const toggle = async () => {
    const audio = audioRef.current
    if (!audio || !src) {
      inputRef.current?.click()
      return
    }
    if (audio.paused) await audio.play()
    else audio.pause()
  }

  return (
    <div className="page space-object-page listen-together-page">
      <header className="space-object-topbar">
        <button type="button" onClick={onBack} className="space-object-back">‹ 返回</button>
        <div>
          <strong>一起听歌</strong>
          <span>LISTEN TOGETHER</span>
        </div>
        <span aria-hidden="true" />
      </header>
      <main className="listen-stage">
        <section className="listen-player" aria-label="一起听歌播放器">
          <div className="listen-cover" aria-hidden="true">
            <span />
          </div>
          <div className="listen-meta">
            <strong>{title}</strong>
            <span>{src ? '本地音乐' : '只读取你自己选择的音乐'}</span>
          </div>
          <input
            ref={inputRef}
            className="ai-photo-file"
            type="file"
            accept="audio/*"
            onChange={(event) => {
              choose(event.target.files?.[0])
              event.target.value = ''
            }}
          />
          <audio
            ref={audioRef}
            src={src || undefined}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
            onEnded={() => setPlaying(false)}
          />
          <div className="listen-progress-row">
            <span>{fmt(current)}</span>
            <input
              type="range"
              min="0"
              max={Math.max(1, duration)}
              step="0.1"
              value={Math.min(current, Math.max(1, duration))}
              onChange={(event) => {
                const audio = audioRef.current
                if (!audio) return
                audio.currentTime = Number(event.target.value)
                setCurrent(audio.currentTime)
              }}
              aria-label="播放进度"
            />
            <span>{fmt(duration)}</span>
          </div>
          <div className="listen-actions">
            <button type="button" onClick={() => inputRef.current?.click()}>选择歌曲</button>
            <button type="button" className="listen-play" onClick={() => void toggle()}>
              {playing ? '暂停' : '播放'}
            </button>
          </div>
        </section>
      </main>
    </div>
  )
}
