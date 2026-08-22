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
import {
  calendarMonthRange,
  computeDaysKnown,
  dayKey,
  formatMemoryDate,
  getCalendarMonth,
  groupMessagesByDay,
  highlightDayKeys,
  monthLabel,
  searchMessages,
  shiftMonth,
  truncatePreview,
  type DayGroup,
} from '../lib/aiSpaceDetail'
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

const SearchIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.35-4.35" />
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

const BarChartIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 20V10" />
    <path d="M10 20V4" />
    <path d="M16 20v-7" />
    <path d="M22 20H2" />
  </svg>
)

const RefreshIcon = () => (
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
)

/** 入口列表右侧箭头 › */
const EntryChevron = ({ open = false }: { open?: boolean }) => (
  <svg
    className={`ai-space-entry-chevron${open ? ' ai-space-entry-chevron-open' : ''}`}
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

  // 子页面路由：home 资料页 / chats 聊天记录 / memories TA 记得的 / life TA 的生活
  const [page, setPage] = useState<'home' | 'chats' | 'memories' | 'life'>('home')
  // 聊天记录二级视图：非 null 表示正在看某一天的完整消息
  const [logDayKey, setLogDayKey] = useState<string | null>(null)
  // 相处数据行：默认展开直接展示，点击收起/展开
  const [statsOpen, setStatsOpen] = useState(true)
  // 聊天记录子页（M7-2）：搜索关键词 / 日历当前月份 / 目录折叠（null = 默认展开最近 3 天）
  const [chatSearch, setChatSearch] = useState('')
  const [calYear, setCalYear] = useState<number>(() => new Date().getFullYear())
  const [calMonth, setCalMonth] = useState<number>(() => new Date().getMonth())
  const [expandedDays, setExpandedDays] = useState<Set<string> | null>(null)
  // 今天（日历高亮用）：挂载时定一次即可，跨天可随重渲染刷新
  const [todayKey] = useState<string>(() => dayKey(Date.now()))

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

  // 「刷新对话」占位：M7-3 实现，本版先给提示
  const handleRefreshChatsPlaceholder = () => flashHint('将在下一版生效')

  const dayGroups = useMemo(() => groupMessagesByDay(messages), [messages])
  // 聊天记录搜索与日历（M7-2）：纯逻辑全在 aiSpaceDetail.ts
  const searchHits = useMemo(() => searchMessages(messages, chatSearch), [messages, chatSearch])
  const calHighlight = useMemo(() => new Set(highlightDayKeys(messages)), [messages])
  const calRange = useMemo(() => calendarMonthRange(messages), [messages])

  // 目录折叠：默认展开最近 3 天（dayGroups 日期倒序，前 3 组即最近三天），其余折叠
  const expandedSet = expandedDays ?? new Set(dayGroups.slice(0, 3).map((g) => g.key))
  const toggleDay = (key: string) => {
    const next = new Set(expandedSet)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setExpandedDays(next)
  }
  const expandAllDays = () => setExpandedDays(new Set(dayGroups.map((g) => g.key)))
  const collapseAllDays = () => setExpandedDays(new Set())

  // 日历切月：不早于最早聊天月、不晚于当前月
  const canPrevCal =
    calYear > calRange.minYear || (calYear === calRange.minYear && calMonth > calRange.minMonth)
  const canNextCal =
    calYear < calRange.maxYear || (calYear === calRange.maxYear && calMonth < calRange.maxMonth)
  const goPrevCal = () => {
    if (!canPrevCal) return
    const next = shiftMonth(calYear, calMonth, -1)
    setCalYear(next.year)
    setCalMonth(next.month)
  }
  const goNextCal = () => {
    if (!canNextCal) return
    const next = shiftMonth(calYear, calMonth, 1)
    setCalYear(next.year)
    setCalMonth(next.month)
  }

  const sortedMemories = useMemo(
    () => [...memories].sort((a, b) => b.createdAt - a.createdAt),
    [memories],
  )
  const daysKnown = computeDaysKnown(firstSeen)
  const logDay = logDayKey ? dayGroups.find((g) => g.key === logDayKey) ?? null : null
  const latestAt = posts.length > 0 ? posts[0].at : null

  const goHome = () => {
    setLogDayKey(null)
    setPage('home')
  }

  /* ---- 子页面渲染 ---- */

  /** 资料页（home）：头部 + 功能入口列表 + 相处数据行 */
  function renderHomePage() {
    return (
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
          {/* 功能入口列表：微信式资料页 */}
          <div className="ai-space-entry-list">
            <button
              type="button"
              className="ai-space-entry-row"
              onClick={() => setStatsOpen((v) => !v)}
              aria-expanded={statsOpen}
            >
              <span className="ai-space-entry-icon" aria-hidden="true">
                <BarChartIcon />
              </span>
              <span className="ai-space-entry-main">
                <span className="ai-space-entry-title">相处数据</span>
                <span className="ai-space-entry-sub">
                  认识 {daysKnown} 天 · 聊过 {messages.length} 条 · 记得 {memories.length} 件
                </span>
              </span>
              <EntryChevron open={statsOpen} />
            </button>

            <button type="button" className="ai-space-entry-row" onClick={() => setPage('chats')}>
              <span className="ai-space-entry-icon" aria-hidden="true">
                <ChatIcon />
              </span>
              <span className="ai-space-entry-main">
                <span className="ai-space-entry-title">聊天记录</span>
                <span className="ai-space-entry-sub">60 天 · 按日期归档</span>
              </span>
              <EntryChevron />
            </button>

            <button type="button" className="ai-space-entry-row" onClick={() => setPage('memories')}>
              <span className="ai-space-entry-icon" aria-hidden="true">
                <HeartIcon />
              </span>
              <span className="ai-space-entry-main">
                <span className="ai-space-entry-title">TA 记得的</span>
                <span className="ai-space-entry-sub">{memories.length} 件记忆 · 时间线</span>
              </span>
              <EntryChevron />
            </button>

            <button type="button" className="ai-space-entry-row" onClick={() => setPage('life')}>
              <span className="ai-space-entry-icon" aria-hidden="true">
                <SparkleIcon />
              </span>
              <span className="ai-space-entry-main">
                <span className="ai-space-entry-title">TA 的生活</span>
                <span className="ai-space-entry-sub">
                  {latestAt != null ? `最近更新 · ${timeAgo(latestAt)}` : '还没有动态'}
                </span>
              </span>
              <EntryChevron />
            </button>
          </div>

          {/* 相处数据：数据就三行，直接展示在入口下方 */}
          {statsOpen && (
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
          )}

          {/* 刷新对话：底部独立一项，M7-3 生效 */}
          <button type="button" className="ai-space-entry-row ai-space-entry-refresh" onClick={handleRefreshChatsPlaceholder}>
            <span className="ai-space-entry-icon" aria-hidden="true">
              <RefreshIcon />
            </span>
            <span className="ai-space-entry-main">
              <span className="ai-space-entry-title">刷新对话</span>
              <span className="ai-space-entry-sub">将在下一版生效</span>
            </span>
            <EntryChevron />
          </button>

          {hint && <p className="ai-space-hint">{hint}</p>}
        </div>
      </>
    )
  }

  /** 聊天记录子页：搜索框 + 日历选日期 + 按天折叠目录（微信式，M7-2） */
  function renderChatsPage() {
    const searchActive = chatSearch.trim().length > 0

    /** 日历：当前月网格，有聊天记录的天打圆点，点某天直接进那天回放 */
    function renderCalendar() {
      const weeks = getCalendarMonth(calYear, calMonth)
      return (
        <div className="ai-space-cal">
          <div className="ai-space-cal-head">
            <button
              type="button"
              className="ai-space-cal-nav"
              onClick={goPrevCal}
              disabled={!canPrevCal}
              aria-label="上个月"
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
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <span className="ai-space-cal-title">{monthLabel(calYear, calMonth)}</span>
            <button
              type="button"
              className="ai-space-cal-nav"
              onClick={goNextCal}
              disabled={!canNextCal}
              aria-label="下个月"
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
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </div>
          <div className="ai-space-cal-grid">
            {['一', '二', '三', '四', '五', '六', '日'].map((w, i) => (
              <span key={i} className="ai-space-cal-dow">
                {w}
              </span>
            ))}
            {weeks.flat().map((cell, i) =>
              cell == null ? (
                <span key={`b${i}`} className="ai-space-cal-cell ai-space-cal-blank" aria-hidden="true" />
              ) : (
                <button
                  key={cell.key}
                  type="button"
                  className={`ai-space-cal-cell${calHighlight.has(cell.key) ? ' ai-space-cal-has' : ''}${
                    cell.key === todayKey ? ' ai-space-cal-today' : ''
                  }`}
                  onClick={() => setLogDayKey(cell.key)}
                  disabled={!calHighlight.has(cell.key)}
                >
                  <span className="ai-space-cal-day">{cell.day}</span>
                  {calHighlight.has(cell.key) && <span className="ai-space-cal-dot" aria-hidden="true" />}
                </button>
              ),
            )}
          </div>
        </div>
      )
    }

    /** 搜索命中列表：日期 + 摘要 + 前后各一条上下文；点结果进那天的回放 */
    function renderSearchResults() {
      if (searchHits.length === 0) {
        return <p className="ai-space-empty">没有找到相关聊天</p>
      }
      return (
        <div className="ai-space-search-results">
          {searchHits.map((hit, i) => {
            const prevText = hit.prev ? truncatePreview(stripMemoryMarkers(hit.prev.content), 20) : ''
            const nextText = hit.next ? truncatePreview(stripMemoryMarkers(hit.next.content), 20) : ''
            return (
              <button
                key={i}
                type="button"
                className="ai-space-search-item"
                onClick={() => setLogDayKey(hit.dayKey)}
              >
                <span className="ai-space-search-item-head">
                  <span className="ai-space-search-day">{hit.dayLabel}</span>
                  <span className="ai-space-search-summary">
                    {truncatePreview(stripMemoryMarkers(hit.msg.content), 28)}
                  </span>
                </span>
                {(hit.prev || hit.next) && (
                  <span className="ai-space-search-ctx">
                    {hit.prev && (
                      <span className="ai-space-search-ctx-line">
                        <span className="ai-space-search-ctx-tag">上一条</span>
                        {prevText}
                      </span>
                    )}
                    {hit.next && (
                      <span className="ai-space-search-ctx-line">
                        <span className="ai-space-search-ctx-tag">下一条</span>
                        {nextText}
                      </span>
                    )}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )
    }

    /** 目录里的一天：头部点击展开/收起，展开后看当天消息、可进完整回放 */
    function renderDayGroup(g: DayGroup) {
      const open = expandedSet.has(g.key)
      const recent = g.messages.slice(-4)
      return (
        <div key={g.key} className={`ai-space-dir-day${open ? ' ai-space-dir-day-open' : ''}`}>
          <button type="button" className="ai-space-dir-head" onClick={() => toggleDay(g.key)} aria-expanded={open}>
            <span className="ai-space-dir-name">{g.label}</span>
            <span className="ai-space-dir-preview">{g.preview || '…'}</span>
            <span className="ai-space-dir-count">{g.messages.length} 条</span>
            <svg
              className="ai-space-dir-chevron"
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
          {open && (
            <div className="ai-space-dir-body">
              {recent.map((m, i) => {
                const isUser = m.role === 'user'
                return (
                  <button
                    key={i}
                    type="button"
                    className="ai-space-dir-msg"
                    onClick={() => setLogDayKey(g.key)}
                  >
                    <span className="ai-space-dir-msg-role">{isUser ? yourName : ai.nickname}</span>
                    <span className="ai-space-dir-msg-text">
                      {truncatePreview(stripMemoryMarkers(m.content), 24)}
                    </span>
                  </button>
                )
              })}
              <button type="button" className="ai-space-dir-open" onClick={() => setLogDayKey(g.key)}>
                查看完整回放
                <svg
                  className="ai-space-dir-open-chevron"
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
            </div>
          )}
        </div>
      )
    }

    return (
      <>
        <div className="ai-space-topbar ai-space-sub-bar">
          <button type="button" className="link-btn ai-space-back" onClick={goHome}>
            ‹ 返回
          </button>
          <h2 className="ai-space-sub-title">聊天记录</h2>
          <span className="ai-space-topbar-spacer" aria-hidden="true" />
        </div>

        <div className="ai-space-timeline">
          <div className="ai-space-search">
            <span className="ai-space-search-icon" aria-hidden="true">
              <SearchIcon />
            </span>
            <input
              type="text"
              className="ai-space-search-input"
              value={chatSearch}
              onChange={(e) => setChatSearch(e.target.value)}
              placeholder="搜索聊天内容"
              aria-label="搜索聊天内容"
            />
            {chatSearch && (
              <button
                type="button"
                className="ai-space-search-clear"
                onClick={() => setChatSearch('')}
                aria-label="清空搜索"
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
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </div>

          {searchActive ? (
            renderSearchResults()
          ) : dayGroups.length === 0 ? (
            <p className="ai-space-empty">还没聊过天，去和 TA 说说话吧</p>
          ) : (
            <>
              {renderCalendar()}
              <div className="ai-space-dir-tools">
                <button type="button" className="ai-space-dir-tool" onClick={expandAllDays}>
                  全部展开
                </button>
                <span className="ai-space-dir-tool-sep" aria-hidden="true" />
                <button type="button" className="ai-space-dir-tool" onClick={collapseAllDays}>
                  全部收起
                </button>
              </div>
              <div className="ai-space-day-dir">{dayGroups.map((g) => renderDayGroup(g))}</div>
            </>
          )}
        </div>
      </>
    )
  }

  /** 某一天的回放（聊天记录子页的二级视图，全屏替换） */
  function renderLogView() {
    if (!logDay) return null
    return (
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
    )
  }

  /** TA 记得的子页：记忆时间线（TA 口吻 + 日期） */
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

  /** TA 的生活子页：现有动态引擎整块搬进来（LLM 生成/降级/引导卡逻辑原样不动） */
  function renderLifePage() {
    return (
      <>
        <div className="ai-space-topbar ai-space-sub-bar">
          <button type="button" className="link-btn ai-space-back" onClick={() => setPage('home')}>
            ‹ 返回
          </button>
          <h2 className="ai-space-sub-title">TA 的生活</h2>
          <span className="ai-space-topbar-spacer" aria-hidden="true" />
        </div>

        <div className="ai-space-timeline">
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
        </div>
      </>
    )
  }

  const isLogView = page === 'chats' && logDay != null
  const pageClass = `page ai-space-page${
    isLogView ? ' ai-space-page-log' : page !== 'home' ? ' ai-space-page-sub' : ''
  }`

  return (
    <div className={pageClass}>
      {isLogView
        ? renderLogView()
        : page === 'chats'
          ? renderChatsPage()
          : page === 'memories'
            ? renderMemoriesPage()
            : page === 'life'
              ? renderLifePage()
              : renderHomePage()}
    </div>
  )
}
