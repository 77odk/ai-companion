// 聊天头像资料卡（2026-08-25 七七拍板改版，TASK-UI1 再改）：
// 聊天页点角色头像 → 打开资料卡。卡片 = 角色大头像 + 名字 + 性别/备注 + 「相识的第 N 天」大字（不带框）
// + 入口列表（TA 的资料 / TA 的生活 / 聊天记录 / 刷新对话）。
// 相识天数从「角色创建那天」开始自动计数（会话 created_at；无会话兜底 getFirstSeen）。
// 子页面复用现有组件：AIDetail（TA 的资料=角色设定卡完整版）、SpaceLife（TA 的生活）、
// SpaceChatLogs（聊天记录）；刷新对话 = 设置会话起点（TA 忘掉重来，聊天记录一条不删）。

import { useState } from 'react'
import {
  loadAIProfile,
  loadAIGender,
  loadAIRemark,
  loadMessages,
  loadPersona,
  loadUserProfile,
  getFirstSeen,
  setSessionStart,
  AIGENDER_LABELS,
  type StoredMessage,
} from '../lib/storage'
import { getActiveSessionId, getMessagesCache, getSessionsCache } from '../lib/sessionStore'
import { displaySessionName } from '../lib/sessionFlow'
import { computeDaysKnown } from '../lib/aiSpaceDetail'
import DefaultAvatar from './DefaultAvatar'
import SpaceChatLogs from './SpaceChatLogs'
import SpaceLife from './SpaceLife'
import { AIDetail } from './Settings'
import { ChatIcon, EntryChevron, RefreshIcon, SparkleIcon } from './spaceIcons'

interface Props {
  /** 关闭资料卡回聊天 */
  onClose: () => void
  /** 「去写人设」跳「我的」页（App 里即 settings 视图），透传给 TA 的生活引导卡 */
  onGoMine?: () => void
}

/** 相识天数：角色创建（会话 created_at）当天起算；无会话/读不到回落 getFirstSeen，至少 1 天 */
function profileDaysKnown(sessionId: string | null): number {
  if (sessionId) {
    const s = getSessionsCache().find((x) => String(x.id) === sessionId)
    if (s && typeof (s as { created_at?: string }).created_at === 'string') {
      const t = Date.parse((s as { created_at: string }).created_at)
      if (Number.isFinite(t) && t > 0) return computeDaysKnown(t)
    }
  }
  // 无会话/旧会话没 created_at：回落最老消息/记忆时间
  return computeDaysKnown(getFirstSeen(sessionId || undefined))
}

export default function ChatProfile({ onClose, onGoMine }: Props) {
  const ai = loadAIProfile()
  const user = loadUserProfile()
  const yourName = user.nickname || '你'
  const hasPersona = Boolean(loadPersona().trim())
  // 设定卡扩展字段（TASK-UI1）：备注 + 性别，资料卡首页直接展示
  const aiRemark = loadAIRemark()
  const aiGender = loadAIGender()

  // 当前会话（有会话 → 名字/消息/动态全用该会话数据，无会话兜底全局）
  const sessionId = getActiveSessionId()
  const [profileSessionName] = useState<string>(() => {
    if (!sessionId) return ''
    const s = getSessionsCache().find((x) => String(x.id) === sessionId)
    return s ? displaySessionName(s) : ''
  })
  // 相识天数：角色创建那天起算
  const [daysKnown] = useState<number>(() => profileDaysKnown(sessionId || null))
  // 聊天记录子页数据：进资料卡时读一次（聊天页里消息不会在资料卡内变化）
  const [messages] = useState<StoredMessage[]>(() => (sessionId ? getMessagesCache(sessionId) : loadMessages()))

  // 子页面路由：home 资料卡 / profile TA 的资料 / life TA 的生活 / chats 聊天记录
  const [page, setPage] = useState<'home' | 'profile' | 'life' | 'chats'>('home')
  const goHome = () => setPage('home')

  // 刷新对话：仅清当前对话上下文（TA 忘掉重来），聊天记录一条不删
  const [confirmRefresh, setConfirmRefresh] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  const doRefresh = () => {
    setSessionStart(Date.now())
    setConfirmRefresh(false)
    setHint('已刷新，TA 从新的一页开始')
    window.setTimeout(() => setHint(null), 2600)
  }

  // 子页面：整页替换（各自带返回条），资料卡 home 才是这层的主页
  if (page === 'profile') {
    return <AIDetail onBack={goHome} />
  }
  if (page === 'chats') {
    return <SpaceChatLogs messages={messages} yourName={yourName} aiNickname={ai.nickname} onBack={goHome} />
  }
  if (page === 'life') {
    return (
      <SpaceLife
        aiNickname={ai.nickname}
        yourName={yourName}
        sessionId={sessionId || undefined}
        hasPersona={hasPersona}
        onGoMine={onGoMine}
        onBack={goHome}
      />
    )
  }

  return (
    <div className="page ai-space-page">
      <div className="ai-space-head">
        <div className="ai-space-topbar">
          <button type="button" className="link-btn ai-space-back" onClick={onClose}>
            ‹ 关闭
          </button>
          <h1 className="ai-space-title">资料卡</h1>
          <span className="ai-space-topbar-spacer" aria-hidden="true" />
        </div>

        <button
          type="button"
          className="ai-space-avatar chatprofile-avatar-btn"
          onClick={() => setPage('profile')}
          aria-label="更换 TA 的头像"
          title="点这里换头像"
        >
          {ai.avatar.startsWith('data:') ? (
            <img src={ai.avatar} alt="" />
          ) : profileSessionName ? (
            <span className="ai-space-avatar-letter">{profileSessionName.slice(0, 1)}</span>
          ) : (
            <DefaultAvatar kind="ai" className="avatar-default" />
          )}
        </button>
        <h2 className="ai-space-name">{profileSessionName || ai.nickname}</h2>
        {/* 性别 + 备注小字（TASK-UI1 设定卡扩展字段）；都没填就不占这一行 */}
        {(aiRemark || aiGender !== 'unknown') && (
          <p className="chatprofile-meta">
            {aiGender !== 'unknown' && <span className="chatprofile-meta-gender">{AIGENDER_LABELS[aiGender]}</span>}
            {aiRemark && <span className="chatprofile-meta-remark">{aiRemark}</span>}
          </p>
        )}
        {/* 相识天数大字：不带框，角色创建那天起算（文案固定） */}
        <p className="chatprofile-days">相识的第 {daysKnown} 天</p>
        <p className="ai-space-bio">只属于{yourName}的 TA · 你们的聊天、日子和生活都在这里</p>
      </div>

      <div className="ai-space-timeline">
        {/* 功能入口列表：微信式资料页，每个入口都是子页面 */}
        <div className="ai-space-entry-list">
          {/* TA 的资料（最上面）：角色设定卡完整版，每项可改 */}
          <button type="button" className="ai-space-entry-row" onClick={() => setPage('profile')}>
            <span className="ai-space-entry-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="8" r="3.6" />
                <path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6" />
              </svg>
            </span>
            <span className="ai-space-entry-main">
              <span className="ai-space-entry-title">TA 的资料</span>
              <span className="ai-space-entry-sub">名字、备注、性别、性格、背景、开场白</span>
            </span>
            <EntryChevron />
          </button>

          {/* TA 的生活 */}
          <button type="button" className="ai-space-entry-row" onClick={() => setPage('life')}>
            <span className="ai-space-entry-icon" aria-hidden="true">
              <SparkleIcon />
            </span>
            <span className="ai-space-entry-main">
              <span className="ai-space-entry-title">TA 的生活</span>
              <span className="ai-space-entry-sub">TA 的日常与心情</span>
            </span>
            <EntryChevron />
          </button>

          {/* 聊天记录 */}
          <button type="button" className="ai-space-entry-row" onClick={() => setPage('chats')}>
            <span className="ai-space-entry-icon" aria-hidden="true">
              <ChatIcon />
            </span>
            <span className="ai-space-entry-main">
              <span className="ai-space-entry-title">聊天记录</span>
              <span className="ai-space-entry-sub">按日期归档，可回看</span>
            </span>
            <EntryChevron />
          </button>

          {/* 刷新对话：OOC 一键修复（仅刷新上下文，聊天记录永不删除） */}
          <div className="ai-space-refresh-card">
            <button
              type="button"
              className="ai-space-entry-row ai-space-entry-refresh"
              onClick={() => setConfirmRefresh(true)}
              aria-expanded={confirmRefresh}
            >
              <span className="ai-space-entry-icon" aria-hidden="true">
                <RefreshIcon />
              </span>
              <span className="ai-space-entry-main">
                <span className="ai-space-entry-title">好像 OOC 了？点击一下一键修复</span>
                <span className="ai-space-entry-sub">刷新对话，聊天记录归档，不会丢放心刷</span>
              </span>
              <EntryChevron open={confirmRefresh} />
            </button>
            {confirmRefresh && (
              <div className="ai-space-refresh-confirm">
                <p className="ai-space-refresh-confirm-text">刷新后聊天框内容清空，聊天记录内仍可查看</p>
                <div className="ai-space-refresh-confirm-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setConfirmRefresh(false)}>
                    再想想
                  </button>
                  <button type="button" className="btn btn-primary" onClick={doRefresh}>
                    确认刷新
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        {hint && <p className="ai-space-hint">{hint}</p>}
      </div>
    </div>
  )
}
