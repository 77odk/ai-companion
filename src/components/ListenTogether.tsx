import { useEffect, useRef, useState } from 'react'
import { getActiveSessionId } from '../lib/sessionStore'
import {
  chooseListenTogetherTracks,
  getListenTogetherSnapshot,
  seekListenTogether,
  setListenTogetherMode,
  setListenTogetherVolume,
  stepListenTogether,
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
                  <strong>{snapshot.hasTrack ? snapshot.title : '还没有接音乐'}</strong>
                  <span>
                    {snapshot.hasTrack
                      ? `${snapshot.trackIndex + 1} / ${snapshot.trackCount}`
                      : '接上以后，就可以在这里一起听'}
                  </span>
                </div>

                {!snapshot.hasTrack ? (
                  <div className="listen-connect">
                    <button type="button" onClick={() => inputRef.current?.click()}>
                      接音乐
                    </button>
                  </div>
                ) : (
                  <>
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

                    <div className="listen-transport" aria-label="播放控制">
                      <button
                        type="button"
                        aria-label="上一首"
                        onClick={() => void stepListenTogether(sessionId, -1)}
                      >
                        上一首
                      </button>
                      <button
                        type="button"
                        className="listen-play"
                        onClick={() => void toggleListenTogether(sessionId)}
                      >
                        {snapshot.playing ? '暂停' : '播放'}
                      </button>
                      <button
                        type="button"
                        aria-label="下一首"
                        onClick={() => void stepListenTogether(sessionId, 1)}
                      >
                        下一首
                      </button>
                    </div>

                    <div className="listen-volume-row">
                      <span>音量</span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={snapshot.volume}
                        onChange={(event) => setListenTogetherVolume(sessionId, Number(event.target.value))}
                        aria-label="音量"
                      />
                    </div>

                    <div className="listen-actions">
                      <button type="button" onClick={() => inputRef.current?.click()}>
                        换歌
                      </button>
                      <button
                        type="button"
                        onClick={() => setListenTogetherMode(
                          sessionId,
                          snapshot.mode === 'sequence' ? 'shuffle' : 'sequence',
                        )}
                      >
                        {snapshot.mode === 'sequence' ? '顺序播放' : '随机播放'}
                      </button>
                    </div>
                  </>
                )}
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
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              if (files.length > 0) chooseListenTogetherTracks(sessionId, files)
              event.target.value = ''
            }}
          />
        </section>
      </main>
    </div>
  )
}
