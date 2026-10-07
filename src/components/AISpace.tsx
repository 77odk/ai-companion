import { useEffect, useRef, useState } from 'react'
import PhotoWallArchive from './PhotoWallArchive'
import EventArchive from './EventArchive'
import { getActiveSessionId } from '../lib/sessionStore'
import {
  loadLocalPhotos,
  saveLocalPhotoMetadata,
  addLocalPhoto,
  removeLocalPhoto,
  mergePhotos,
  photoUrl,
  scaleImageToDataUrl,
  dataUrlBytes,
  uploadPhoto,
  listPhotos,
  deletePhoto,
  type PhotoMeta,
} from '../lib/photoWall'
import { getToken } from '../lib/auth'

interface Props {
  onOpenStarJar: () => void
  onOpenThoughts: () => void
  onOpenListen: () => void
  /** 一周情书由 App 顶层 view 承载，不在 Space 内嵌子页。 */
  onOpenWeekly: () => void
}

function normalizePhotoCreatedAt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function isValidCloudPhotoRow(value: unknown): value is {
  id: string
  sessionId: string
  width: number
  height: number
  createdAt: number | string
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  const createdAt = normalizePhotoCreatedAt(row.createdAt)
  return typeof row.id === 'string' && row.id.trim().length > 0
    && typeof row.sessionId === 'string'
    && typeof row.width === 'number' && Number.isFinite(row.width) && row.width > 0
    && typeof row.height === 'number' && Number.isFinite(row.height) && row.height > 0
    && createdAt > 0
}

const PHOTO_IMAGE_LOAD_ERROR = '有照片暂时没显示出来，照片还在，稍后再试。'

export default function AISpace({ onOpenStarJar, onOpenThoughts, onOpenListen, onOpenWeekly }: Props) {
  const sessionId = getActiveSessionId()
  const sid = sessionId || undefined

  /* ---- 照片墙：上传/数据源沿用旧实现，展示交给稳定长墙组件。 ---- */
  const [photos, setPhotos] = useState<PhotoMeta[]>(() => loadLocalPhotos(sid))
  const [photoUploading, setPhotoUploading] = useState(0)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const failedPhotoIdsRef = useRef<Set<string>>(new Set())

  const clearNonImagePhotoError = () => {
    setPhotoError((current) => current === PHOTO_IMAGE_LOAD_ERROR ? current : null)
  }

  useEffect(() => {
    const local = loadLocalPhotos(sid)
    failedPhotoIdsRef.current.clear()
    setPhotos(local)
    setPhotoError(null)
    if (!sid) return

    const token = getToken()
    if (!token) return

    let alive = true
    listPhotos(token, sid).then((res) => {
      if (!alive) return
      const cloudRows = res.data?.photos
      if (
        !res.ok
        || !Array.isArray(cloudRows)
        || cloudRows.some((photo) => !isValidCloudPhotoRow(photo))
      ) {
        setPhotoError(local.length > 0
          ? '云端照片暂时没加载完整，本机已有的先保留。'
          : '照片暂时没加载出来，稍后再试。')
        return
      }
      const cloud: PhotoMeta[] = cloudRows.map((photo) => ({
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

  async function handleDeletePhoto(photo: PhotoMeta): Promise<boolean> {
    const token = getToken()
    if (token && sid && !photo.id.startsWith('local-')) {
      const res = await deletePhoto(token, photo.id)
      if (!res.ok) {
        setPhotoError(res.message || '删除失败，稍后再试')
        return false
      }
    }
    setPhotos((prev) => {
      const next = prev.filter((item) => item.id !== photo.id)
      if (token && sid) saveLocalPhotoMetadata(next, sid)
      else removeLocalPhoto(photo.id, sid)
      return next
    })
    clearNonImagePhotoError()
    return true
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
          onPhotoLoadError={(photo) => {
            failedPhotoIdsRef.current.add(photo.id)
            setPhotoError(PHOTO_IMAGE_LOAD_ERROR)
          }}
          onPhotoLoadSuccess={(photo) => {
            failedPhotoIdsRef.current.delete(photo.id)
            if (failedPhotoIdsRef.current.size === 0) {
              setPhotoError((current) => current === PHOTO_IMAGE_LOAD_ERROR ? null : current)
            }
          }}
          onAdd={() => fileInputRef.current?.click()}
          onDelete={handleDeletePhoto}
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
      <>
        <section className="space-scene-shell" aria-label="TA 的空间">
          <img
            className="space-scene-backplate"
            src="/space/space-desk.webp"
            alt=""
            aria-hidden="true"
            draggable={false}
          />
          <span className="space-scene-ambient" aria-hidden="true" />
        </section>

        {/*
          S1 keeps the approved artwork visually untouched while preserving the
          existing Space capabilities. Transparent hit areas sit on the objects
          already present in the confirmed composition; S2 replaces these temporary
          compatibility entry points with the final CSS/SVG object interactions.
        */}
        <div className="space-scene-hotspots">
          <button
            type="button"
            className="space-scene-hotspot is-photo-wall"
            aria-label="打开照片墙"
            onClick={() => {
              document
                .querySelector<HTMLButtonElement>('.ai-space-page .photo-stack-preview, .ai-space-page .photo-archive-empty')
                ?.click()
            }}
          />
          <button
            type="button"
            className="space-scene-hotspot is-moments"
            aria-label="打开一起经历过"
            onClick={() => {
              document
                .querySelector<HTMLButtonElement>(
                  '.ai-space-page .event-archive-preview .ai-space-v2-all, .ai-space-page .event-archive-preview-item, .ai-space-page .event-archive-empty',
                )
                ?.click()
            }}
          />
          <button
            type="button"
            className="space-scene-hotspot is-star-jar"
            aria-label="打开记忆星星罐"
            onClick={onOpenStarJar}
          >
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <path className="space-object-glint" d="M27 18c-7 16-8 37-3 54" />
              <path className="space-object-rim" d="M23 18h54" />
            </svg>
          </button>
          <button
            type="button"
            className="space-scene-hotspot is-thought-book"
            aria-label="打开 TA 的思绪"
            onClick={onOpenThoughts}
          >
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <path className="space-object-paper-edge" d="M12 50c23-7 38-6 47 0 10-6 19-6 29-4" />
            </svg>
          </button>
          <button
            type="button"
            className="space-scene-hotspot is-player"
            aria-label="打开一起听歌"
            onClick={onOpenListen}
          >
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <rect className="space-object-screen-glow" x="14" y="20" width="72" height="54" rx="8" />
              <path className="space-object-progress" d="M24 63h37" />
            </svg>
          </button>
          <button
            type="button"
            className="space-scene-hotspot is-weekly-letter"
            aria-label="打开一周情书"
            onClick={onOpenWeekly}
          >
            <span className="space-drawer-peek" aria-hidden="true" />
          </button>
        </div>

        <div className="space-scene-service-host">
          {renderPhotoWall()}
          <EventArchive sessionId={sid} />
        </div>
      </>
    )
  }

  return <div className="page ai-space-page">{renderHomePage()}</div>
}
