import { useEffect, useRef, useState } from 'react'
import { getActiveSessionId } from '../lib/sessionStore'
import {
  chooseListenTogetherTrack,
  getListenTogetherSnapshot,
  seekListenTogether,
  subscribeListenTogether,
  toggleListenTogether,
} from '../lib/listenTogetherState'

interface Props {
  onBack: () => void
}

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export default function ListenTogether({ onBack }: Props) {
  const sessionId = getActiveSessionId()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [snapshot, setSnapshot] = useState(() => getListenTogetherSnapshot(sessionId))

  useEffect(() => {
    setSnapshot(getListenTogetherSnapshot(sessionId))
    return subscribeListenTogether(sessionId, setSnapshot)
  }, [sessionId])

  const toggle = async () => {
    if (!snapshot.hasTrack) {
      inputRef.current?.click()
      return
    }
    await toggleListenTogether(sessionId)
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
          <div className="listen-device-wrap">
            <div className="listen-tablet">
              <div className="listen-tablet-screen">
                <div className="listen-cover" aria-hidden="true">
                  <span />
                </div>
                <div className="listen-meta">
                  <strong>{snapshot.hasTrack ? snapshot.title : '还没有选择歌曲'}</strong>
                  <span>{snapshot.hasTrack ? '本地音乐' : '只读取你自己选择的音乐'}</span>
                </div>
                <div className="listen-progress-row">
                  <span>{fmt(snapshot.current)}</span>
                  <input
                    type="range"
                    min="0"
                    max={Math.max(1, snapshot.duration)}
                    step="0.1"
                    value={Math.min(snapshot.current, Math.max(1, snapshot.duration))}
                    onChange={(event) => seekListenTogether(sessionId, Number(event.target.value))}
                    aria-label="播放进度"
                  />
                  <span>{fmt(snapshot.duration)}</span>
                </div>
                <div className="listen-actions">
                  <button type="button" onClick={() => inputRef.current?.click()}>选择歌曲</button>
                  <button type="button" className="listen-play" onClick={() => void toggle()}>
                    {snapshot.playing ? '暂停' : '播放'}
                  </button>
                </div>
              </div>
              <span className="listen-tablet-port" aria-hidden="true" />
            </div>
            <span className="listen-stand" aria-hidden="true" />
            <span className="listen-earphones" aria-hidden="true">
              <i />
              <i />
            </span>
          </div>
          <input
            ref={inputRef}
            className="ai-photo-file"
            type="file"
            accept="audio/*"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) chooseListenTogetherTrack(sessionId, file)
              event.target.value = ''
            }}
          />
        </section>
      </main>
    </div>
  )
}
