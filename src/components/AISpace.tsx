import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getFirstSeen,
  loadAIProfile,
  loadMessages,
  loadUserProfile,
  setSessionStart,
  type StoredMessage,
} from '../lib/storage'
import { loadMemory, type MemoryItem } from '../lib/memory'
import { computeDaysKnown, formatMemoryDate } from '../lib/aiSpaceDetail'
import DefaultAvatar from './DefaultAvatar'
import WeeklyPage from './WeeklyPage'
import {
  getActiveSessionId,
  getMemoriesCache,
  getMessagesCache,
  getSessionsCache,
} from '../lib/sessionStore'
import { displaySessionName } from '../lib/sessionFlow'
import { CalendarIcon, ChatIcon, EntryChevron, HeartIcon, NotebookIcon, RefreshIcon } from './spaceIcons'

interface Props {
  onBack: () => void
  /** 引导「去写人设」/「去配置」跳「我的」页（App 里即 settings 视图） */
  onGoMine?: () => void
}

export default function AISpace({ onBack, onGoMine }: Props) {
  const ai = loadAIProfile()
  const user = loadUserProfile()
  const yourName = user.nickname || '你'

  // 当前会话（S2 空间按角色独立）：有会话 → 消息/记忆/首次见面全用该会话数据，无会话兜底全局
  const sessionId = getActiveSessionId()

  // S1 空间角色化：有当前会话 → 标题/名字用当前角色名（如「阿叙的空间」）；无会话保持原样
  const [spaceSessionName] = useState<string>(() => {
    if (!sessionId) return ''
    const s = getSessionsCache().find((x) => String(x.id) === sessionId)
    return s ? displaySessionName(s) : ''
  })

  // 详情页数据：进空间时读一次（消息/记忆/首次见面时间不会在空间内变化）。
  // 有会话读当前会话缓存（后端填充），无会话兜底全局 localStorage（游客/过渡态）
  const [messages] = useState<StoredMessage[]>(() => (sessionId ? getMessagesCache(sessionId) : loadMessages()))
  const [memories] = useState<MemoryItem[]>(() => (sessionId ? getMemoriesCache(sessionId) : loadMemory()))
  const [firstSeen] = useState<number>(() => getFirstSeen(sessionId || undefined))

  // 子页面路由：home 资料页 / memories TA所忆 / weekly 相与书
  // （P3 聊天记录 / TA 的生活已迁到聊天头像资料卡 ChatProfile）
  const [page, setPage] = useState<'home' | 'memories' | 'weekly'>('home')

  // 刷新对话二次确认：true = 已展开确认面板，等用户确认
  const [confirmRefresh, setConfirmRefresh] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const hintTimer = useRef<number | undefined>(undefined)

  const flashHint = useCallback((msg: string) => {
    setHint(msg)
    window.clearTimeout(hintTimer.current)
    hintTimer.current = window.setTimeout(() => setHint(null), 2600)
  }, [])

  useEffect(() => () => window.clearTimeout(hintTimer.current), [])

  // 「刷新对话」（M7-3）：仅刷新当前对话上下文——TA 忘了之前聊的重新开始，聊天记录一条不删
  const handleRefreshChats = () => setConfirmRefresh(true)
  const confirmDoRefresh = () => {
    setSessionStart(Date.now())
    setConfirmRefresh(false)
    flashHint('已刷新，TA 从新的一页开始')
  }
  const cancelRefresh = () => setConfirmRefresh(false)

  const sortedMemories = useMemo(
    () => [...memories].sort((a, b) => b.createdAt - a.createdAt),
    [memories],
  )
  const daysKnown = computeDaysKnown(firstSeen)

  const goHome = () => setPage('home')

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
            <h1 className="ai-space-title">{spaceSessionName ? `${spaceSessionName} 的空间` : 'TA 的空间'}</h1>
            <span className="ai-space-topbar-spacer" aria-hidden="true" />
          </div>

          <div className="ai-space-avatar" aria-hidden="true">
            {spaceSessionName ? (
              <span className="ai-space-avatar-letter">{spaceSessionName.slice(0, 1)}</span>
            ) : ai.avatar.startsWith('data:') ? (
              <img src={ai.avatar} alt="" />
            ) : (
              <DefaultAvatar kind="ai" className="avatar-default" />
            )}
          </div>
          <h2 className="ai-space-name">{spaceSessionName || ai.nickname}</h2>
          <p className="ai-space-bio">
            只属于{yourName}的 TA · 这里记录着 TA 的日常、想法，和没说出口的心事
          </p>
        </div>

        <div className="ai-space-timeline">
          {/* 相处数据：v0.2.0 原版——在头部下方、timeline 顶部，紧贴入口列表 */}
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
              <span className="ai-space-stat-label">TA所忆</span>
            </div>
          </div>
          {/* 功能入口列表：微信式资料页（P3 只留 TA所忆 / 相与书） */}
          <div className="ai-space-entry-list">
            <button type="button" className="ai-space-entry-row" onClick={() => setPage('memories')}>
              <span className="ai-space-entry-icon" aria-hidden="true">
                <HeartIcon />
              </span>
              <span className="ai-space-entry-main">
                <span className="ai-space-entry-title">TA所忆</span>
                <span className="ai-space-entry-sub">{memories.length} 件记忆 · 时间线</span>
              </span>
              <EntryChevron />
            </button>

            <button type="button" className="ai-space-entry-row" onClick={() => setPage('weekly')}>
              <span className="ai-space-entry-icon" aria-hidden="true">
                <NotebookIcon />
              </span>
              <span className="ai-space-entry-main">
                <span className="ai-space-entry-title">相与书</span>
                <span className="ai-space-entry-sub">TA 的周记 · 每周最多一篇</span>
              </span>
              <EntryChevron />
            </button>
          </div>

          {/* 刷新对话：底部独立卡片，M7-3 生效（仅刷新上下文，聊天记录永不删除） */}
          <div className="ai-space-refresh-card">
            <button
              type="button"
              className="ai-space-entry-row ai-space-entry-refresh"
              onClick={handleRefreshChats}
              aria-expanded={confirmRefresh}
            >
              <span className="ai-space-entry-icon" aria-hidden="true">
                <RefreshIcon />
              </span>
              <span className="ai-space-entry-main">
                <span className="ai-space-entry-title">刷新对话</span>
                <span className="ai-space-entry-sub">TA 忘了之前聊的，重新开始</span>
              </span>
              <EntryChevron open={confirmRefresh} />
            </button>
            {confirmRefresh && (
              <div className="ai-space-refresh-confirm">
                <p className="ai-space-refresh-confirm-text">刷新后 TA 会忘了之前聊的，聊天记录还在</p>
                <div className="ai-space-refresh-confirm-actions">
                  <button type="button" className="btn btn-ghost" onClick={cancelRefresh}>
                    再想想
                  </button>
                  <button type="button" className="btn btn-primary" onClick={confirmDoRefresh}>
                    确认刷新
                  </button>
                </div>
              </div>
            )}
          </div>

          {hint && <p className="ai-space-hint">{hint}</p>}
        </div>
      </>
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

  // 相与书子页：直接整页复用周记页（不套 ai-space 滚动容器，返回回空间资料页）
  if (page === 'weekly') {
    return <WeeklyPage onBack={goHome} onGoSettings={onGoMine ?? (() => {})} />
  }

  const pageClass = `page ai-space-page${page === 'memories' ? ' ai-space-page-sub' : ''}`

  return <div className={pageClass}>{page === 'memories' ? renderMemoriesPage() : renderHomePage()}</div>
}
