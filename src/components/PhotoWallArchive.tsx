import { useMemo, useRef, useState, type CSSProperties } from 'react'
import type { PhotoMeta } from '../lib/photoWall'
import { groupPhotosByMonth, layoutForPhoto } from '../lib/photoWallLayout'
import '../styles/photoWallArchive.css'

interface Props {
  photos: PhotoMeta[]
  uploading: number
  error: string | null
  photoSrc: (photo: PhotoMeta) => string
  onAdd: () => void
}

type WallStyle = CSSProperties & {
  '--photo-rotate': string
  '--photo-shift': string
  '--photo-slot-x': string
  '--photo-slot-y': string
}

function fmtMD(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export default function PhotoWallArchive({ photos, uploading, error, photoSrc, onAdd }: Props) {
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const touchStartX = useRef<number | null>(null)
  const sorted = useMemo(() => [...photos].sort((a, b) => b.createdAt - a.createdAt), [photos])
  const preview = sorted.slice(0, 10)
  const groups = useMemo(() => groupPhotosByMonth(sorted), [sorted])
  const selectedIndex = selectedId ? sorted.findIndex((photo) => photo.id === selectedId) : -1

  const showAt = (index: number) => {
    if (sorted.length === 0) return
    const normalized = (index + sorted.length) % sorted.length
    setSelectedId(sorted[normalized].id)
  }

  const wallStyle = (photo: PhotoMeta): WallStyle => {
    const layout = layoutForPhoto(photo.id, photo.createdAt)
    return {
      '--photo-rotate': `${layout.rotate}deg`,
      '--photo-shift': `${layout.shift}px`,
      '--photo-slot-x': `${layout.slotX}%`,
      '--photo-slot-y': `${layout.slotY}px`,
    }
  }

  const wallClass = (photo: PhotoMeta): string => {
    const layout = layoutForPhoto(photo.id, photo.createdAt)
    return `photo-archive-card is-${layout.width} pin-${layout.pin}`
  }

  return (
    <>
      <section className="ai-space-v2-section space-archive-section photo-archive-preview-section">
        <div className="ai-space-v2-head">
          <span className="ai-space-v2-title">照片墙</span>
          <span className="ai-space-v2-en">PHOTO WALL</span>
          {sorted.length > 0 && (
            <button type="button" className="ai-space-v2-all" onClick={() => setOpen(true)}>
              查看全部 ›
            </button>
          )}
        </div>

        {sorted.length === 0 && uploading === 0 ? (
          <button type="button" className="photo-archive-empty" onClick={onAdd}>
            <span className="photo-archive-empty-plus" aria-hidden="true">＋</span>
            <span>从第一张开始，慢慢留下我们的日子。</span>
          </button>
        ) : (
          <button
            type="button"
            className="photo-stack-preview"
            onClick={() => setOpen(true)}
            aria-label="打开照片墙"
          >
            <span className="photo-stack-felt" aria-hidden="true" />
            {preview.map((photo, index) => {
              const layout = layoutForPhoto(photo.id, photo.createdAt)
              const angle = layout.rotate + (index - Math.min(preview.length, 5) / 2) * 0.6
              const x = ((index % 5) - 2) * 26 + layout.shift * 0.45
              const y = Math.floor(index / 5) * 38 + (index % 2) * 7
              return (
                <span
                  key={photo.id}
                  className={`photo-stack-card pin-${layout.pin}`}
                  style={{
                    zIndex: index + 1,
                    transform: `translate(${x}px, ${y}px) rotate(${angle}deg)`,
                  }}
                >
                  <img src={photoSrc(photo)} alt="" loading="lazy" />
                </span>
              )
            })}
            {uploading > 0 && <span className="photo-stack-uploading">正在放进照片墙…</span>}
          </button>
        )}

        {error && <p className="ai-photo-err">{error}</p>}
        {sorted.length > 0 && (
          <button type="button" className="photo-archive-add-inline" onClick={onAdd}>
            ＋ 添加照片
          </button>
        )}
      </section>

      {open && (
        <div className="photo-archive-page" role="dialog" aria-label="照片墙">
          <div className="photo-archive-topbar">
            <button type="button" className="photo-archive-back" onClick={() => setOpen(false)}>
              ‹ 返回
            </button>
            <div>
              <strong>照片墙</strong>
              <span>PHOTO WALL</span>
            </div>
            <button type="button" className="photo-archive-add" onClick={onAdd}>
              ＋ 添加
            </button>
          </div>

          <div className="photo-archive-scroll">
            {groups.length === 0 ? (
              <button type="button" className="photo-archive-empty is-page" onClick={onAdd}>
                <span className="photo-archive-empty-plus" aria-hidden="true">＋</span>
                <span>从第一张开始，慢慢留下我们的日子。</span>
              </button>
            ) : (
              groups.map((group, groupIndex) => (
                <section key={group.key} className="photo-archive-month">
                  <div className="photo-archive-month-label">{group.label}</div>
                  <div className="photo-archive-board">
                    {group.photos.map((photo) => (
                      <button
                        key={photo.id}
                        type="button"
                        className={wallClass(photo)}
                        style={wallStyle(photo)}
                        onClick={() => setSelectedId(photo.id)}
                      >
                        <span className="photo-archive-pin" aria-hidden="true" />
                        <img src={photoSrc(photo)} alt="" loading="lazy" />
                        <span className="photo-archive-date">{fmtMD(photo.createdAt)}</span>
                      </button>
                    ))}
                    {groupIndex % 2 === 0 && group.photos.length >= 3 && (
                      <span className="photo-archive-thread thread-a" aria-hidden="true" />
                    )}
                    {groupIndex % 3 === 1 && group.photos.length >= 5 && (
                      <span className="photo-archive-thread thread-b" aria-hidden="true" />
                    )}
                  </div>
                </section>
              ))
            )}
            <p className="photo-archive-tail">越往下，是越早以前的我们。</p>
          </div>
        </div>
      )}

      {selectedId && selectedIndex >= 0 && (
        <div
          className="photo-archive-lightbox"
          role="dialog"
          aria-label="查看照片"
          onClick={() => setSelectedId(null)}
          onTouchStart={(event) => {
            touchStartX.current = event.touches[0]?.clientX ?? null
          }}
          onTouchEnd={(event) => {
            const start = touchStartX.current
            touchStartX.current = null
            if (start == null) return
            const end = event.changedTouches[0]?.clientX ?? start
            const delta = end - start
            if (Math.abs(delta) < 44) return
            showAt(selectedIndex + (delta < 0 ? 1 : -1))
          }}
        >
          <button
            type="button"
            className="photo-archive-lightbox-close"
            onClick={(event) => {
              event.stopPropagation()
              setSelectedId(null)
            }}
          >
            ×
          </button>
          <button
            type="button"
            className="photo-archive-lightbox-nav is-prev"
            aria-label="上一张"
            onClick={(event) => {
              event.stopPropagation()
              showAt(selectedIndex - 1)
            }}
          >
            ‹
          </button>
          <img
            src={photoSrc(sorted[selectedIndex])}
            alt=""
            onClick={(event) => event.stopPropagation()}
          />
          <button
            type="button"
            className="photo-archive-lightbox-nav is-next"
            aria-label="下一张"
            onClick={(event) => {
              event.stopPropagation()
              showAt(selectedIndex + 1)
            }}
          >
            ›
          </button>
          <span className="photo-archive-lightbox-date">{fmtMD(sorted[selectedIndex].createdAt)}</span>
        </div>
      )}
    </>
  )
}
