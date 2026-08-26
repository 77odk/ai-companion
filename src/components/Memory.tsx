import { useState } from 'react'
import { stripMemoryMarkers } from '../lib/memory'
import { getActiveSessionId, getMessagesCache, getSessionsCache } from '../lib/sessionStore'
import { getFirstSeen, loadAIProfile, type StoredMessage } from '../lib/storage'
import { displaySessionName } from '../lib/sessionFlow'
import { roleInitial } from '../lib/sessionProfile'
import { computeDaysKnown, truncatePreview } from '../lib/aiSpaceDetail'
import type { Session } from '../lib/sessionApi'

/** 「关于我」卡片的人物图标：细描边线条（暖橘由 CSS currentColor 控制） */
function UserIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6" />
    </svg>
  )
}

/** 某会话最近一条消息摘要（画廊卡片小字；无消息返回空串） */
function lastMessageSummary(sessionId: string): string {
  const msgs = getMessagesCache(sessionId)
  if (msgs.length === 0) return ''
  const last = msgs.reduce<StoredMessage | null>((best, m) => (!best || m.ts > best.ts ? m : best), null)
  return last ? truncatePreview(stripMemoryMarkers(last.content), 18) : ''
}

/** 某会话相处天数小字：有认识起点就显示，否则空串 */
function daysKnownText(sessionId: string): string {
  const first = getFirstSeen(sessionId)
  if (!first) return ''
  return `认识第 ${computeDaysKnown(first)} 天`
}

interface MemoryProps {
  /** 点「关于我」卡片 → 进关于我页（我的重要日子 + 我说的） */
  onOpenAboutMe?: () => void
  /** 忆览页「全部角色」画廊：点卡片 → 切会话并进该角色的 TA 空间 */
  onOpenSpaceForSession?: (sessionId: string) => void
}

export default function Memory({ onOpenAboutMe, onOpenSpaceForSession }: MemoryProps) {
  // B2c-3 会话模式：有 activeSessionId → 记忆读当前会话缓存；无会话（过渡态）→ 读本地
  const activeSessionId = getActiveSessionId()
  // 忆览页「全部角色」画廊：从会话缓存读全部角色（每次进入页面重新挂载，读最新缓存）
  const [roleSessions] = useState<Session[]>(() => getSessionsCache())

  return (
    <div className="page memory-page">
      <h2 className="memory-page-title">TA 空间</h2>
      <p className="page-desc">
        每个 TA 都有自己的一片空间——TA 记得的事、TA 写的周记、你们的日子。
        <br />
        {activeSessionId
          ? '点下面的角色卡，进去看看这个 TA 自己的空间。'
          : '选好 TA 开始聊之后，这里就会有每个 TA 自己的空间。'}
      </p>

      {!activeSessionId && (
        <div className="memory-session-guide">
          <p>当前还没在会话里，先选一个 TA 开始聊吧。</p>
        </div>
      )}

      {/* 全部角色的卡片画廊：点卡片进该角色的 TA 空间（头像按角色隔离，TASK-UI3） */}
      {roleSessions.length > 0 && (
        <section className="memory-roles" aria-label="全部角色">
          <h3 className="memory-roles-title">全部角色</h3>
          <div className="memory-roles-grid">
            {roleSessions.map((s) => {
              const id = String(s.id)
              const name = displaySessionName(s)
              const sub = lastMessageSummary(id) || daysKnownText(id) || '还没有消息'
              const roleAvatar = loadAIProfile(id).avatar
              return (
                <button
                  key={id}
                  type="button"
                  className="memory-role-card"
                  onClick={() => onOpenSpaceForSession?.(id)}
                  aria-label={`进入 ${name} 的空间`}
                >
                  <span className="memory-role-avatar" aria-hidden="true">
                    {roleAvatar.startsWith('data:') ? (
                      <img className="memory-role-avatar-img" src={roleAvatar} alt="" />
                    ) : (
                      roleInitial(name)
                    )}
                  </span>
                  <span className="memory-role-name">{name}</span>
                  <span className="memory-role-sub">{sub}</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* 「关于我」入口卡片：一行样式（跟原相逢纪同款），点进关于我页（我的重要日子 + 我说的） */}
      {onOpenAboutMe && (
        <button type="button" className="anniversary-strip" onClick={onOpenAboutMe}>
          <span className="anniversary-strip-icon" aria-hidden="true">
            <UserIcon />
          </span>
          <span className="anniversary-strip-title">关于我</span>
          <span className="anniversary-strip-main">
            <span className="anniversary-strip-label">我的重要日子，和我想让 TA 记住的</span>
          </span>
          <span className="anniversary-strip-arrow" aria-hidden="true">
            ›
          </span>
        </button>
      )}
    </div>
  )
}
