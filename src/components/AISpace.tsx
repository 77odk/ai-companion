import { useEffect, useMemo, useRef, useState } from 'react'
import { computeDaysKnown } from '../lib/aiSpaceDetail'
import WeeklyPage from './WeeklyPage'
import { getActiveSessionId, getMessagesCache } from '../lib/sessionStore'
import { getWeeklyReviews, type WeeklyReview } from '../lib/weeklyReview'
import { getFirstSeen, loadMessages } from '../lib/storage'
import { getAnniversaries } from '../lib/anniversary'
import { getSpaceDays } from '../lib/spaceDays'
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
  /** 进入时的初始子页：home 空间主页（原 memories 记忆墙入口已移除，记忆入口唯一为底部「记忆」Tab） */
  initialPage?: 'home'
  /** 引导「去写人设」/「去配置」跳「我的」页（App 里即 settings 视图） */
  onGoMine?: () => void
}

/** 时间戳 → 8月2日（照片日期用） */
function fmtMD(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export default function AISpace({ initialPage = 'home', onGoMine }: Props) {
  // 当前会话（S2 空间按角色独立）：有会话 → 消息/首次见面全用该会话数据，无会话兜底全局
  const sessionId = getActiveSessionId()
  const sid = sessionId || undefined

  // 子页面路由：home 空间主页 / events 一起经历过 / weekly 周记
  const [page, setPage] = useState<'home' | 'events' | 'weekly'>(initialPage)

  // 重要的日子（SPACE-DAYS-V2）：personal + couple、排除 milestone、最多 3 条；
  // 走正常组件生命周期读取（挂载时读一次；与 Home 同源 getAnniversaries，不另做实时监听）
  const spaceDays = useMemo(() => getSpaceDays(getAnniversaries(sid)), [sid])

  // 相识天数（首页同口径：getFirstSeen + computeDaysKnown）
  const firstSeen = useMemo(() => getFirstSeen(sid), [sid])
  const days = useMemo(() => computeDaysKnown(firstSeen), [firstSeen])

  // 周记：最近一篇（getWeeklyReviews 已按 createdAt 降序）
  const [weekly] = useState<WeeklyReview | null>(() => getWeeklyReviews(sid)[0] ?? null)

  // 聊过多少次：有会话读会话消息缓存，无会话兜底全局
  const [messageCount] = useState<number>(() =>
    sid ? getMessagesCache(sid).length : loadMessages().length,
  )

  // 一起经历过：数据源 = getSharedExperiences（E3 起 = Event，按会话隔离、occurredAt 倒序）
  // eventsVersion：手动添加/编辑/删除后自增，驱动时间轴重算
  const [eventsVersion, setEventsVersion] = useState(0)
  const timelineNodes = useMemo(() => getSharedExperiences(sid), [sid, eventsVersion])

  /* ---- Event 手动添加 / 编辑 / 删除（E3：source='manual'、confidence=1、不调模型） ---- */
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
    setFormDate(ev ? `${d.getFullYear()}-${m}-${dd}` : `${d.getFullYear()}-${m}-${dd}`)
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

  const goHome = () => setPage('home')

  /* ---- 照片墙（第 7 批：真上传 + 网格 + 点开大图） ---- */

  // 本地元数据缓存（登录用户只存 id/日期/尺寸；游客本地存 dataUrl 兜底渲染）
  const [photos, setPhotos] = useState<PhotoMeta[]>(() => loadLocalPhotos(sid))
  // 上传中（数量）：网格里显示占位，避免重复点
  const [photoUploading, setPhotoUploading] = useState(0)
  // 点开的大图 id（lightbox）
  const [lightboxId, setLightboxId] = useState<string | null>(null)
  // 上传错误提示（超限/413/网络），几秒后自动消失
  const [photoError, setPhotoError] = useState<string | null>(null)
  // 隐藏的文件选择 input（空态引导 + 网格添加入口共用）
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // 进入空间主页时：有登录态 → 拉云端列表合并（契约：按需拉，不进 /api/sync）
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

  // 单张处理：压缩 → 上传（有 token）/ 本地存（游客）→ 更新列表
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
      // 游客：无 token 不上云，dataUrl 落本地缓存（登录后云端列表会合并进来）
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

  // 多选逐张串行上传（避免并发请求乱序；与聊天串行上传同一原则）
  async function handlePhotoFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const list = Array.from(files)
    setPhotoError(null)
    setPhotoUploading(list.length)
    for (const f of list) {
      await handlePhotoFile(f)
    }
    setPhotoUploading(0)
  }

  // 照片墙：空态（引导 + 添加）/ 网格（3 列 4:3，左下角日期）/ 上传中占位 / 点开大图
  function renderPhotoWall() {
    const token = getToken()
    return (
      <section className="ai-space-v2-section">
        <div className="ai-space-v2-head">
          <span className="ai-space-v2-title">照片墙</span>
          <span className="ai-space-v2-en">PHOTOS</span>
        </div>

        {photos.length === 0 && photoUploading === 0 ? (
          <div
            className="ai-space-photo-add"
            role="button"
            tabIndex={0}
            aria-label="添加照片"
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                fileInputRef.current?.click()
              }
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            <p>从第一张开始，慢慢留下我们的日子。</p>
          </div>
        ) : (
          <div className="ai-photo-grid">
            {photos.map((p) => (
              <button
                key={p.id}
                type="button"
                className="ai-photo-cell"
                onClick={() => setLightboxId(p.id)}
              >
                <img
                  src={p.dataUrl ?? photoUrl(p.id, token)}
                  alt=""
                  loading="lazy"
                  className="ai-photo-img"
                />
                <span className="ai-photo-date">{fmtMD(p.createdAt)}</span>
              </button>
            ))}
            {photoUploading > 0 && (
              <div className="ai-photo-cell ai-photo-uploading" aria-label="上传中">
                <span className="ai-photo-spinner" />
              </div>
            )}
          </div>
        )}

        {photoError && <p className="ai-photo-err">{photoError}</p>}

        {/* 隐藏文件选择：网格右上 + 空态引导共用 */}
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
        {/* 网格时右上角仍留添加入口 */}
        {photos.length > 0 && (
          <button
            type="button"
            className="ai-photo-add-more"
            onClick={() => fileInputRef.current?.click()}
          >
            添加 ›
          </button>
        )}

        {/* 点开大图 */}
        {lightboxId && (
          <div
            className="ai-photo-lightbox"
            role="dialog"
            aria-label="查看大图"
            onClick={() => setLightboxId(null)}
          >
            {(() => {
              const p = photos.find((x) => x.id === lightboxId)
              if (!p) return null
              return (
                <img
                  src={p.dataUrl ?? photoUrl(p.id, token)}
                  alt=""
                  className="ai-photo-lightbox-img"
                />
              )
            })()}
          </div>
        )}
      </section>
    )
  }

  /* ---- 子页面渲染 ---- */

  /** 空间主页（SPACE-DAYS-V2 最终顺序：顶部一句 / 周记 / 照片墙 / 重要的日子 / 一起经历过 / 底部注脚） */
  function renderHomePage() {
    return (
      <div className="ai-space-v2">
        <p className="ai-space-v2-line">我们已经认识 {days} 天了。</p>

        {/* 周记 */}
        <section className="ai-space-v2-section">
          <div className="ai-space-v2-head">
            <span className="ai-space-v2-title">周记</span>
            <span className="ai-space-v2-en">WEEKLY</span>
            <button type="button" className="ai-space-v2-all" onClick={() => setPage('weekly')}>
              全部 ›
            </button>
          </div>
          <button type="button" className="ai-space-weekly-card" onClick={() => setPage('weekly')}>
            {weekly ? (
              <>
                <span className="ai-space-weekly-label">{weekly.weekLabel}</span>
                <span className="ai-space-weekly-title">
                  {weekly.title.length > 20 ? `${weekly.title.slice(0, 20)}…` : weekly.title}
                </span>
              </>
            ) : (
              <span className="ai-space-weekly-empty">TA 还没写过周记</span>
            )}
          </button>
        </section>

        {/* 照片墙（第 7 批：真上传 + 网格 + 点开大图） */}
        {renderPhotoWall()}

        {/* 重要的日子：时间导航/日期目录（personal + couple，排除 milestone，最多 3 条） */}
        <section className="ai-space-v2-section">
          <div className="ai-space-v2-head">
            <span className="ai-space-v2-title">重要的日子</span>
            <span className="ai-space-v2-en">DAYS</span>
          </div>
          {spaceDays.length === 0 ? (
            <p className="ai-space-empty">还没有写下重要的日子——以后值得记住的日期，会慢慢留在这里。</p>
          ) : (
            <div className="ai-space-days">
              {spaceDays.map((d) => (
                <div key={d.id} className="ai-space-day">
                  <time
                    className="ai-space-day-date"
                    dateTime={d.dateValue.length === 5 ? `--${d.dateValue}` : d.dateValue}
                  >
                    {d.dateText}
                  </time>
                  <span className="ai-space-day-label">{d.label}</span>
                  <span className="ai-space-day-count">{d.countText}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 一起经历过：竖线时间轴（数据 = Event） */}
        <section className="ai-space-v2-section">
          <div className="ai-space-v2-head">
            <span className="ai-space-v2-title">一起经历过</span>
            <span className="ai-space-v2-en">TIMELINE</span>
            <button type="button" className="ai-space-v2-all" onClick={() => setPage('events')}>
              全部 ›
            </button>
          </div>
          {timelineNodes.length === 0 ? (
            <p className="ai-space-empty">你们还没有一起经历过的事——从今天起，你们一起做过的事会自己留在这里。</p>
          ) : (
            renderSharedTimeline(timelineNodes.slice(0, 3))
          )}
        </section>

        {/* 底部注脚（聊过 0 次时隐藏那一段；Space 不再承担 Memory 入口，不显示记忆条数） */}
        <p className="ai-space-footnote">{days} 天{messageCount > 0 ? ` · 聊过 ${messageCount} 次` : ''}</p>
      </div>
    )
  }

  /** TA所记子页：你们的大小事（完整时间轴；数据源 = Event，E3） */
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

        {/* 手动添加 / 编辑表单（E3：标题必填、日期必填、描述/类型可选；未来日期拒绝；不调模型） */}
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
            <p className="ai-space-empty">你们还没有一起经历过的事——从今天起，你们一起做过的事会自己留在这里。</p>
          ) : (
            renderSharedTimeline(timelineNodes)
          )}
        </div>
      </>
    )
  }

  /** 竖线时间轴：节点 = 「09月01日 · 第 N 天」+ 标题 + 描述（有才显示）；行尾编辑/删除（E3） */
  function renderSharedTimeline(nodes: ReturnType<typeof getSharedExperiences>) {
    const byId = new Map(getEvents(sid).map((e) => [e.id, e]))
    return (
      <div className="ai-shared-timeline">
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
                {ev && (
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

  // 相与书子页：直接整页复用周记页（不套 ai-space 滚动容器，返回回空间资料页）
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
