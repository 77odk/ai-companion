import { useEffect, useMemo, useRef, useState } from 'react'
import PhotoWallArchive from './PhotoWallArchive'
import { getActiveSessionId, getMemoriesCache } from '../lib/sessionStore'
import { loadMemory, MEMORY_UPDATED_EVENT } from '../lib/memory'
import { ELUVIN_DATA_CHANGE } from '../lib/dataChange'
import { loadTaThoughts } from '../lib/taThoughts'
import { getWeeklyReviews } from '../lib/weeklyReview'
import {
  getListenTogetherSnapshot,
  subscribeListenTogether,
} from '../lib/listenTogetherState'
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

type DeskObjectKind = 'photos' | 'jar' | 'book' | 'player'
let carriedDeskObject: Exclude<DeskObjectKind, 'photos'> | null = null
let drawerNeedsReturn = false


function sceneMemoryCount(sessionId: string): number {
  const global = loadMemory().filter((item) => item.explicit === true && item.text?.trim())
  const session = sessionId ? getMemoriesCache(sessionId).filter((item) => item.text?.trim()) : []
  return global.length + session.length
}

export default function AISpace({ onOpenStarJar, onOpenThoughts, onOpenListen, onOpenWeekly }: Props) {
  const sessionId = getActiveSessionId()
  const sid = sessionId || undefined
  const [sceneVersion, setSceneVersion] = useState(0)
  const [listenSnapshot, setListenSnapshot] = useState(() => getListenTogetherSnapshot(sessionId))

  useEffect(() => {
    setListenSnapshot(getListenTogetherSnapshot(sessionId))
    return subscribeListenTogether(sessionId, setListenSnapshot)
  }, [sessionId])

  useEffect(() => {
    const refresh = () => setSceneVersion((value) => value + 1)
    window.addEventListener(MEMORY_UPDATED_EVENT, refresh)
    window.addEventListener(ELUVIN_DATA_CHANGE, refresh)
    return () => {
      window.removeEventListener(MEMORY_UPDATED_EVENT, refresh)
      window.removeEventListener(ELUVIN_DATA_CHANGE, refresh)
    }
  }, [])

  const memoryCount = useMemo(
    () => sceneMemoryCount(sessionId),
    [sessionId, sceneVersion],
  )
  const latestThought = useMemo(
    () => sessionId ? loadTaThoughts(sessionId)[0] ?? null : null,
    [sessionId, sceneVersion],
  )
  const weeklyCount = useMemo(
    () => getWeeklyReviews(sid).length,
    [sid, sceneVersion],
  )

  /* ---- 照片墙：上传/数据源沿用旧实现，展示交给稳定长墙组件。 ---- */
  const [photos, setPhotos] = useState<PhotoMeta[]>(() => loadLocalPhotos(sid))
  const [photoUploading, setPhotoUploading] = useState(0)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const failedPhotoIdsRef = useRef<Set<string>>(new Set())
  const drawerTimerRef = useRef<number | null>(null)
  const objectTimerRef = useRef<number | null>(null)
  const [drawerOpening, setDrawerOpening] = useState(false)
  const [drawerReturning, setDrawerReturning] = useState(() => {
    const returning = drawerNeedsReturn
    drawerNeedsReturn = false
    return returning
  })
  const [openingObject, setOpeningObject] = useState<DeskObjectKind | null>(null)
  const [placingObject, setPlacingObject] = useState<DeskObjectKind | null>(() => {
    const returning = carriedDeskObject
    carriedDeskObject = null
    return returning
  })

  const beginPlaceBack = (kind: DeskObjectKind) => {
    setPlacingObject(kind)
  }

  useEffect(() => {
    if (!placingObject) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const timer = window.setTimeout(() => setPlacingObject(null), reduce ? 1 : 420)
    return () => window.clearTimeout(timer)
  }, [placingObject])

  useEffect(() => {
    if (!drawerReturning) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const timer = window.setTimeout(() => setDrawerReturning(false), reduce ? 1 : 460)
    return () => window.clearTimeout(timer)
  }, [drawerReturning])

  useEffect(() => () => {
    if (drawerTimerRef.current !== null) window.clearTimeout(drawerTimerRef.current)
    if (objectTimerRef.current !== null) window.clearTimeout(objectTimerRef.current)
  }, [])

  const openDeskObject = (
    kind: DeskObjectKind,
    open: () => void,
  ) => {
    if (openingObject || drawerOpening) return
    setOpeningObject(kind)
    if (objectTimerRef.current !== null) window.clearTimeout(objectTimerRef.current)
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    objectTimerRef.current = window.setTimeout(() => {
      objectTimerRef.current = null
      if (kind !== 'photos') carriedDeskObject = kind
      open()
      setOpeningObject(null)
    }, reduce ? 1 : 310)
  }

  const openWeeklyFromDrawer = () => {
    if (drawerOpening) return
    setDrawerOpening(true)
    if (drawerTimerRef.current !== null) window.clearTimeout(drawerTimerRef.current)
    const delay = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 1 : 470
    drawerTimerRef.current = window.setTimeout(() => {
      drawerTimerRef.current = null
      drawerNeedsReturn = true
      onOpenWeekly()
      setDrawerOpening(false)
    }, delay)
  }

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
          onOpenChange={(open) => {
            if (!open) beginPlaceBack('photos')
          }}
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
    const token = getToken()
    const scenePhotos = photos.slice(0, 8)
    const progress = listenSnapshot.duration > 0
      ? Math.max(0, Math.min(1, listenSnapshot.current / listenSnapshot.duration))
      : 0
    const openPhotoWall = () => {
      document
        .querySelector<HTMLButtonElement>('.ai-space-page .photo-stack-preview, .ai-space-page .photo-archive-empty')
        ?.click()
    }

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
          <span className="space-plant-motion is-hanging" aria-hidden="true">
            <i className="is-tip-a" />
            <i className="is-tip-b" />
            <i className="is-tip-c" />
          </span>
          <span className="space-plant-motion is-right" aria-hidden="true">
            <i className="is-tip-a" />
            <i className="is-tip-b" />
          </span>
        </section>

        {/*
          The approved artwork remains the visual coordinate system. Photo archive
          access stays mounted here; shared experiences moved to Chaomu in S3,
          while desk objects use the S2 CSS/SVG interaction layer.
        */}
        <div className="space-scene-hotspots">
          <button
            type="button"
            className={`space-scene-hotspot is-photo-wall${openingObject === 'photos' ? ' is-lifting' : ''}`}
            aria-label="打开照片墙"
            onClick={() => openDeskObject('photos', openPhotoWall)}
          >
            <img className="space-object-asset is-photo-board" src="/space/generated/photo-board.svg" alt="" aria-hidden="true" draggable={false} />
            <span className="space-live-photo-board" aria-hidden="true">
              {scenePhotos.map((photo, index) => (
                <span key={photo.id} className={`space-live-photo is-p${index}`}>
                  <img
                    src={photo.dataUrl ?? photoUrl(photo.id, token)}
                    alt=""
                    draggable={false}
                    onError={() => {
                      failedPhotoIdsRef.current.add(photo.id)
                      setPhotoError(PHOTO_IMAGE_LOAD_ERROR)
                    }}
                    onLoad={() => {
                      failedPhotoIdsRef.current.delete(photo.id)
                      if (failedPhotoIdsRef.current.size === 0) {
                        setPhotoError((current) => current === PHOTO_IMAGE_LOAD_ERROR ? null : current)
                      }
                    }}
                  />
                </span>
              ))}
            </span>
          </button>

          <button
            type="button"
            className={`space-scene-hotspot is-star-jar${openingObject === 'jar' ? ' is-lifting' : ''}`}
            aria-label={memoryCount > 0 ? `打开记忆星星罐，共 ${memoryCount} 颗星` : '打开空的记忆星星罐'}
            onClick={() => openDeskObject('jar', onOpenStarJar)}
          >
            <img className="space-object-asset is-jar" src="/space/generated/jar.svg" alt="" aria-hidden="true" draggable={false} />
            <span className="space-live-jar" aria-hidden="true">
              <span className="space-live-jar-glint" />
              <span className="space-live-star-field">
                {Array.from({ length: memoryCount }, (_, index) => (
                  <i
                    key={index}
                    className="space-live-star"
                    style={{
                      '--live-star-x': `${8 + ((index * 41) % 84)}%`,
                      '--live-star-y': `${18 + ((index * 29) % 69)}%`,
                      '--live-star-r': `${-24 + ((index * 31) % 49)}deg`,
                      '--live-star-d': `${-((index * 0.37) % 6.7)}s`,
                      '--live-star-t': `${5.8 + ((index * 17) % 28) / 10}s`,
                      '--live-star-h': `${(index * 47) % 360}`,
                    } as React.CSSProperties}
                  />
                ))}
              </span>
            </span>
          </button>

          <button
            type="button"
            className={`space-scene-hotspot is-thought-book${openingObject === 'book' ? ' is-lifting' : ''}`}
            aria-label="打开 TA 的思绪"
            onClick={() => openDeskObject('book', onOpenThoughts)}
          >
            <img className="space-object-asset is-book" src="/space/generated/book.svg" alt="" aria-hidden="true" draggable={false} />
            <span className="space-live-book" aria-hidden="true">
              {latestThought ? <span>{latestThought.text}</span> : null}
            </span>
          </button>

          <button
            type="button"
            className={`space-scene-hotspot is-player${listenSnapshot.playing ? ' is-playing' : ''}${openingObject === 'player' ? ' is-lifting' : ''}`}
            aria-label={listenSnapshot.hasTrack ? `打开一起听歌，正在听 ${listenSnapshot.title}` : '打开一起听歌'}
            onClick={() => openDeskObject('player', onOpenListen)}
          >
            <span className="space-live-player" aria-hidden="true">
              {listenSnapshot.hasTrack ? (
                <>
                  <strong>{listenSnapshot.title}</strong>
                  <span className="space-live-player-track">
                    <i style={{ transform: `scaleX(${progress})` }} />
                  </span>
                </>
              ) : null}
            </span>
            <span className="space-live-earphone-wire" aria-hidden="true" />
          </button>

          <button
            type="button"
            className={`space-scene-hotspot is-weekly-letter${drawerOpening ? ' is-opening' : ''}${drawerReturning ? ' is-returning' : ''}`}
            aria-label="拉开抽屉，打开一周情书"
            onClick={openWeeklyFromDrawer}
            disabled={drawerOpening}
          >
            <span className="space-drawer-peek" aria-hidden="true">
              <span className="space-drawer-interior">
                {Array.from({ length: Math.min(5, weeklyCount) }, (_, index) => (
                  <i key={index} style={{ '--letter-i': index } as React.CSSProperties} />
                ))}
              </span>
            </span>
          </button>
        </div>

        <div className="space-scene-service-host">
          {renderPhotoWall()}
        </div>
      </>
    )
  }

  return <div className={`page ai-space-page${placingObject ? ` is-placing-${placingObject}` : ''}`}>{renderHomePage()}</div>
}
