import { transitionSpaceScene } from '../lib/spaceSceneTransition'
import { useEffect, useRef, useState } from 'react'
import { getActiveSessionId } from '../lib/sessionStore'
import SpaceObjectScene, { SpacePlayerScreen } from './SpaceObjectScene'
import { useSpaceObjectScene } from '../lib/useSpaceObjectScene'
import { SPACE_PLAYER_FRAME } from '../lib/spaceObjectFocus'
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

function PlayerIcon({ name }: { name: 'play' | 'pause' | 'prev' | 'next' | 'volume' | 'add' | 'sequence' | 'shuffle' }) {
  const paths = {
    play: 'M9 5l11 7-11 7Z', pause: 'M8 5v14M16 5v14',
    prev: 'M5 5v14M19 5 8 12l11 7Z', next: 'M19 5v14M5 5l11 7-11 7Z',
    volume: 'M3 9h4l5-4v14l-5-4H3ZM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14',
    add: 'M4 6h6l2 2h8v12H4ZM12 11v6M9 14h6',
    sequence: 'M4 8h14l-3-3M20 16H6l3 3M18 8l-3 3M6 16l3-3',
    shuffle: 'M3 6h3c5 0 7 12 12 12h3M18 15l3 3-3 3M3 18h3c2 0 4-3 6-6s4-6 6-6h3M18 3l3 3-3 3',
  }
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export default function ListenTogether({ onBack }: Props) {
  const artwork = useSpaceObjectScene()
  const PlayerPlane = artwork.ready ? SpacePlayerScreen : 'div'
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
    <div className={`page space-object-page listen-together-page${artwork.ready ? ' is-native-object-focus' : ''}`}>
      <header className="space-object-topbar">
        <button type="button" onClick={() => transitionSpaceScene(onBack)} className="space-object-back">‹ 返回</button>
        <div>
          <strong>一起听歌</strong>
          <span>LISTEN TOGETHER</span>
        </div>
        <span aria-hidden="true" />
      </header>

      <main className="listen-stage">
        <section className="listen-player" aria-label="一起听歌播放器">
          <div className="listen-device-wrap">
            {artwork.ready ? <SpaceObjectScene frame={SPACE_PLAYER_FRAME} onError={artwork.fail} /> : <img
              className="listen-approved-device-art"
              src="/space/cutouts/music-player.png"
              onError={(event) => {
                const image = event.currentTarget
                if (!image.dataset.fallback) {
                  image.dataset.fallback = 'true'
                  image.src = '/space/layered/tablet_player.png'
                }
              }}
              alt=""
              aria-hidden="true"
              draggable={false}
            />}
            <PlayerPlane className="listen-tablet">
              <div className="listen-tablet-screen">
                <div className="listen-meta">
                  <strong>{snapshot.hasTrack ? snapshot.title : '选择音乐'}</strong>
                  <span>
                    {snapshot.hasTrack
                      ? `${snapshot.currentIndex + 1} / ${snapshot.trackCount}`
                      : '本地音乐'}
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
                    <button type="button" aria-label="去接音乐" onClick={() => inputRef.current?.click()}>
                      <PlayerIcon name="add" />
                    </button>
                  </div>
                )}

                <div className="listen-transport">
                  <button
                    type="button"
                    disabled={!snapshot.hasTrack}
                    aria-label="上一首"
                    onClick={() => void stepListenTogether(sessionId, -1)}
                  >
                    <PlayerIcon name="prev" />
                  </button>
                  <button
                    type="button"
                    className="listen-play"
                    aria-label={snapshot.playing ? '暂停' : '播放'}
                    disabled={!snapshot.hasTrack}
                    onClick={() => void toggle()}
                  >
                    <PlayerIcon name={snapshot.playing ? 'pause' : 'play'} />
                  </button>
                  <button
                    type="button"
                    disabled={!snapshot.hasTrack}
                    aria-label="下一首"
                    onClick={() => void stepListenTogether(sessionId, 1)}
                  >
                    <PlayerIcon name="next" />
                  </button>
                </div>

                <label className="listen-volume-row">
                  <PlayerIcon name="volume" />
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
                      aria-label={snapshot.mode === 'sequence' ? '顺序播放' : '随机播放'}
                      onClick={() => setListenTogetherMode(
                        sessionId,
                        snapshot.mode === 'sequence' ? 'shuffle' : 'sequence',
                      )}
                    >
                      <PlayerIcon name={snapshot.mode} />
                    </button>
                    <button type="button" aria-label="换一组音乐" onClick={() => inputRef.current?.click()}>
                      <PlayerIcon name="add" />
                    </button>
                  </div>
                )}
              </div>
            </PlayerPlane>
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
