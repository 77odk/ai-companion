import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getFirstSeen,
  loadAIProfile,
  loadMessages,
  loadPersona,
  loadUserProfile,
  type StoredMessage,
} from '../lib/storage'
import { loadMemory, stripMemoryMarkers, type MemoryItem } from '../lib/memory'
import {
  generatePendingPosts,
  loadCurrentPosts,
  refreshSpace,
  type RefreshPlan,
} from '../lib/aiSpace'
import { KIND_LABEL, type SpacePost } from '../lib/aiSpaceCore'
import { computeDaysKnown, formatMemoryDate, groupMessagesByDay } from '../lib/aiSpaceDetail'
import DefaultAvatar from './DefaultAvatar'
import SpaceArt from './SpaceArt'

interface Props {
  onBack: () => void
  /** 引导「去写人设」跳「我的」页（App 里即 settings 视图） */
  onGoMine?: () => void
}

/** 配图区柔和渐变：每种 kind 一个色系，跟记忆页主题色块同一组配色 */
const ART_TONE: Record<string, string> = {
  日常: 'art-tone-0',
  心情: 'art-tone-1',
  钻研: 'art-tone-2',
  天气: 'art-tone-3',
  想你: 'art-tone-4',
  小确幸: 'art-tone-5',
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

/* ---- 详情页的小线条图标（去 emoji，跟全站图标同一种描边风格） ---- */

const ChatIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5c-1.36 0-2.66-.32-3.8-.9L3 20l.9-3.7A8.5 8.5 0 1 1 21 11.5z" />
  </svg>
)

const HeartIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
  </svg>
)

const CalendarIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
    <path d="M8 2.5v4M16 2.5v4M3 9h18" />
  </svg>
)

const SparkleIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
  </svg>
)

export default function AISpace({ onBack, onGoMine }: Props) {
  const ai = loadAIProfile()
  const user = loadUserProfile()
  const yourName = user.nickname || '你'
  const hasPersona = Boolean(loadPersona().trim())

  // 详情页数据：进空间时读一次（消息/记忆/首次见面时间不会在空间内变化）
  const [messages] = useState<StoredMessage[]>(() => loadMessages())
  const [memories] = useState<MemoryItem[]>(() => loadMemory())
  const [firstSeen] = useState<number>(() => getFirstSeen())

  // 聊天记录二级视图：非 null 表示正在看某一天的完整消息
  const [logDayKey, setLogDayKey] = useState<string | null>(null)

  // 进空间先立即显示已有动态（不阻塞），需要补的新动态异步生成、写完自动追加
  const [posts, setPosts] = useState<SpacePost[]>(() => loadCurrentPosts())
  const [hint, setHint] = useState<string | null>(null)
  const [pendingLlm, setPendingLlm] = useState(false)
  const hintTimer = useRef<number | undefined>(undefined)
  const planRef = useRef<RefreshPlan | null>(null)
  const generatingRef = useRef(false)
  const cancelledRef = useRef(false)

  const flashHint = useCallback((msg: string) => {
    setHint(msg)
    window.clearTimeout(hintTimer.current)
    hintTimer.current = window.setTimeout(() => setHint(null), 2600)
  }, [])

  useEffect(() => () => window.clearTimeout(hintTimer.current), [])

  /** 应用一次刷新计划：更新列表、按模式决定是否异步生成 */
  const applyPlan = useCallback(
    (plan: RefreshPlan) => {
      setPosts(plan.posts)
      if (plan.mode === 'template' && plan.created > 0) {
        flashHint('TA 这次用了旧日记凑数')
      }
      if (plan.mode === 'llm' && plan.pending.length > 0 && !plan.started && !generatingRef.current) {
        plan.started = true
        generatingRef.current = true
        setPendingLlm(true)
        void generatePendingPosts(plan, ai.nickname, yourName)
          .then((res) => {
            if (cancelledRef.current) return
            setPosts(res.posts)
            if (res.usedFallback) flashHint('TA 这次用了旧日记凑数')
          })
          .catch(() => {})
          .finally(() => {
            generatingRef.current = false
            setPendingLlm(false)
          })
      }
    },
    [ai.nickname, yourName, flashHint],
  )

  // 进入页面即刷新：已有动态立即显示，LLM 补的新动态异步追加
  useEffect(() => {
    cancelledRef.current = false
    if (!planRef.current) {
      planRef.current = refreshSpace(ai.nickname, yourName)
    }
    applyPlan(planRef.current)
    return () => {
      cancelledRef.current = true
    }
  }, [applyPlan, ai.nickname, yourName])

  const handleRefresh = () => {
    const plan = refreshSpace(ai.nickname, yourName)
    planRef.current = plan
    applyPlan(plan)
    if (plan.pending.length === 0 && plan.created === 0) {
      flashHint('TA 刚更新过，晚点再来看看')
    }
  }

  const dayGroups = useMemo(() => groupMessagesByDay(messages), [messages])
  const sortedMemories = useMemo(
    () => [...memories].sort((a, b) => b.createdAt - a.createdAt),
    [memories],
  )
  const daysKnown = computeDaysKnown(firstSeen)
  const logDay = logDayKey ? dayGroups.find((g) => g.key === logDayKey) : null
  const latestAt = posts.length > 0 ? posts[0].at : null

  return (
    <div className={`page ai-space-page${logDayKey ? ' ai-space-page-log' : ''}`}>
      {logDay ? (
        <div className="ai-space-log">
          <div className="ai-space-topbar ai-space-log-bar">
            <button type="button" className="link-btn ai-space-back" onClick={() => setLogDayKey(null)}>
              ‹ 返回
            </button>
            <h2 className="ai-space-log-title">{logDay.label}</h2>
            <span className="ai-space-topbar-spacer" aria-hidden="true" />
          </div>

          <div className="ai-space-log-list">
            {logDay.messages.map((m, i) => {
              const isUser = m.role === 'user'
              return (
                <div key={i} className={`message-row ${isUser ? 'row-user' : 'row-assistant'}`}>
                  <div className="message-body">
                    <span className="ai-space-log-role">{isUser ? yourName : ai.nickname}</span>
                    <div className={`bubble ${isUser ? 'bubble-user' : 'bubble-assistant'}`}>
                      <span className="bubble-text">{isUser ? m.content : stripMemoryMarkers(m.content)}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="ai-space-log-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setLogDayKey(null)}>
              返回聊天记录
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="ai-space-head">
            <div className="ai-space-topbar">
              <button type="button" className="link-btn ai-space-back" onClick={onBack}>
                ‹ 返回
              </button>
              <h1 className="ai-space-title">TA 的空间</h1>
              <span className="ai-space-topbar-spacer" aria-hidden="true" />
            </div>

            <div className="ai-space-avatar" aria-hidden="true">
              {ai.avatar.startsWith('data:') ? (
                <img src={ai.avatar} alt="" />
              ) : (
                <DefaultAvatar kind="ai" className="avatar-default" />
              )}
            </div>
            <h2 className="ai-space-name">{ai.nickname}</h2>
            <p className="ai-space-bio">
              只属于{yourName}的 TA · 这里记录着 TA 的日常、想法，和没说出口的心事
            </p>
          </div>

          <div className="ai-space-timeline">
            {/* 相处数据：认识几天 / 聊过几条 / TA 记得几件 */}
            <div className="ai-space-stats">
              <div className="ai-space-stat">
                <span className="ai-space-stat-icon" aria-hidden="true">
                  <CalendarIcon />
                </span>
                <span className="ai-space-stat-num">第 {daysKnown} 天</span>
                <span className="ai-space-stat-label">认识</span>
              </div>
              <div className="ai-space-stat">
                <span className="ai-space-stat-icon" aria-hidden="true">
                  <ChatIcon />
                </span>
                <span className="ai-space-stat-num">{messages.length} 条</span>
                <span className="ai-space-stat-label">聊过</span>
              </div>
              <div className="ai-space-stat">
                <span className="ai-space-stat-icon" aria-hidden="true">
                  <HeartIcon />
                </span>
                <span className="ai-space-stat-num">{memories.length} 件</span>
                <span className="ai-space-stat-label">TA 记得</span>
              </div>
            </div>

            {/* 聊天记录：按天分组，点击某天进二级视图 */}
            <section className="ai-space-section">
              <h3 className="ai-space-section-title">
                <span className="ai-space-section-title-icon" aria-hidden="true">
                  <ChatIcon />
                </span>
                聊天记录
                <span className="ai-space-section-count">共 {messages.length} 条</span>
              </h3>
              {dayGroups.length === 0 ? (
                <p className="ai-space-empty">还没聊过天，去和 TA 说说话吧</p>
              ) : (
                <div className="ai-space-day-list">
                  {dayGroups.map((g) => (
                    <button
                      key={g.key}
                      type="button"
                      className="ai-space-day-item"
                      onClick={() => setLogDayKey(g.key)}
                    >
                      <span className="ai-space-day-name">{g.label}</span>
                      <span className="ai-space-day-preview">{g.preview || '…'}</span>
                      <span className="ai-space-day-count">{g.messages.length} 条</span>
                      <svg
                        className="ai-space-day-chevron"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* TA 记得的：记忆时间线 */}
            <section className="ai-space-section">
              <h3 className="ai-space-section-title">
                <span className="ai-space-section-title-icon" aria-hidden="true">
                  <HeartIcon />
                </span>
                TA 记得的
                <span className="ai-space-section-count">{memories.length} 件</span>
              </h3>
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
            </section>

            {/* 生活动态：现有动态引擎整块保留，放最下面 */}
            <section className="ai-space-section">
              <h3 className="ai-space-section-title">
                <span className="ai-space-section-title-icon" aria-hidden="true">
                  <SparkleIcon />
                </span>
                TA 的生活
              </h3>

              {!hasPersona && (
                <div className="ai-space-guide">
                  <p className="ai-space-guide-text">先给 TA 写个人设，TA 才会开始分享生活</p>
                  {onGoMine && (
                    <button type="button" className="btn btn-ghost ai-space-guide-btn" onClick={onGoMine}>
                      去「我的」写人设
                    </button>
                  )}
                </div>
              )}

              {latestAt != null && (
                <div className="ai-space-update-row">
                  <span className="ai-space-update">TA 最近更新于 · {timeAgo(latestAt)}</span>
                  <button
                    type="button"
                    className="ai-space-refresh"
                    onClick={handleRefresh}
                    aria-label="刷新动态"
                    title="刷新"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M20 11a8 8 0 1 0-2.34 5.66" />
                      <path d="M20 5v6h-6" />
                    </svg>
                  </button>
                </div>
              )}
              {pendingLlm && <p className="ai-space-hint">TA 正在写新的生活…</p>}
              {hint && <p className="ai-space-hint">{hint}</p>}

              {posts.map((p) => (
                <article key={p.id} className="ai-space-post">
                  <div className={`ai-space-art ${ART_TONE[p.kind] ?? 'art-tone-0'}`}>
                    <SpaceArt kind={p.kind} variant={p.art} />
                  </div>
                  <div className="ai-space-post-body">
                    <div className="ai-space-post-head">
                      <span className="ai-space-post-kind">{KIND_LABEL[p.kind] ?? p.kind}</span>
                      <span className="ai-space-post-time">{timeAgo(p.at)}</span>
                    </div>
                    <p className="ai-space-post-text">{p.text}</p>
                  </div>
                </article>
              ))}

              <p className="ai-space-foot">这里是 TA 的生活 · 内容会随你们的相处慢慢生长</p>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
