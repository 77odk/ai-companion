import { useMemo, useState } from 'react'
import { loadMemory, type MemoryItem } from '../lib/memory'
import { computeDaysKnown, formatMemoryDate } from '../lib/aiSpaceDetail'
import WeeklyPage from './WeeklyPage'
import { getActiveSessionId, getMemoriesCache, getMessagesCache } from '../lib/sessionStore'
import { getWeeklyReviews, type WeeklyReview } from '../lib/weeklyReview'
import { getFirstSeen, loadMessages } from '../lib/storage'

interface Props {
  /** 引导「去写人设」/「去配置」跳「我的」页（App 里即 settings 视图） */
  onGoMine?: () => void
  /** 点「最近的大日子」卡 → 进纪念日页（2026-09-10 空间重构后倒计时由首页承载，空间不再放，保留 prop 兼容调用方） */
  onOpenAnniversary?: () => void
}

/** 时间戳 → 8月2日（TA 记得的起始日期、底部注脚用） */
function fmtMD(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export default function AISpace({ onGoMine }: Props) {
  // 当前会话（S2 空间按角色独立）：有会话 → 消息/记忆/首次见面全用该会话数据，无会话兜底全局
  const sessionId = getActiveSessionId()
  const sid = sessionId || undefined

  // 详情页数据：进空间时读一次（记忆不会在空间内变化）。
  // 有会话读当前会话缓存（后端填充），无会话兜底全局 localStorage（游客/过渡态）
  const [memories] = useState<MemoryItem[]>(() => (sid ? getMemoriesCache(sid) : loadMemory()))

  // 子页面路由：home 空间主页 / memories TA所忆 / events TA所记（大小事） / weekly TA所写（周记）
  const [page, setPage] = useState<'home' | 'memories' | 'events' | 'weekly'>('home')

  const sortedMemories = useMemo(
    () => [...memories].sort((a, b) => b.createdAt - a.createdAt),
    [memories],
  )

  // 相识天数（首页同口径：getFirstSeen + computeDaysKnown）
  const firstSeen = useMemo(() => getFirstSeen(sid), [sid])
  const days = useMemo(() => computeDaysKnown(firstSeen), [firstSeen])

  // 周记：最近一篇（getWeeklyReviews 已按 createdAt 降序）
  const [weekly] = useState<WeeklyReview | null>(() => getWeeklyReviews(sid)[0] ?? null)

  // 聊过多少次：有会话读会话消息缓存，无会话兜底全局
  const [messageCount] = useState<number>(() =>
    sid ? getMessagesCache(sid).length : loadMessages().length,
  )

  // 一起经历过：记忆按「第 N 天」聚类，每天取最早一条，倒序展示最近 3 个节点
  const timelineNodes = useMemo(() => {
    const byDay = new Map<number, MemoryItem>()
    for (const m of memories) {
      if (!m || typeof m.createdAt !== 'number' || !Number.isFinite(m.createdAt)) continue
      const n = computeDaysKnown(firstSeen, m.createdAt)
      if (!byDay.has(n) || m.createdAt < (byDay.get(n)?.createdAt ?? Infinity)) {
        byDay.set(n, m)
      }
    }
    return [...byDay.entries()]
      .sort((a, b) => b[0] - a[0])
      .slice(0, 3)
      .map(([n, m]) => ({ day: n, text: m.text }))
  }, [memories, firstSeen])

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

  /* ---- 子页面渲染 ---- */

  /** 空间主页（定稿第二屏：顶部一句 / 照片墙 / 一起经历过 / 周记 / TA 记得的 / 底部注脚） */
  function renderHomePage() {
    const hasPhotos = false // 照片墙第 7 批接真上传，本批只做空状态
    return (
      <div className="ai-space-v2">
        <p className="ai-space-v2-line">我们已经认识 {days} 天了。</p>

        {/* 照片墙（空态） */}
        <section className="ai-space-v2-section">
          <div className="ai-space-v2-head">
            <span className="ai-space-v2-title">照片墙</span>
            <span className="ai-space-v2-en">PHOTOS</span>
            {hasPhotos && (
              <button type="button" className="ai-space-v2-all">
                全部 ›
              </button>
            )}
          </div>
          <div className="ai-space-photo-add" aria-label="添加照片（即将上线）">
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
        </section>

        {/* 一起经历过 */}
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
            <div className="ai-space-nodes">
              {timelineNodes.map((n) => (
                <div key={n.day} className="ai-space-node">
                  <span className="ai-space-node-day">第{n.day}天</span>
                  <span className="ai-space-node-text">{n.text}</span>
                </div>
              ))}
            </div>
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

  /** TA所忆子页：记忆时间线（TA 口吻 + 日期） */
  function renderMemoriesPage() {
    return (
      <>
        <div className="ai-space-topbar ai-space-sub-bar">
          <button type="button" className="link-btn ai-space-back" onClick={() => setPage('home')}>
            ‹ 返回
          </button>
          <h2 className="ai-space-sub-title">TA所忆</h2>
          <span className="ai-space-topbar-spacer" aria-hidden="true" />
        </div>

        <div className="ai-space-timeline">
          {sortedMemories.length === 0 ? (
            <p className="ai-space-empty">多和 TA 聊聊，TA 会开始记得你</p>
          ) : (
            <div className="ai-space-memory-list">
              {sortedMemories.map((m) => (
                <div key={m.id} className="ai-space-memory-item">
                  <p className="ai-space-memory-text">你说过——{m.text}</p>
                  <span className="ai-space-memory-date">{formatMemoryDate(m.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </>
    )
  }

  /** TA所记子页：你们的大小事（数据逻辑待定，先空态引导） */
  function renderEventsPage() {
    return (
      <>
        <div className="ai-space-topbar ai-space-sub-bar">
          <button type="button" className="link-btn ai-space-back" onClick={() => setPage('home')}>
            ‹ 返回
          </button>
          <h2 className="ai-space-sub-title">TA所记</h2>
          <span className="ai-space-topbar-spacer" aria-hidden="true" />
        </div>

        <div className="ai-space-timeline">
          <p className="ai-space-empty">你们一起经历的大小事，TA 会慢慢记在这里</p>
        </div>
      </>
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
