// 聊天头像资料卡（TASK-UI3 P3 新组件）：
// 聊天页点角色头像 → 打开资料卡。卡片内容 = 角色大头像 + 角色名 + 三个入口
// （聊天记录 / 相逢纪 / TA 的生活），每个入口进子页面、返回回资料卡；资料卡关闭回聊天。
// 子页面全部复用现有组件（SpaceChatLogs / AnniversaryPage / SpaceLife），不复制两份代码。

import { useState } from 'react'
import { loadAIProfile, loadMessages, loadPersona, loadUserProfile, type StoredMessage } from '../lib/storage'
import { getActiveSessionId, getMessagesCache, getSessionsCache } from '../lib/sessionStore'
import { displaySessionName } from '../lib/sessionFlow'
import DefaultAvatar from './DefaultAvatar'
import AnniversaryPage from './AnniversaryPage'
import SpaceChatLogs from './SpaceChatLogs'
import SpaceLife from './SpaceLife'
import { CalendarIcon, ChatIcon, EntryChevron, SparkleIcon } from './spaceIcons'

interface Props {
  /** 关闭资料卡回聊天 */
  onClose: () => void
  /** 「去写人设」跳「我的」页（App 里即 settings 视图），透传给 TA 的生活引导卡 */
  onGoMine?: () => void
}

export default function ChatProfile({ onClose, onGoMine }: Props) {
  const ai = loadAIProfile()
  const user = loadUserProfile()
  const yourName = user.nickname || '你'
  const hasPersona = Boolean(loadPersona().trim())

  // 当前会话（有会话 → 名字/消息/动态全用该会话数据，无会话兜底全局）
  const sessionId = getActiveSessionId()
  const [profileSessionName] = useState<string>(() => {
    if (!sessionId) return ''
    const s = getSessionsCache().find((x) => String(x.id) === sessionId)
    return s ? displaySessionName(s) : ''
  })
  // 聊天记录子页数据：进资料卡时读一次（聊天页里消息不会在资料卡内变化）
  const [messages] = useState<StoredMessage[]>(() => (sessionId ? getMessagesCache(sessionId) : loadMessages()))

  // 子页面路由：home 资料卡 / chats 聊天记录 / anniversary 相逢纪 / life TA 的生活
  const [page, setPage] = useState<'home' | 'chats' | 'anniversary' | 'life'>('home')
  const goHome = () => setPage('home')

  // 子页面：整页替换（各自带返回条），资料卡 home 才是这层的主页
  if (page === 'chats') {
    return <SpaceChatLogs messages={messages} yourName={yourName} aiNickname={ai.nickname} onBack={goHome} />
  }
  if (page === 'anniversary') {
    return <AnniversaryPage onBack={goHome} />
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

        <div className="ai-space-avatar" aria-hidden="true">
          {profileSessionName ? (
            <span className="ai-space-avatar-letter">{profileSessionName.slice(0, 1)}</span>
          ) : ai.avatar.startsWith('data:') ? (
            <img src={ai.avatar} alt="" />
          ) : (
            <DefaultAvatar kind="ai" className="avatar-default" />
          )}
        </div>
        <h2 className="ai-space-name">{profileSessionName || ai.nickname}</h2>
        <p className="ai-space-bio">只属于{yourName}的 TA · 你们的聊天、日子和生活都在这里</p>
      </div>

      <div className="ai-space-timeline">
        {/* 功能入口列表：微信式资料页，三个入口都是子页面 */}
        <div className="ai-space-entry-list">
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

          <button type="button" className="ai-space-entry-row" onClick={() => setPage('anniversary')}>
            <span className="ai-space-entry-icon" aria-hidden="true">
              <CalendarIcon />
            </span>
            <span className="ai-space-entry-main">
              <span className="ai-space-entry-title">相逢纪</span>
              <span className="ai-space-entry-sub">你们重要的日子</span>
            </span>
            <EntryChevron />
          </button>

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
        </div>
      </div>
    </div>
  )
}
