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
  saveLocalPhotos,
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
import { hasMovedSpacePhoto, projectSpaceDrawerPull, projectSpacePhotoDrag, shouldOpenSpaceDrawer, type ScenePhotoPlacement } from '../lib/spaceSceneDrag'

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
  const photosRef = useRef(photos)
  photosRef.current = photos
  const [photoUploading, setPhotoUploading] = useState(0)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const failedPhotoIdsRef = useRef<Set<string>>(new Set())
  const scenePhotoDragRef = useRef<{
    id: string
    pointerId: number
    element: HTMLSpanElement
    boardWidth: number
    boardHeight: number
    start: { x: number; y: number }
    origin: ScenePhotoPlacement
    latest: ScenePhotoPlacement
    frame: number | null
    moved: boolean
  } | null>(null)
  const drawerGestureRef = useRef<{
    pointerId: number
    element: HTMLSpanElement
    startY: number
    hitHeight: number
    moved: boolean
  } | null>(null)
  const ignoreDrawerClickRef = useRef(false)
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
    if (scenePhotoDragRef.current?.frame !== null && scenePhotoDragRef.current) {
      window.cancelAnimationFrame(scenePhotoDragRef.current.frame!)
    }
    scenePhotoDragRef.current = null
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
    if (drawerOpening || drawerReturning || drawerTimerRef.current !== null) return
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

  const finishDrawerGesture = () => {
    const drag = drawerGestureRef.current
    if (!drag) return
    drag.element.style.removeProperty('transform')
    drag.element.classList.remove('is-dragging')
    drawerGestureRef.current = null
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

  const defaultScenePlacement = (index: number) => {
    // 对齐定稿图里真实照片位；这里只换用户照片内容，不另画一套照片墙。
    const defaults = [
      { x: 8, y: 13, rotate: -5 },
      { x: 37, y: 14, rotate: 3 },
      { x: 68, y: 1, rotate: -2 },
      { x: 4, y: 43, rotate: 4 },
      { x: 31, y: 43, rotate: -4 },
      { x: 62, y: 53, rotate: 5 },
      { x: 5, y: 66, rotate: -2 },
      { x: 75, y: 70, rotate: 2 },
    ]
    return defaults[index % defaults.length]
  }

  const persistScenePhotoPlacements = (next: PhotoMeta[]) => {
    const token = getToken()
    if (token && sid) saveLocalPhotoMetadata(next, sid)
    else saveLocalPhotos(next, sid)
  }

  // Game-style drag: compose only the touched photo on animation frames.
  // React state and photo metadata are committed once, when the finger lifts.
  const paintScenePhoto = (element: HTMLSpanElement, point: ScenePhotoPlacement) => {
    element.style.setProperty('--scene-photo-x', `${point.x}%`)
    element.style.setProperty('--scene-photo-y', `${point.y}%`)
  }

  const queueScenePhotoFrame = () => {
    const drag = scenePhotoDragRef.current
    if (!drag || drag.frame !== null) return
    drag.frame = window.requestAnimationFrame(() => {
      drag.frame = null
      if (scenePhotoDragRef.current === drag) paintScenePhoto(drag.element, drag.latest)
    })
  }

  const finishScenePhotoDrag = (commit: boolean, pointer?: { x: number; y: number }) => {
    const drag = scenePhotoDragRef.current
    if (!drag) return
    scenePhotoDragRef.current = null
    if (drag.frame !== null) window.cancelAnimationFrame(drag.frame)
    drag.element.classList.remove('is-dragging')
    if (!commit) {
      paintScenePhoto(drag.element, drag.origin)
      return
    }
    const nextPoint = pointer
      ? projectSpacePhotoDrag(drag.origin, drag.start, pointer, drag.boardWidth, drag.boardHeight)
      : drag.latest
    paintScenePhoto(drag.element, nextPoint)
    const nextPhotos = photosRef.current.map((photo) => photo.id === drag.id
      ? { ...photo, scenePlacement: nextPoint }
      : photo)
    photosRef.current = nextPhotos
    persistScenePhotoPlacements(nextPhotos)
    setPhotos(nextPhotos)
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

    const openPhotoWallFromScene = () => {
      openDeskObject('photos', openPhotoWall)
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
        </section>

        {/*
          Mobile first: the approved 941×1672 artwork is the only coordinate system.
          Physical objects must stay on that artwork/cutout layer; CSS here only
          carries real content, hit areas and motion.
        */}
        <div className="space-scene-hotspots">
          <button
            type="button"
            className={`space-scene-hotspot is-photo-wall${openingObject === 'photos' ? ' is-lifting' : ''}`}
            aria-label="打开照片墙"
            onClick={openPhotoWallFromScene}
          >
            <span className="space-scene-art-crop is-photo-wall-art" aria-hidden="true">
              <img src="/space/space-desk.webp" alt="" draggable={false} />
            </span>
            <span className="space-live-photo-board" aria-label="空间页照片摆放区">
              {Array.from({ length: 8 }, (_, index) => (
                <i key={`photo-slot-${index}`} className={`space-photo-slot-mask is-slot-${index + 1}`} aria-hidden="true" />
              ))}
              {scenePhotos.map((photo, index) => {
                const placement = photo.scenePlacement ?? defaultScenePlacement(index)
                return (
                  <span
                    key={photo.id}
                    className="space-live-photo"
                    style={{
                      '--scene-photo-x': `${placement.x}%`,
                      '--scene-photo-y': `${placement.y}%`,
                      '--scene-photo-r': `${placement.rotate}deg`,
                      '--scene-photo-delay': `${-((index * 1.7) % 12)}s`,
                      '--scene-photo-duration': `${12 + ((index * 13) % 55) / 10}s`,
                    } as React.CSSProperties}
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      if (scenePhotoDragRef.current || !event.isPrimary) return
                      const board = event.currentTarget.parentElement?.getBoundingClientRect()
                      if (!board || board.width <= 0 || board.height <= 0) return
                      scenePhotoDragRef.current = {
                        id: photo.id,
                        pointerId: event.pointerId,
                        element: event.currentTarget,
                        boardWidth: board.width,
                        boardHeight: board.height,
                        start: { x: event.clientX, y: event.clientY },
                        origin: { ...placement },
                        latest: { ...placement },
                        frame: null,
                        moved: false,
                      }
                      event.currentTarget.setPointerCapture?.(event.pointerId)
                    }}
                    onPointerMove={(event) => {
                      const drag = scenePhotoDragRef.current
                      if (!drag || drag.id !== photo.id || drag.pointerId !== event.pointerId) return
                      event.stopPropagation()
                      const pointer = { x: event.clientX, y: event.clientY }
                      if (!drag.moved && hasMovedSpacePhoto(drag.start, pointer)) {
                        drag.moved = true
                        drag.element.classList.add('is-dragging')
                      }
                      if (!drag.moved) return
                      drag.latest = projectSpacePhotoDrag(
                        drag.origin, drag.start, pointer, drag.boardWidth, drag.boardHeight,
                      )
                      queueScenePhotoFrame()
                    }}
                    onPointerUp={(event) => {
                      const drag = scenePhotoDragRef.current
                      if (!drag || drag.id !== photo.id || drag.pointerId !== event.pointerId) return
                      event.stopPropagation()
                      const pointer = { x: event.clientX, y: event.clientY }
                      if (drag.moved || hasMovedSpacePhoto(drag.start, pointer)) {
                        event.preventDefault()
                        finishScenePhotoDrag(true, pointer)
                      } else {
                        finishScenePhotoDrag(false)
                        openPhotoWallFromScene()
                      }
                    }}
                    onPointerCancel={(event) => {
                      if (scenePhotoDragRef.current?.pointerId === event.pointerId) {
                        event.stopPropagation()
                        finishScenePhotoDrag(false)
                      }
                    }}
                    onLostPointerCapture={(event) => {
                      if (scenePhotoDragRef.current?.pointerId === event.pointerId) {
                        finishScenePhotoDrag(false)
                      }
                    }}
                    onClick={(event) => event.stopPropagation()}
                  >
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
                )
              })}
            </span>
          </button>

          <button
            type="button"
            className={`space-scene-hotspot is-star-jar${openingObject === 'jar' ? ' is-lifting' : ''}`}
            aria-label={memoryCount > 0 ? `打开记忆星星罐，共 ${memoryCount} 颗星` : '打开空的记忆星星罐'}
            onClick={() => openDeskObject('jar', onOpenStarJar)}
          >
            <img
              className="space-object-cutout is-jar-cutout"
              src="/space/cutouts/memory-jar.png"
              alt=""
              aria-hidden="true"
              draggable={false}
            />
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
            <img
              className="space-object-cutout is-book-cutout"
              src="/space/cutouts/thought-book.png"
              alt=""
              aria-hidden="true"
              draggable={false}
            />
            <span className="space-live-book" aria-hidden="true">
              {latestThought ? <span>{latestThought.text}</span> : null}
            </span>
          </button>

          <button
            type="button"
            className={`space-scene-hotspot is-player${listenSnapshot.playing ? ' is-playing' : ''}${openingObject === 'player' ? ' is-lifting' : ''}`}
            aria-label={listenSnapshot.hasTrack ? `打开一起听歌，正在听 ${listenSnapshot.title}` : '打开一起听歌，去接音乐'}
            onClick={() => openDeskObject('player', onOpenListen)}
          >
            <img
              className="space-object-cutout is-player-cutout"
              src="/space/cutouts/music-player.png"
              alt=""
              aria-hidden="true"
              draggable={false}
            />
            <span className="space-live-player" aria-hidden="true">
              {listenSnapshot.hasTrack ? (
                <>
                  <strong>{listenSnapshot.title}</strong>
                  <span className="space-live-player-track">
                    <i style={{ transform: `scaleX(${progress})` }} />
                  </span>
                </>
              ) : (
                <strong className="space-live-player-connect">接音乐</strong>
              )}
            </span>
          </button>

          <button
            type="button"
            className={`space-scene-hotspot is-weekly-letter${drawerOpening ? ' is-opening' : ''}${drawerReturning ? ' is-returning' : ''}`}
            aria-label={weeklyCount > 0 ? `拉开抽屉，打开一周情书，共 ${weeklyCount} 封` : '拉开抽屉，打开一周情书'}
            onPointerDown={(event) => {
              if (drawerOpening || drawerReturning || !event.isPrimary || event.button !== 0) return
              const element = event.currentTarget.querySelector<HTMLSpanElement>('.space-drawer-peek')
              const hitHeight = event.currentTarget.getBoundingClientRect().height
              if (!element || hitHeight <= 0) return
              drawerGestureRef.current = {
                pointerId: event.pointerId,
                element,
                startY: event.clientY,
                hitHeight,
                moved: false,
              }
              event.currentTarget.setPointerCapture?.(event.pointerId)
            }}
            onPointerMove={(event) => {
              const drag = drawerGestureRef.current
              if (!drag || drag.pointerId !== event.pointerId) return
              if (!drag.moved && Math.abs(event.clientY - drag.startY) > 5) {
                drag.moved = true
                drag.element.classList.add('is-dragging')
              }
              if (!drag.moved) return
              const pull = projectSpaceDrawerPull(drag.startY, event.clientY, drag.hitHeight)
              drag.element.style.transform = `translate3d(0, ${pull}%, 0)`
            }}
            onPointerUp={(event) => {
              const drag = drawerGestureRef.current
              if (!drag || drag.pointerId !== event.pointerId) return
              const moved = drag.moved || Math.abs(event.clientY - drag.startY) > 5
              const pull = projectSpaceDrawerPull(drag.startY, event.clientY, drag.hitHeight)
              finishDrawerGesture()
              if (!moved) return // ordinary tap / keyboard activation uses onClick
              event.preventDefault()
              ignoreDrawerClickRef.current = true
              window.setTimeout(() => { ignoreDrawerClickRef.current = false }, 0)
              if (shouldOpenSpaceDrawer(pull)) openWeeklyFromDrawer()
            }}
            onPointerCancel={(event) => {
              if (drawerGestureRef.current?.pointerId === event.pointerId) finishDrawerGesture()
            }}
            onLostPointerCapture={(event) => {
              if (drawerGestureRef.current?.pointerId === event.pointerId) finishDrawerGesture()
            }}
            onClick={() => {
              if (ignoreDrawerClickRef.current) {
                ignoreDrawerClickRef.current = false
                return
              }
              openWeeklyFromDrawer()
            }}
            disabled={drawerOpening || drawerReturning}
          >
            <span className="space-drawer-peek" aria-hidden="true">
              <span className="space-scene-art-crop is-drawer-art">
                <img src="/space/space-desk.webp" alt="" draggable={false} />
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
