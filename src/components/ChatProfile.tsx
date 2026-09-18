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
import { extractPersonality, extractBackgroundLine, extractOpeningLine } from '../lib/customPersona'
import { resolveRolePersona } from '../lib/sessionProfile'
import DefaultAvatar from './DefaultAvatar'
import SpaceChatLogs from './SpaceChatLogs'
import ChatBgSetting from './ChatBgSetting'
import SpaceLife from './SpaceLife'
import { AIDetail } from './Settings'
import { ChatIcon, EntryChevron, RefreshIcon, SparkleIcon } from './spaceIcons'

interface Props {
  /** 关闭资料卡回聊天 */
  onClose: () => void
  /** 「去写人设」跳「我的」页（App 里即 settings 视图），透传给 TA 的生活引导卡 */
  onGoMine?: () => void
  /** 从角色管理进来（点角色 → 资料卡，而不是直接进聊天）；此时显示「和 TA 聊天」按钮 */
  fromRoles?: boolean
  /** 「和 TA 聊天」：从资料卡进聊天（角色管理模式用） */
  onChat?: () => void
  /** 临时查看的角色 id（角色管理「角色详情」只看不切）；缺省读当前会话 */
  sessionIdOverride?: string
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

export default function ChatProfile({ onClose, onGoMine, fromRoles = false, onChat, sessionIdOverride }: Props) {
  // 当前会话（角色管理「角色详情」临时查看时用 sessionIdOverride；其余入口读当前会话；无会话兜底全局）
  const sessionId = sessionIdOverride ?? getActiveSessionId()
  // TA 资料按会话隔离：资料卡显示当前角色的头像/姓名
  const ai = loadAIProfile(sessionId || undefined)
  const user = loadUserProfile()
  const yourName = user.nickname || '你'
  const hasPersona = Boolean(sessionId) || Boolean(loadPersona().trim())
  // 设定卡扩展字段（TASK-UI1）：备注 + 性别，按会话隔离（改 A 不影响 B）
  const aiRemark = loadAIRemark(sessionId || undefined)
  const aiGender = loadAIGender(sessionId || undefined)

  // 名字：每次渲染直接读（编辑完返回展示卡要立刻反映新名字；原来挂载时读一次会显示旧值）
  const profileSessionName = (() => {
    if (!sessionId) return ''
    const s = getSessionsCache().find((x) => String(x.id) === sessionId)
    return s ? displaySessionName(s) : ''
  })()
  // 相识天数：角色创建那天起算
  const [daysKnown] = useState<number>(() => profileDaysKnown(sessionId || null))
  // TA 的样子：展示态从人设拆三段（会话 persona 优先，无会话兜底全局），没写就不摆行
  // ★每次渲染直接读：编辑完返回展示卡要立刻反映新数据（原来 useState 只在挂载时读一次，改完不刷新）
  const who = ((): { personality: string; background: string; opening: string } => {
    const sessions = getSessionsCache()
    const persona = sessionId ? resolveRolePersona(sessionId, sessions, loadPersona()) : loadPersona()
    return {
      personality: extractPersonality(persona),
      background: extractBackgroundLine(persona),
      opening: extractOpeningLine(persona),
    }
  })()
  // 聊天记录子页数据：进资料卡时读一次（聊天页里消息不会在资料卡内变化）
  const [messages] = useState<StoredMessage[]>(() => (sessionId ? getMessagesCache(sessionId) : loadMessages()))

  // 子页面路由：home 资料卡 / profile TA 的资料 / life TA 的生活 / chats 聊天记录 / bg 聊天背景
  const [page, setPage] = useState<'home' | 'profile' | 'life' | 'chats' | 'bg'>('home')
  const goHome = () => setPage('home')

  // 刷新对话：仅清当前对话上下文（TA 忘掉重来），聊天记录一条不删。
  // ★2026-09-03 修复：起点按会话隔离存储（sessionId 透传），会话模式下聊天页才能真正读到。
  // 刷新后回聊天页（view 切走再切回，Chat 重新挂载）会重新按起点过滤，旧消息不再发给 TA。
  const [confirmRefresh, setConfirmRefresh] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  const doRefresh = () => {
    setSessionStart(Date.now(), sessionId || undefined)
    setConfirmRefresh(false)
    setHint('已刷新，TA 从新的一页开始')
    window.setTimeout(() => setHint(null), 2600)
  }

  // 子页面：整页替换（各自带返回条），资料卡 home 才是这层的主页
  if (page === 'profile') {
    // 传当前看的角色：从角色管理进来时看的是它自己的资料卡（不自作主张改当前会话那个）
    return <AIDetail onBack={goHome} sessionId={sessionId || undefined} />
  }
  if (page === 'bg') {
    return <ChatBgSetting sessionId={sessionId || undefined} onBack={goHome} />
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
    <div className="page ta-profile-page">
      <div className="ta-profile-topbar">
        <button type="button" className="ta-profile-back" onClick={onClose} aria-label="返回">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1>TA 的资料</h1>
        <span className="ta-profile-topbar-spacer" aria-hidden="true" />
      </div>

      <section className="ta-profile-hero">
        <button
          type="button"
          className="ta-profile-avatar"
          onClick={() => setPage('profile')}
          aria-label="编辑 TA 的资料"
          title="编辑 TA 的资料"
        >
          {ai.avatar.startsWith('data:') ? (
            <img src={ai.avatar} alt="" />
          ) : profileSessionName ? (
            <span className="ta-profile-avatar-letter">{profileSessionName.slice(0, 1)}</span>
          ) : (
            <DefaultAvatar kind="ai" className="avatar-default" />
          )}
        </button>

        <h2 className="ta-profile-name">{profileSessionName || ai.nickname}</h2>

        {(aiRemark || aiGender !== 'unknown') && (
          <p className="ta-profile-meta">
            {aiGender !== 'unknown' && <span>{AIGENDER_LABELS[aiGender]}</span>}
            {aiGender !== 'unknown' && aiRemark && <span className="ta-profile-meta-dot">·</span>}
            {aiRemark && <span>{aiRemark}</span>}
          </p>
        )}

        <p className="ta-profile-days">和 TA 认识的第 {daysKnown} 天</p>
      </section>

      <div className="ta-profile-body">
        {(who.personality || who.background || who.opening) && (
          <section className="ta-profile-who">
            <div className="ta-profile-section-head">
              <h3>TA 是谁</h3>
            </div>
            {who.personality && (
              <div className="ta-profile-who-row">
                <span className="ta-profile-who-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="8" r="3.5" />
                    <path d="M5.5 20c.8-3.7 3.3-5.7 6.5-5.7s5.7 2 6.5 5.7" />
                  </svg>
                </span>
                <span className="ta-profile-who-label">性格</span>
                <span className="ta-profile-who-value">{who.personality}</span>
              </div>
            )}
            {who.background && (
              <div className="ta-profile-who-row">
                <span className="ta-profile-who-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" />
                  </svg>
                </span>
                <span className="ta-profile-who-label">关系</span>
                <span className="ta-profile-who-value">{who.background}</span>
              </div>
            )}
            {who.opening && (
              <div className="ta-profile-who-row">
                <span className="ta-profile-who-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 4c-6 .3-10.6 3-13.2 8.3L4 20l7.7-2.8C17 14.6 19.7 10 20 4z" />
                    <path d="M7 17l6-6" />
                  </svg>
                </span>
                <span className="ta-profile-who-label">初印象</span>
                <span className="ta-profile-who-value">{who.opening}</span>
              </div>
            )}
          </section>
        )}

        <section className="ta-profile-menu">
          <button type="button" className="ta-profile-menu-row" onClick={() => setPage('profile')}>
            <span className="ta-profile-menu-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 20l4.3-1 10-10-3.3-3.3-10 10L4 20z" />
                <path d="M13.8 6.8l3.4 3.4" />
              </svg>
            </span>
            <span className="ta-profile-menu-label">编辑 TA 的资料</span>
            <EntryChevron />
          </button>

          <button type="button" className="ta-profile-menu-row" onClick={() => setPage('life')}>
            <span className="ta-profile-menu-icon" aria-hidden="true"><SparkleIcon /></span>
            <span className="ta-profile-menu-label">TA 的生活</span>
            <EntryChevron />
          </button>

          <button type="button" className="ta-profile-menu-row" onClick={() => setPage('chats')}>
            <span className="ta-profile-menu-icon" aria-hidden="true"><ChatIcon /></span>
            <span className="ta-profile-menu-label">聊天记录</span>
            <EntryChevron />
          </button>

          <button type="button" className="ta-profile-menu-row" onClick={() => setPage('bg')}>
            <span className="ta-profile-menu-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2.5" />
                <circle cx="9" cy="9" r="1.8" />
                <path d="M4.5 18.5l5-5 3.5 3.5 3-3 3.5 3.5" />
              </svg>
            </span>
            <span className="ta-profile-menu-label">聊天背景</span>
            <EntryChevron />
          </button>
        </section>

        <section className="ta-profile-refresh">
          <button
            type="button"
            className="ta-profile-menu-row ta-profile-refresh-row"
            onClick={() => setConfirmRefresh(true)}
            aria-expanded={confirmRefresh}
          >
            <span className="ta-profile-menu-icon" aria-hidden="true"><RefreshIcon /></span>
            <span className="ta-profile-menu-label">刷新对话</span>
            <EntryChevron open={confirmRefresh} />
          </button>
          {confirmRefresh && (
            <div className="ta-profile-refresh-confirm">
              <p>刷新后聊天框内容清空，聊天记录仍可查看。</p>
              <div className="ta-profile-refresh-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmRefresh(false)}>再想想</button>
                <button type="button" className="btn btn-primary" onClick={doRefresh}>确认刷新</button>
              </div>
            </div>
          )}
        </section>

        {fromRoles && onChat && (
          <button type="button" className="btn ta-profile-chat-cta" onClick={onChat}>
            <ChatIcon />
            <span>和 TA 聊天</span>
          </button>
        )}

        {hint && <p className="ta-profile-hint">{hint}</p>}
      </div>
    </div>
  )
}
