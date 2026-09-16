import { useEffect, useMemo, useRef, useState } from 'react'
import WeeklyPage from './WeeklyPage'
import PhotoWallArchive from './PhotoWallArchive'
import { getActiveSessionId } from '../lib/sessionStore'
import { getWeeklyReviews, type WeeklyReview } from '../lib/weeklyReview'
import {
  loadLocalPhotos,
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
import { getSharedExperiences, formatSharedDate } from '../lib/sharedExperiences'
import {
  createEvent,
  updateEvent,
  softDeleteEvent,
  getEvents,
  EVENT_TYPES,
  type CompanionEvent,
  type EventType,
} from '../lib/eventStore'

interface Props {
  /** 进入时的初始子页：home 空间主页（记忆入口唯一为底部「记忆」Tab） */
  initialPage?: 'home'
  /** 引导「去写人设」/「去配置」跳「我的」页（App 里即 settings 视图） */
  onGoMine?: () => void
}

/** 首页信封只露一小段正文，不把一周情书直接摊开。 */
function weeklyPreview(review: WeeklyReview): string {
  const clean = review.content.replace(/\s+/g, ' ').trim()
  if (!clean) return review.title
  return clean.length > 48 ? `${clean.slice(0, 48)}…` : clean
}

export default function AISpace({ initialPage = 'home', onGoMine }: Props) {
  const sessionId = getActiveSessionId()
  const sid = sessionId || undefined

  // 子页面路由：home 空间主页 / events 一起经历过 / weekly 一周情书
  const [page, setPage] = useState<'home' | 'events' | 'weekly'>(initialPage)
  const [weeklyVersion, setWeeklyVersion] = useState(0)
  const weekly = useMemo<WeeklyReview | null>(
    () => getWeeklyReviews(sid)[0] ?? null,
    [sid, weeklyVersion],
  )

  // 一起经历过：数据源 = Event，按会话隔离、occurredAt 倒序。
  const [eventsVersion, setEventsVersion] = useState(0)
  const timelineNodes = useMemo(() => getSharedExperiences(sid), [sid, eventsVersion])

  /* ---- Event 手动添加 / 编辑 / 删除（沿用 E3；本批不改 Event 语义与数据结构） ---- */
  const [eventFormOpen, setEventFormOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<CompanionEvent | null>(null)
  const [formTitle, setFormTitle] = useState('')
  const [formDate, setFormDate] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formType, setFormType] = useState<EventType>('activity')
  const [eventFormError, setEventFormError] = useState<string | null>(null)

  const openEventForm = (ev: CompanionEvent | null) => {
    setEditingEvent(ev)
    setFormTitle(ev?.title ?? '')
    setFormDesc(ev?.description ?? '')
    setFormType((ev?.type as EventType) ?? 'activity')
    const d = ev ? new Date(ev.occurredAt) : new Date()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    setFormDate(`${d.getFullYear()}-${m}-${dd}`)
    setEventFormError(null)
    setEventFormOpen(true)
  }

  const saveEventForm = () => {
    const title = formTitle.trim()
    if (!title) {
      setEventFormError('给这件事起个标题吧')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(formDate)) {
      setEventFormError('选一个日期')
      return
    }
    const occurredAt = new Date(`${formDate}T00:00:00`).getTime()
    if (!Number.isFinite(occurredAt) || occurredAt > Date.now()) {
      setEventFormError('这件事还没发生，先记在计划里吧')
      return
    }
    if (editingEvent) {
      updateEvent(sid, editingEvent.id, {
        title,
        description: formDesc.trim() || undefined,
        occurredAt,
        type: formType,
      })
    } else {
      createEvent({
        sessionId: sid,
        type: formType,
        title,
        ...(formDesc.trim() ? { description: formDesc.trim() } : {}),
        occurredAt,
        source: 'manual',
      })
    }
    setEventFormOpen(false)
    setEditingEvent(null)
    setEventsVersion((v) => v + 1)
  }

  const deleteEvent = (ev: CompanionEvent) => {
    if (!window.confirm(`删掉「${ev.title}」这条吗？`)) return
    softDeleteEvent(sid, ev.id)
    setEventsVersion((v) => v + 1)
  }

  const goHome = () => {
    setPage('home')
    setWeeklyVersion((v) => v + 1)
  }

  /* ---- 照片墙：上传/数据源沿用旧实现，展示交给稳定长墙组件。 ---- */
  const [photos, setPhotos] = useState<PhotoMeta[]>(() => loadLocalPhotos(sid))
  const [photoUploading, setPhotoUploading] = useState(0)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (page !== 'home' || !sid) return
    const token = getToken()
    if (!token) return
    let alive = true
    listPhotos(token, sid).then((res) => {
      if (!alive || !res.ok || !res.data) return
      const cloud: PhotoMeta[] = res.data.photos.map((p) => ({
        id: p.id,
        sessionId: p.sessionId,
        width: p.width,
        height: p.height,
        createdAt: p.createdAt,
      }))
      setPhotos((prev) => mergePhotos(prev, cloud))
    })
    return () => {
      alive = false
    }
  }, [page, sid])

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
        const p = res.data.photo
        const meta: PhotoMeta = {
          id: p.id,
          sessionId: p.sessionId,
          width: p.width,
          height: p.height,
          createdAt: p.createdAt,
        }
        setPhotos((prev) => mergePhotos([meta], prev))
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
    for (const f of list) await handlePhotoFile(f)
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
          onAdd={() => fileInputRef.current?.click()}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="ai-photo-file"
          onChange={(e) => {
            void handlePhotoFiles(e.target.files)
            e.target.value = ''
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
            <button type="button" className="ai-space-v2-all" onClick={() => setPage('weekly')}>
              查看全部 ›
            </button>
          </div>

          <button type="button" className="space-letter-envelope" onClick={() => setPage('weekly')}>
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

        <section className="ai-space-v2-section space-archive-section">
          <div className="ai-space-v2-head">
            <span className="ai-space-v2-title">一起经历过</span>
            <span className="ai-space-v2-en">MOMENTS WE SHARED</span>
            <button type="button" className="ai-space-v2-all" onClick={() => setPage('events')}>
              查看全部 ›
            </button>
          </div>
          {timelineNodes.length === 0 ? (
            <p className="ai-space-empty">有些日子，后来才知道很重要。</p>
          ) : (
            renderSharedTimeline(timelineNodes.slice(0, 3), true)
          )}
        </section>
      </div>
    )
  }

  function renderEventsPage() {
    return (
      <>
        <div className="ai-space-topbar ai-space-sub-bar">
          <button type="button" className="link-btn ai-space-back" onClick={() => setPage('home')}>
            ‹ 返回
          </button>
          <h2 className="ai-space-sub-title">一起经历过</h2>
          <button type="button" className="ai-space-v2-all" onClick={() => openEventForm(null)}>
            ＋ 添加一件事
          </button>
        </div>

        {eventFormOpen && (
          <div className="ai-event-form">
            <label className="ai-event-field">
              <span>标题（必填）</span>
              <input
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="比如：一起看了场电影"
              />
            </label>
            <label className="ai-event-field">
              <span>日期（必填）</span>
              <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} />
            </label>
            <label className="ai-event-field">
              <span>描述（可选）</span>
              <input
                type="text"
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder="想起来的小细节"
              />
            </label>
            <label className="ai-event-field">
              <span>类型（可选）</span>
              <select value={formType} onChange={(e) => setFormType(e.target.value as EventType)}>
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            {eventFormError && <p className="ai-event-error">{eventFormError}</p>}
            <div className="ai-event-actions">
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setEventFormOpen(false)
                  setEditingEvent(null)
                  setEventFormError(null)
                }}
              >
                取消
              </button>
              <button type="button" className="ai-event-save" onClick={saveEventForm}>
                {editingEvent ? '保存修改' : '记下来'}
              </button>
            </div>
          </div>
        )}

        <div className="ai-space-timeline">
          {timelineNodes.length === 0 ? (
            <p className="ai-space-empty">有些日子，后来才知道很重要。</p>
          ) : (
            renderSharedTimeline(timelineNodes)
          )}
        </div>
      </>
    )
  }

  function renderSharedTimeline(
    nodes: ReturnType<typeof getSharedExperiences>,
    compact = false,
  ) {
    const byId = new Map(getEvents(sid).map((e) => [e.id, e]))
    return (
      <div className={`ai-shared-timeline${compact ? ' is-compact' : ''}`}>
        {nodes.map((n) => {
          const ev = byId.get(n.id) ?? null
          return (
            <div key={n.id} className="ai-shared-item">
              <span className="ai-shared-dot" aria-hidden="true" />
              <div className="ai-shared-main">
                <span className="ai-shared-date">
                  {formatSharedDate(n.dateTs)} · 第 {n.day} 天
                </span>
                <p className="ai-shared-text">{n.title}</p>
                {n.description ? <p className="ai-shared-desc">{n.description}</p> : null}
                {!compact && ev && (
                  <span className="ai-shared-ops">
                    <button type="button" className="link-btn" onClick={() => openEventForm(ev)}>
                      编辑
                    </button>
                    <button type="button" className="link-btn ai-shared-del" onClick={() => deleteEvent(ev)}>
                      删除
                    </button>
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  if (page === 'weekly') {
    return <WeeklyPage onBack={goHome} onGoSettings={onGoMine ?? (() => {})} />
  }

  const pageClass = `page ai-space-page${page === 'events' ? ' ai-space-page-sub' : ''}`

  return (
    <div className={pageClass}>
      {page === 'events' ? renderEventsPage() : renderHomePage()}
    </div>
  )
}
