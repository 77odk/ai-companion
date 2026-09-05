import { useEffect, useMemo, useState } from 'react'
import { loadAIProfile, loadUserProfile } from '../lib/storage'
import { loadMemory, type MemoryItem } from '../lib/memory'
import { formatMemoryDate } from '../lib/aiSpaceDetail'
import {
  getAnniversaries,
  getDefaultAnniversary,
  isMilestoneAnniversary,
  pickNextBigDay,
  formatCountdown,
  formatAnniversaryDate,
  type Anniversary,
} from '../lib/anniversary'
import DefaultAvatar from './DefaultAvatar'
import WeeklyPage from './WeeklyPage'
import { getActiveSessionId, getMemoriesCache } from '../lib/sessionStore'
import { EntryChevron, HeartIcon, NotebookIcon, SparkleIcon } from './spaceIcons'

interface Props {
  onBack: () => void
  /** 引导「去写人设」/「去配置」跳「我的」页（App 里即 settings 视图） */
  onGoMine?: () => void
  /** 点「最近的大日子」卡 → 进纪念日页 */
  onOpenAnniversary?: () => void
}

export default function AISpace({ onBack, onGoMine, onOpenAnniversary }: Props) {
  // 当前会话（S2 空间按角色独立）：有会话 → 消息/记忆/首次见面全用该会话数据，无会话兜底全局
  const sessionId = getActiveSessionId()
  // TA 资料按会话隔离：空间头部显示当前角色的头像/姓名（统一从 ai_profile 读，2026-09-05 乔定案）
  const ai = loadAIProfile(sessionId || undefined)
  const user = loadUserProfile()
  const yourName = user.nickname || '你'

  // 详情页数据：进空间时读一次（记忆不会在空间内变化）。
  // 有会话读当前会话缓存（后端填充），无会话兜底全局 localStorage（游客/过渡态）
  const [memories] = useState<MemoryItem[]>(() => (sessionId ? getMemoriesCache(sessionId) : loadMemory()))

  // 子页面路由：home 资料页 / memories TA所忆 / events TA所记（大小事） / weekly TA所写（周记）
  const [page, setPage] = useState<'home' | 'memories' | 'events' | 'weekly'>('home')

  const sortedMemories = useMemo(
    () => [...memories].sort((a, b) => b.createdAt - a.createdAt),
    [memories],
  )

  // 最近的大日子（Big day）：当前角色纪念日里「下一次」最近的那条；点卡片进纪念日页。
  // 每个角色默认有「认识 TA 的日子」（角色创建那天）+ 下一个「在一起 X 天」里程碑
  //（getAnniversaries 首次读取自动补齐，TASK-UI3 七七拍板），所以每个角色都有各自的 Big day，互不串。
  const [bigDay, setBigDay] = useState<Anniversary | null>(null)
  useEffect(() => {
    const sid = sessionId || undefined
    getDefaultAnniversary(sid)
    // 大日子只取和角色相关的（couple）：个人生日/生理期是「关于我」的事，不占角色空间（2026-08-26 七七拍板）
    setBigDay(pickNextBigDay(getAnniversaries(sid).filter((a) => a.kind !== 'personal')))
  }, [sessionId])

  const goHome = () => setPage('home')

  /* ---- 子页面渲染 ---- */

  /** 资料页（home）：头部 + 最近的大日子卡 + 功能入口列表 */
  function renderHomePage() {
    return (
      <>
        <div className="ai-space-head">
          <div className="ai-space-topbar">
            <button type="button" className="link-btn ai-space-back" onClick={onBack}>
              ‹ 返回
            </button>
            <h1 className="ai-space-title">{ai.nickname ? `${ai.nickname} 的空间` : 'TA 的空间'}</h1>
            <span className="ai-space-topbar-spacer" aria-hidden="true" />
          </div>

          <div className="ai-space-avatar" aria-hidden="true">
            {ai.avatar.startsWith('data:') ? (
              <img src={ai.avatar} alt="" />
            ) : ai.nickname ? (
              <span className="ai-space-avatar-letter">{ai.nickname.slice(0, 1)}</span>
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
          {/* 最近的大日子卡：点它进纪念日页（2026-08-25 七七拍板） */}
          {bigDay && onOpenAnniversary && (
            <button type="button" className="ai-space-bigday" onClick={onOpenAnniversary}>
              <span className="ai-space-bigday-icon" aria-hidden="true">
                <HeartIcon />
              </span>
              <span className="ai-space-bigday-main">
                <span className="ai-space-bigday-label">最近的大日子</span>
                <span className="ai-space-bigday-count">{formatCountdown(bigDay)}</span>
                <span className="ai-space-bigday-sub">
                  {isMilestoneAnniversary(bigDay)
                    ? `${ai.nickname ? `和${ai.nickname}` : ''}${bigDay.label}`
                    : `${bigDay.label} · ${formatAnniversaryDate(bigDay.date)}`}
                </span>
              </span>
              <span className="ai-space-bigday-arrow" aria-hidden="true">
                ›
              </span>
            </button>
          )}

          {/* 功能入口列表：TA所忆 / TA所记 / TA所写（2026-08-25 七七拍板，TA所X 系列） */}
          <div className="ai-space-entry-list">
            <button type="button" className="ai-space-entry-row" onClick={() => setPage('memories')}>
              <span className="ai-space-entry-icon" aria-hidden="true">
                <HeartIcon />
              </span>
              <span className="ai-space-entry-main">
                <span className="ai-space-entry-title">TA所忆</span>
                <span className="ai-space-entry-sub">TA 记得的事 · {memories.length} 件记忆</span>
              </span>
              <EntryChevron />
            </button>

            <button type="button" className="ai-space-entry-row" onClick={() => setPage('events')}>
              <span className="ai-space-entry-icon" aria-hidden="true">
                <SparkleIcon />
              </span>
              <span className="ai-space-entry-main">
                <span className="ai-space-entry-title">TA所记</span>
                <span className="ai-space-entry-sub">你们的大小事</span>
              </span>
              <EntryChevron />
            </button>

            <button type="button" className="ai-space-entry-row" onClick={() => setPage('weekly')}>
              <span className="ai-space-entry-icon" aria-hidden="true">
                <NotebookIcon />
              </span>
              <span className="ai-space-entry-main">
                <span className="ai-space-entry-title">TA所写</span>
                <span className="ai-space-entry-sub">TA 写的周记 · 每周最多一篇</span>
              </span>
              <EntryChevron />
            </button>
          </div>
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
