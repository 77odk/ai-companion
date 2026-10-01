import { useMemo, useRef, useState, type CSSProperties } from 'react'
import type { PhotoMeta } from '../lib/photoWall'
import { assignDayRows, boardHeightForPhotos, groupPhotosByMonth, layoutForPhoto } from '../lib/photoWallLayout'
import '../styles/photoWallArchive.css'

interface Props {
  photos: PhotoMeta[]
  uploading: number
  error: string | null
  photoSrc: (photo: PhotoMeta) => string
  onPhotoLoadError?: (photo: PhotoMeta) => void
  onAdd: () => void
}

type WallStyle = CSSProperties & {
  '--photo-rotate': string
  '--photo-shift': string
  '--photo-slot-x': string
  '--photo-slot-y': string
  '--photo-z': string
}

type BoardStyle = CSSProperties & {
  '--photo-board-height': string
}

type PreviewStyle = CSSProperties & {
  '--photo-preview-x': string
  '--photo-preview-y': string
  '--photo-preview-rotate': string
  '--photo-preview-scale': string
  '--photo-preview-z': string
}

const PREVIEW_Y = [50, 26, 62, 34, 54, 22, 66, 38, 58, 28, 70, 42]
const PREVIEW_ROTATE = [-6, 4, -3, 7, -5, 2, 5, -7, 3, -2, 6, -4]
const PREVIEW_SCALE = [1, 0.95, 0.98, 0.93, 1.01, 0.96, 0.94, 0.99, 0.95, 0.93, 1, 0.96]

function stablePreviewUnit(seed: string): number {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967295
}

function previewX(index: number, count: number): number {
  if (count <= 1) return 50
  if (count === 2) return 35 + index * 30
  if (count === 3) return 23 + index * 27
  const edge = 16
  return edge + index * ((100 - edge * 2) / (count - 1))
}

function previewStyle(photo: PhotoMeta, index: number, count: number): PreviewStyle {
  const seed = `${photo.id}:${photo.createdAt}`
  const jitterX = (stablePreviewUnit(`${seed}:x`) - 0.5) * 8
  const jitterY = (stablePreviewUnit(`${seed}:y`) - 0.5) * 6
  const jitterRotate = (stablePreviewUnit(`${seed}:r`) - 0.5) * 2.4
  const jitterScale = (stablePreviewUnit(`${seed}:s`) - 0.5) * 0.02
  const compactY = count <= 1 ? 40 : count === 2 ? [42, 34][index] : count === 3 ? [46, 28, 46][index] : PREVIEW_Y[index]

  return {
    '--photo-preview-x': `calc(${previewX(index, count)}% + ${jitterX.toFixed(1)}px)`,
    '--photo-preview-y': `${(compactY + jitterY).toFixed(1)}px`,
    '--photo-preview-rotate': `${(PREVIEW_ROTATE[index] + jitterRotate).toFixed(1)}deg`,
    '--photo-preview-scale': `${(PREVIEW_SCALE[index] + jitterScale).toFixed(3)}`,
    '--photo-preview-z': `${count - index + 10}`,
  }
}

function fmtMD(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export default function PhotoWallArchive({ photos, uploading, error, photoSrc, onPhotoLoadError, onAdd }: Props) {
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const touchStartX = useRef<number | null>(null)
  const sorted = useMemo(() => [...photos].sort((a, b) => b.createdAt - a.createdAt), [photos])
  const preview = sorted.slice(0, 12)
  const groups = useMemo(() => groupPhotosByMonth(sorted), [sorted])
  // 每月「有照片的那几天」的行号（最新的一天 = 行 0）；Y 轴按行排，月份标题下面就是照片。
  const dayRows = useMemo(() => assignDayRows(sorted), [sorted])
  const selectedIndex = selectedId ? sorted.findIndex((photo) => photo.id === selectedId) : -1

  const showAt = (index: number) => {
    if (sorted.length === 0) return
    const normalized = (index + sorted.length) % sorted.length
    setSelectedId(sorted[normalized].id)
  }

  const wallStyle = (photo: PhotoMeta): WallStyle => {
    const layout = layoutForPhoto(photo.id, photo.createdAt, dayRows.get(photo.id) ?? 0)
    return {
      '--photo-rotate': `${layout.rotate}deg`,
      '--photo-shift': `${layout.shift}px`,
      '--photo-slot-x': `${layout.slotX}%`,
      '--photo-slot-y': `${layout.slotY}px`,
      '--photo-z': `${layout.zIndex}`,
    }
  }

  const wallClass = (photo: PhotoMeta): string => {
    const layout = layoutForPhoto(photo.id, photo.createdAt, dayRows.get(photo.id) ?? 0)
    return `photo-archive-card is-${layout.width} pin-${layout.pin}`
  }

  const boardStyle = (groupPhotos: PhotoMeta[]): BoardStyle => ({
    '--photo-board-height': `${boardHeightForPhotos(groupPhotos)}px`,
  })

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
              const layout = layoutForPhoto(photo.id, photo.createdAt, dayRows.get(photo.id) ?? 0)
              return (
                <span
                  key={photo.id}
                  className={`photo-stack-card pin-${layout.pin}`}
                  style={previewStyle(photo, index, preview.length)}
                >
                  <img
                    src={photoSrc(photo)}
                    alt=""
                    loading={index < 6 ? 'eager' : 'lazy'}
                    onError={() => onPhotoLoadError?.(photo)}
                  />
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
                  <div className="photo-archive-board" style={boardStyle(group.photos)}>
                    {group.photos.map((photo) => (
                      <button
                        key={photo.id}
                        type="button"
                        className={wallClass(photo)}
                        style={wallStyle(photo)}
                        onClick={() => setSelectedId(photo.id)}
                      >
                        <span className="photo-archive-pin" aria-hidden="true" />
                        <img
                          src={photoSrc(photo)}
                          alt=""
                          loading="lazy"
                          onError={() => onPhotoLoadError?.(photo)}
                        />
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
            loading="eager"
            onError={() => onPhotoLoadError?.(sorted[selectedIndex])}
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
