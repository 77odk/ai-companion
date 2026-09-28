import { useEffect, useMemo, useRef, useState } from 'react'
import PhotoWallArchive from './PhotoWallArchive'
import EventArchive from './EventArchive'
import { getActiveSessionId } from '../lib/sessionStore'
import { getWeeklyReviews, type WeeklyReview } from '../lib/weeklyReview'
import {
  loadLocalPhotos,
  saveLocalPhotoMetadata,
  addLocalPhoto,
  mergePhotos,
  photoUrl,
  scaleImageToDataUrl,
  dataUrlBytes,
  uploadPhoto,
  listPhotos,
  type PhotoMeta,
} from '../lib/photoWall'
import { getToken } from '../lib/auth'

interface Props {
  /** 一周情书由 App 顶层 view 承载，不在 Space 内嵌子页。 */
  onOpenWeekly: () => void
}

/** 首页信封只露一小段正文，不把一周情书直接摊开。 */
function weeklyPreview(review: WeeklyReview): string {
  const clean = review.content.replace(/\s+/g, ' ').trim()
  if (!clean) return review.title
  return clean.length > 48 ? `${clean.slice(0, 48)}…` : clean
}

function normalizePhotoCreatedAt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

const PHOTO_IMAGE_LOAD_ERROR = '有照片暂时没显示出来，照片还在，稍后再试。'

export default function AISpace({ onOpenWeekly }: Props) {
  const sessionId = getActiveSessionId()
  const sid = sessionId || undefined

  const weekly = useMemo<WeeklyReview | null>(
    () => getWeeklyReviews(sid)[0] ?? null,
    [sid],
  )

  /* ---- 照片墙：上传/数据源沿用旧实现，展示交给稳定长墙组件。 ---- */
  const [photos, setPhotos] = useState<PhotoMeta[]>(() => loadLocalPhotos(sid))
  const [photoUploading, setPhotoUploading] = useState(0)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const clearNonImagePhotoError = () => {
    setPhotoError((current) => current === PHOTO_IMAGE_LOAD_ERROR ? current : null)
  }

  useEffect(() => {
    const local = loadLocalPhotos(sid)
    setPhotos(local)
    setPhotoError(null)
    if (!sid) return

    const token = getToken()
    if (!token) return

    let alive = true
    listPhotos(token, sid).then((res) => {
      if (!alive) return
      if (!res.ok || !res.data) {
        setPhotoError(local.length > 0
          ? '云端照片暂时没加载完整，本机已有的先保留。'
          : '照片暂时没加载出来，稍后再试。')
        return
      }
      const cloud: PhotoMeta[] = res.data.photos.map((photo) => ({
        id: photo.id,
        sessionId: photo.sessionId,
        width: photo.width,
        height: photo.height,
        createdAt: normalizePhotoCreatedAt(photo.createdAt),
      }))
      setPhotos((prev) => {
        const current = prev.every((photo) => photo.sessionId === sid) ? prev : local
        const next = mergePhotos(current, cloud)
        saveLocalPhotoMetadata(next, sid)
        return next
      })
      clearNonImagePhotoError()
    })
    return () => {
      alive = false
    }
  }, [sid])

  async function handlePhotoFile(file: File) {
    let scaled: { dataUrl: string; width: number; height: number }
    try {
      scaled = await scaleImageToDataUrl(file)
    } catch {
      setPhotoError('这张图读不了，换一张试试')
      return
    }
    if (dataUrlBytes(scaled.dataUrl) > 4 * 1024 * 1024) {
      setPhotoError('图片太大（超过 4MB），换一张小点的')
      return
    }
    const token = getToken()
    if (token && sid) {
      const res = await uploadPhoto(token, sid, scaled.dataUrl, scaled.width, scaled.height)
      if (res.ok && res.data) {
        const photo = res.data.photo
        // 上传成功后先直接显示刚压缩好的本地图，不再等图片 GET 才“出现”。
        // localStorage 只落元数据，dataUrl 只留在当前页面内存里。
        const meta: PhotoMeta = {
          id: photo.id,
          sessionId: photo.sessionId,
          width: photo.width,
          height: photo.height,
          createdAt: normalizePhotoCreatedAt(photo.createdAt),
          dataUrl: scaled.dataUrl,
        }
        setPhotos((prev) => {
          const next = mergePhotos([meta], prev)
          saveLocalPhotoMetadata(next, sid)
          return next
        })
        clearNonImagePhotoError()
      } else if (res.status === 413) {
        setPhotoError('图片太大（超过 4MB），换一张小点的')
      } else {
        setPhotoError(res.message || '上传失败，稍后再试')
      }
    } else {
      const meta: PhotoMeta = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sessionId: sid ?? '',
        width: scaled.width,
        height: scaled.height,
        createdAt: Date.now(),
        dataUrl: scaled.dataUrl,
      }
      setPhotos(addLocalPhoto(meta, sid))
    }
  }

  async function handlePhotoFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const list = Array.from(files)
    setPhotoError(null)
    setPhotoUploading(list.length)
    for (const file of list) await handlePhotoFile(file)
    setPhotoUploading(0)
  }

  function renderPhotoWall() {
    const token = getToken()
    return (
      <>
        <PhotoWallArchive
          photos={photos}
          uploading={photoUploading}
          error={photoError}
          photoSrc={(photo) => photo.dataUrl ?? photoUrl(photo.id, token)}
          onPhotoLoadError={() => {
            setPhotoError(PHOTO_IMAGE_LOAD_ERROR)
          }}
          onAdd={() => fileInputRef.current?.click()}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="ai-photo-file"
          onChange={(event) => {
            void handlePhotoFiles(event.target.files)
            event.target.value = ''
          }}
        />
      </>
    )
  }

  function renderHomePage() {
    return (
      <div className="ai-space-v2 space-archive-home">
        <p className="space-archive-intro">那些发生过的事，慢慢留在这里。</p>

        <section className="ai-space-v2-section space-archive-section space-letter-section">
          <div className="ai-space-v2-head">
            <span className="ai-space-v2-title">一周情书</span>
            <span className="ai-space-v2-en">WEEKLY LETTER</span>
            <button type="button" className="ai-space-v2-all" onClick={onOpenWeekly}>
              查看全部 ›
            </button>
          </div>

          <button type="button" className="space-letter-envelope" onClick={onOpenWeekly}>
            <span className="space-letter-envelope-back" aria-hidden="true" />
            <span className="space-letter-envelope-paper">
              {weekly ? (
                <>
                  <span className="space-letter-date">{weekly.weekLabel}</span>
                  <span className="space-letter-preview">{weeklyPreview(weekly)}</span>
                </>
              ) : (
                <span className="space-letter-empty">第一封信，会在这一周结束后写给你。</span>
              )}
            </span>
            <span className="space-letter-envelope-flap" aria-hidden="true" />
            <span className="space-letter-wax" aria-hidden="true">♡</span>
          </button>
        </section>

        {renderPhotoWall()}
        <EventArchive sessionId={sid} />
      </div>
    )
  }

  return <div className="page ai-space-page">{renderHomePage()}</div>
}
