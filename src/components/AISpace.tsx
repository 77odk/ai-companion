import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadMemory, type MemoryItem } from '../lib/memory'
import { computeDaysKnown, formatMemoryDate } from '../lib/aiSpaceDetail'
import WeeklyPage from './WeeklyPage'
import { getActiveSessionId, getMemoriesCache, getMessagesCache } from '../lib/sessionStore'
import { getWeeklyReviews, type WeeklyReview } from '../lib/weeklyReview'
import { getFirstSeen, loadMessages, loadSettings } from '../lib/storage'
import { chatCompletion } from '../lib/api'
import {
  groupMemoriesByTopic,
  pickRelationMemories,
  groupSummary,
  fingerprintOf,
  decideImpression,
  shouldAutoRegenerate,
} from '../lib/memoryWall'
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

interface Props {
  /** 进入时的初始子页：home 空间主页 / memories 记忆墙（「我的 → TA 记得的」直接进记忆墙） */
  initialPage?: 'home' | 'memories'
  /** 引导「去写人设」/「去配置」跳「我的」页（App 里即 settings 视图） */
  onGoMine?: () => void
}

/** 时间戳 → 8月2日（TA 记得的起始日期、底部注脚用） */
function fmtMD(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

// ── TA 眼中的你（LLM 生成 / 模板兜底 / 本地缓存）──
// 省 key 策略（批 2-2）：缓存里存指纹（记忆条数 + 最后一条记忆更新时间），
// 指纹没变 → 直接用缓存，绝不调模型；变了 → 标记 stale，还需
// 「距上次生成 >24h」+「用户在页面（或手动点更新）」才真调。
// 硬指标：自动生成每 24 小时最多 1 次。
const IMPRESSION_CACHE_PREFIX = 'ai_companion_impression'

interface ImpressionCacheLocal {
  text: string
  memCount: number
  lastMemTs: number
  genAt: number
}

function impressionKey(sid?: string): string {
  return sid ? `${IMPRESSION_CACHE_PREFIX}_${sid}` : IMPRESSION_CACHE_PREFIX
}

function loadImpressionCache(sid?: string): ImpressionCacheLocal | null {
  try {
    const raw = localStorage.getItem(impressionKey(sid))
    if (!raw) return null
    const d = JSON.parse(raw) as ImpressionCacheLocal
    return d && typeof d.text === 'string' ? d : null
  } catch {
    return null
  }
}

function saveImpressionCache(sid: string | undefined, data: ImpressionCacheLocal): void {
  try {
    localStorage.setItem(impressionKey(sid), JSON.stringify(data))
  } catch {
    // 存不下不影响
  }
}

const IMPRESSION_SYSTEM_PROMPT =
  '你是忆文里的 TA。基于对方告诉你的这些记忆，用 2-3 句话写下「你眼中的对方」：第一人称、口语、温暖，只基于给出的记忆事实，不编造、不猜测、不评价好坏。直接输出这段话，不要前缀。'

/** 模板兜底：最近两条记忆拼成一句（诚实、不造） */
function impressionTemplate(memories: MemoryItem[]): string {
  const top = memories.slice(0, 2)
  if (top.length === 0) return ''
  return top
    .map((m) => {
      const t = (m.text || '').trim()
      return t.length > 40 ? `${t.slice(0, 40)}…` : t
    })
    .join('。')
}

export default function AISpace({ initialPage = 'home', onGoMine }: Props) {
  // 当前会话（S2 空间按角色独立）：有会话 → 消息/记忆/首次见面全用该会话数据，无会话兜底全局
  const sessionId = getActiveSessionId()
  const sid = sessionId || undefined

  // 详情页数据：进空间时读一次（记忆不会在空间内变化）。
  // 有会话读当前会话缓存（后端填充），无会话兜底全局 localStorage（游客/过渡态）
  // 记忆来源与聊天注入同源（recallSessionMemories）：关于我（全局 explicit，所有角色共享）+ 当前角色会话记忆。
  // ★每次渲染直接读：在「关于我」里新写的记忆，回到空间/记忆墙要立刻看到（原来挂载读一次会漏）。
  const memories: MemoryItem[] = (() => {
    const global = loadMemory().filter((m) => m.explicit === true)
    return sid ? [...global, ...getMemoriesCache(sid)] : global
  })()

  // 子页面路由：home 空间主页 / memories 记忆墙（TA 记得的）/ events TA所记（大小事） / weekly TA所写（周记）
  const [page, setPage] = useState<'home' | 'memories' | 'events' | 'weekly'>(initialPage)

  const sortedMemories = useMemo(
    () => [...memories].sort((a, b) => b.createdAt - a.createdAt),
    [memories],
  )

  // 记忆墙：关于你（topic 分组）+ 我们之间（关键词挑）——只读映射，不写回数据
  const topicGroups = useMemo(() => groupMemoriesByTopic(memories), [memories])
  const relationMemories = useMemo(() => pickRelationMemories(memories), [memories])

  // 「TA 眼中的你」：指纹（条数 + 最后一条更新时间）没变 → 直接用缓存，绝不调模型；
  // 变了 → stale，还需「距上次生成 >24h」+「用户在页面（或手动点更新）」才真调；无 key / 失败回落模板。
  const [impression, setImpression] = useState<string | null>(null)
  const [impressionLoading, setImpressionLoading] = useState(false)
  // stale 提示（记忆有更新但 24h 节流未到，显示旧文 + 提示可手动更新）
  const [impressionStale, setImpressionStale] = useState(false)
  const impressionFp = useMemo(() => fingerprintOf(memories), [memories])

  const generateImpression = useCallback(
    (opts: { manual?: boolean } = {}) => {
      if (impressionFp.memCount === 0) {
        setImpression(null)
        setImpressionStale(false)
        return
      }
      const cache = loadImpressionCache(sid)
      const decision = decideImpression(cache, impressionFp)
      if (decision === 'fresh') {
        // 指纹没变 → 直接用缓存，绝不调模型（手动「更新」也一样）
        setImpression(cache!.text)
        setImpressionStale(false)
        return
      }
      if (!opts.manual) {
        // 自动：stale 还需 24h 节流 + 用户在页面（页面可见才生成，不做后台预生成）
        if (decision === 'stale' && !shouldAutoRegenerate(cache, Date.now())) {
          setImpression(cache!.text)
          setImpressionStale(true)
          return
        }
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      }
      const settings = loadSettings()
      const hasKey = Boolean(settings.apiKey?.trim() && settings.baseUrl?.trim() && settings.model?.trim())
      const fallback = () => {
        setImpression(impressionTemplate(impressionFp.memCount > 0 ? sortedMemories : []))
        setImpressionStale(false)
      }
      if (!hasKey) {
        fallback()
        return
      }
      setImpressionLoading(true)
      setImpression(null)
      const memoryLines = sortedMemories
        .slice(0, 20)
        .map((m) => {
          const t = (m.text || '').trim()
          return t.length > 60 ? `${t.slice(0, 60)}…` : t
        })
        .join('\n')
      chatCompletion(
        settings,
        [
          { role: 'system', content: IMPRESSION_SYSTEM_PROMPT },
          { role: 'user', content: `TA 记得关于你的这些事：\n${memoryLines}` },
        ],
        { maxTokens: 200, temperature: 0.8 },
      )
        .then((raw) => {
          const text = (raw || '').trim().replace(/^["“」]+|["”]+$/g, '')
          if (text) {
            setImpression(text)
            setImpressionStale(false)
            saveImpressionCache(sid, {
              text,
              memCount: impressionFp.memCount,
              lastMemTs: impressionFp.lastMemTs,
              genAt: Date.now(),
            })
          } else {
            fallback()
          }
        })
        .catch(() => {
          fallback()
        })
        .finally(() => {
          setImpressionLoading(false)
        })
    },
    [sid, impressionFp, sortedMemories],
  )

  // 打开记忆墙（挂载）时自动评估一次；记忆变化（指纹变）且 24h 已过时也会自动重生成
  useEffect(() => {
    generateImpression()
  }, [generateImpression])

  // 记忆墙：当前展开的「关于你」topic 组（null=收起）
  const [openTopicGroup, setOpenTopicGroup] = useState<string | null>(null)

  // 相识天数（首页同口径：getFirstSeen + computeDaysKnown）
  const firstSeen = useMemo(() => getFirstSeen(sid), [sid])
  const days = useMemo(() => computeDaysKnown(firstSeen), [firstSeen])

  // 周记：最近一篇（getWeeklyReviews 已按 createdAt 降序）
  const [weekly] = useState<WeeklyReview | null>(() => getWeeklyReviews(sid)[0] ?? null)

  // 聊过多少次：有会话读会话消息缓存，无会话兜底全局
  const [messageCount] = useState<number>(() =>
    sid ? getMessagesCache(sid).length : loadMessages().length,
  )

  // 一起经历过：数据源 = getSharedExperiences（legacy 记忆按天聚类；Event 上线后只换 lib 内部）
  const timelineNodes = useMemo(() => getSharedExperiences(sid), [sid, memories])

  // TA 记得的：一句印象取最近一条记忆（截断），无记忆给空态引导
  const memoryImpression = useMemo(() => {
    const first = sortedMemories[0]
    if (!first) return null
    return first.text.length > 30 ? `${first.text.slice(0, 30)}…` : first.text
  }, [sortedMemories])
  const memoryStartAt = useMemo(() => {
    let min = Infinity
    for (const m of memories) {
      if (typeof m.createdAt === 'number' && Number.isFinite(m.createdAt) && m.createdAt < min) min = m.createdAt
    }
    return Number.isFinite(min) ? min : null
  }, [memories])

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

  /** 空间主页（定稿第二屏：顶部一句 / 照片墙 / 一起经历过 / 周记 / TA 记得的 / 底部注脚） */
  function renderHomePage() {
    return (
      <div className="ai-space-v2">
        <p className="ai-space-v2-line">我们已经认识 {days} 天了。</p>

        {/* 照片墙（第 7 批：真上传 + 网格 + 点开大图） */}
        {renderPhotoWall()}

        {/* 一起经历过：竖线时间轴（只换渲染，数据 = getSharedExperiences 记忆聚类） */}
        <section className="ai-space-v2-section">
          <div className="ai-space-v2-head">
            <span className="ai-space-v2-title">一起经历过</span>
            <span className="ai-space-v2-en">TIMELINE</span>
            <button type="button" className="ai-space-v2-all" onClick={() => setPage('events')}>
              全部 ›
            </button>
          </div>
          {timelineNodes.length === 0 ? (
            <p className="ai-space-empty">多和 TA 聊聊，TA 会开始记得你们一起的事</p>
          ) : (
            renderSharedTimeline(timelineNodes.slice(0, 3))
          )}
        </section>

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

        {/* TA 记得的 */}
        <section className="ai-space-v2-section">
          <div className="ai-space-v2-head">
            <span className="ai-space-v2-title">TA 记得的</span>
            <span className="ai-space-v2-en">MEMORY</span>
            <button type="button" className="ai-space-v2-all" onClick={() => setPage('memories')}>
              全部 ›
            </button>
          </div>
          <button type="button" className="ai-space-memory-card" onClick={() => setPage('memories')}>
            {memoryImpression ? (
              <>
                <span className="ai-space-memory-line">{memoryImpression}</span>
                <span className="ai-space-memory-sub">
                  {memories.length} 件事{memoryStartAt ? ` · 从 ${fmtMD(memoryStartAt)} 开始` : ''}
                </span>
              </>
            ) : (
              <span className="ai-space-weekly-empty">多和 TA 聊聊，TA 会开始记得你</span>
            )}
          </button>
        </section>

        {/* 底部注脚（聊过 0 次时隐藏那一段，避免"没打开过聊天就显示 0"的观感） */}
        <p className="ai-space-footnote">
          {days} 天{messageCount > 0 ? ` · 聊过 ${messageCount} 次` : ''} · 记得 {memories.length} 件
        </p>
      </div>
    )
  }

  /** 记忆墙子页（定稿第三屏：TA 眼中的你 + 四组；点组展开明细） */
  function renderMemoriesPage() {
    return (
      <>
        <div className="ai-space-topbar ai-space-sub-bar">
          <button type="button" className="link-btn ai-space-back" onClick={() => setPage('home')}>
            ‹ 返回
          </button>
          <h2 className="ai-space-sub-title">TA 记得的</h2>
          <span className="ai-space-topbar-spacer" aria-hidden="true" />
        </div>

        <div className="ai-space-timeline">
          {/* TA 眼中的你：汇总卡（指纹没变 → 直接用缓存绝不调模型；右上角手动「更新」同一套判断） */}
          <div className="ai-wall-impression">
            <span className="ai-wall-impression-title">TA 眼中的你</span>
            <button
              type="button"
              className="ai-wall-impression-refresh"
              onClick={() => generateImpression({ manual: true })}
              disabled={impressionLoading}
            >
              {impressionLoading ? '更新中…' : '更新'}
            </button>
            {impressionLoading ? (
              <p className="ai-wall-impression-loading">TA 正在回想…</p>
            ) : impression ? (
              <>
                <p className="ai-wall-impression-text">{impression}</p>
                {impressionStale && (
                  <p className="ai-wall-impression-stale">记忆有更新，点「更新」让 TA 重新想想</p>
                )}
              </>
            ) : (
              <p className="ai-wall-impression-empty">多和 TA 聊聊，TA 会开始记得你</p>
            )}
          </div>

          {/* 关于你：按记忆 topic 分组（有数据才显示，没数据的组不占位） */}
          <section className="ai-wall-section" aria-label="关于你">
            <h3 className="ai-wall-section-title">关于你</h3>
            {topicGroups.length === 0 ? (
              <p className="ai-wall-group-empty">多和 TA 聊聊，TA 会开始记得你</p>
            ) : (
              topicGroups.map((g) => {
                const open = openTopicGroup === g.topic
                return (
                  <div key={g.topic} className="ai-wall-group">
                    <button
                      type="button"
                      className={`ai-wall-group-head${open ? ' open' : ''}`}
                      onClick={() => setOpenTopicGroup(open ? null : g.topic)}
                    >
                      <span className="ai-wall-group-title">{g.label}</span>
                      <span className="ai-wall-group-summary">{groupSummary(g.list)}</span>
                      <span className="ai-wall-group-count">{g.list.length}</span>
                      <span className="ai-wall-group-arrow" aria-hidden="true">
                        {open ? '−' : '+'}
                      </span>
                    </button>
                    {open && (
                      <div className="ai-space-memory-list">
                        {g.list.map((m) => (
                          <div key={m.id} className="ai-space-memory-item">
                            <p className="ai-space-memory-text">你说过——{m.text}</p>
                            <span className="ai-space-memory-date">{formatMemoryDate(m.createdAt)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </section>

          {/* 我们之间：关系类长期事实（约定/称呼/共同习惯，关键词挑；挑不出空态） */}
          <section className="ai-wall-section" aria-label="我们之间">
            <h3 className="ai-wall-section-title">我们之间</h3>
            {relationMemories.length === 0 ? (
              <p className="ai-wall-group-empty">你们之间还没有沉淀下来的事</p>
            ) : (
              <div className="ai-space-memory-list">
                {relationMemories.map((m) => (
                  <div key={m.id} className="ai-space-memory-item">
                    <p className="ai-space-memory-text">你说过——{m.text}</p>
                    <span className="ai-space-memory-date">{formatMemoryDate(m.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </>
    )
  }

  /** TA所记子页：你们的大小事（完整时间轴；数据源 = 记忆聚类 legacy，Event 上线后只换 lib） */
  function renderEventsPage() {
    return (
      <>
        <div className="ai-space-topbar ai-space-sub-bar">
          <button type="button" className="link-btn ai-space-back" onClick={() => setPage('home')}>
            ‹ 返回
          </button>
          <h2 className="ai-space-sub-title">一起经历过</h2>
          <span className="ai-space-topbar-spacer" aria-hidden="true" />
        </div>

        <div className="ai-space-timeline">
          {timelineNodes.length === 0 ? (
            <p className="ai-space-empty">多和 TA 聊聊，TA 会开始记得你们一起的事</p>
          ) : (
            renderSharedTimeline(timelineNodes)
          )}
        </div>
      </>
    )
  }

  /** 竖线时间轴：节点 = 「09月01日 · 第 1 天」+ 一句话（定稿样式，只换渲染不造数据） */
  function renderSharedTimeline(nodes: ReturnType<typeof getSharedExperiences>) {
    return (
      <div className="ai-shared-timeline">
        {nodes.map((n) => (
          <div key={n.day} className="ai-shared-item">
            <span className="ai-shared-dot" aria-hidden="true" />
            <div className="ai-shared-main">
              <span className="ai-shared-date">
                {formatSharedDate(n.dateTs)} · 第 {n.day} 天
              </span>
              <p className="ai-shared-text">{n.text}</p>
            </div>
          </div>
        ))}
      </div>
    )
  }

  // 相与书子页：直接整页复用周记页（不套 ai-space 滚动容器，返回回空间资料页）
  if (page === 'weekly') {
    return <WeeklyPage onBack={goHome} onGoSettings={onGoMine ?? (() => {})} />
  }

  const pageClass = `page ai-space-page${page === 'memories' || page === 'events' ? ' ai-space-page-sub' : ''}`

  return (
    <div className={pageClass}>
      {page === 'memories' ? renderMemoriesPage() : page === 'events' ? renderEventsPage() : renderHomePage()}
    </div>
  )
}
