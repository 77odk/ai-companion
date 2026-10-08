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

  const toggle = async () => {
    if (!snapshot.hasTrack) return
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
            <span className="listen-approved-device-art" aria-hidden="true">
              <img src="/space/space-desk.webp" alt="" draggable={false} />
            </span>
            <div className="listen-tablet">
              <div className="listen-tablet-screen">
                <div className="listen-meta">
                  <strong>{snapshot.hasTrack ? snapshot.title : '还没有接音乐'}</strong>
                  <span>
                    {snapshot.hasTrack
                      ? `${snapshot.currentIndex + 1} / ${snapshot.trackCount}`
                      : '先把音乐接进来，播放器会留在这里'}
                  </span>
                </div>

                <div className="listen-progress-row">
                  <span>{fmt(snapshot.current)}</span>
                  <input
                    type="range"
                    min="0"
                    max={Math.max(1, snapshot.duration)}
                    step="0.1"
                    value={Math.min(snapshot.current, Math.max(1, snapshot.duration))}
                    disabled={!snapshot.hasTrack}
                    onChange={(event) => seekListenTogether(sessionId, Number(event.target.value))}
                    aria-label="播放进度"
                  />
                  <span>{fmt(snapshot.duration)}</span>
                </div>

                {!snapshot.hasTrack && (
                  <div className="listen-connect">
                    <button type="button" onClick={() => inputRef.current?.click()}>
                      去接音乐
                    </button>
                  </div>
                )}

                <div className="listen-transport">
                  <button
                    type="button"
                    disabled={!snapshot.hasTrack}
                    onClick={() => void stepListenTogether(sessionId, -1)}
                  >
                    上一首
                  </button>
                  <button
                    type="button"
                    className="listen-play"
                    disabled={!snapshot.hasTrack}
                    onClick={() => void toggle()}
                  >
                    {snapshot.playing ? '暂停' : '播放'}
                  </button>
                  <button
                    type="button"
                    disabled={!snapshot.hasTrack}
                    onClick={() => void stepListenTogether(sessionId, 1)}
                  >
                    下一首
                  </button>
                </div>

                <label className="listen-volume-row">
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
                </label>

                {snapshot.hasTrack && (
                  <div className="listen-actions">
                    <button
                      type="button"
                      onClick={() => setListenTogetherMode(
                        sessionId,
                        snapshot.mode === 'sequence' ? 'shuffle' : 'sequence',
                      )}
                    >
                      {snapshot.mode === 'sequence' ? '顺序播放' : '随机播放'}
                    </button>
                    <button type="button" onClick={() => inputRef.current?.click()}>
                      换一组音乐
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <input
            ref={inputRef}
            className="ai-photo-file"
            type="file"
            accept="audio/*"
            multiple
            onChange={(event) => {
              if (event.target.files?.length) {
                chooseListenTogetherTracks(sessionId, event.target.files)
              }
              event.target.value = ''
            }}
          />
        </section>
      </main>
    </div>
  )
}
