// 会话侧边栏（B3 + S1）：聊天页左上角按钮点开的左侧滑出面板
// 会话列表（角色名+头像+最近消息+未读红点）、新建会话、点击切换、改名、删除（二次确认）。
// 纯展示组件：所有动作通过 props 回调交给 App 处理（改名/删除由 App 调后端）。
// 红线：全站图标用线条 SVG（禁 emoji）；文案用「TA」；删除是用户显式操作，走 window.confirm。

import { useState } from 'react'
import type { Session } from '../lib/sessionApi'
import { displaySessionName, sessionTimestamp } from '../lib/sessionFlow'
import { timeAgo } from '../lib/time'
import { getMessagesCache, getUnreadCount } from '../lib/sessionStore'
import { stripMemoryMarkers } from '../lib/memory'
import { truncatePreview } from '../lib/aiSpaceDetail'
import type { StoredMessage } from '../lib/storage'

/** 侧边栏会话条目：直接用后端 Session（id/title/created_at/updatedAt），persona 本组件不展示 */
export type SessionSummary = Session

interface Props {
  /** 是否展开（false 时不渲染） */
  open: boolean
  onClose: () => void
  sessions: SessionSummary[]
  /** 当前会话 id（字符串） */
  activeId: string
  /** 点击某会话：切换过去 */
  onSwitch: (id: string) => void
  /** 「+ 新建会话」：App 跳选角色页 */
  onNew: () => void
  /** 确认后删除某会话（已确认，App 执行后端删除） */
  onDelete: (id: string) => void
  /** 改名确认（已输入新名字，App 执行 patchSession） */
  onRename: (id: string, title: string) => void
  /** 删除请求进行中（禁用删除按钮防连点） */
  deleting?: boolean
}

/** 某会话最近一条消息（按 ts 取最新；空内容不算） */
function lastMessage(sessionId: string): StoredMessage | null {
  const msgs = getMessagesCache(sessionId)
  if (msgs.length === 0) return null
  return msgs.reduce<StoredMessage | null>((best, m) => (!best || m.ts > best.ts ? m : best), null)
}

export default function SessionSidebar({
  open,
  onClose,
  sessions,
  activeId,
  onSwitch,
  onNew,
  onDelete,
  onRename,
  deleting,
}: Props) {
  // 「···」动作菜单开在哪个会话上（null = 收起）
  const [menuFor, setMenuFor] = useState<string | null>(null)
  // 改名弹窗：正在改的会话 + 输入框草稿
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  if (!open) return null

  const list = Array.isArray(sessions) ? sessions : []

  const handleDelete = (id: string, title: string) => {
    setMenuFor(null)
    if (deleting) return
    if (!window.confirm(`删掉「${title}」这个会话？聊天、记忆会一起清除，删了找不回。`)) return
    onDelete(id)
  }

  const openRename = (id: string, title: string) => {
    setMenuFor(null)
    setRenaming({ id, title })
    setRenameDraft(title)
  }

  const confirmRename = () => {
    const t = renameDraft.trim()
    if (renaming && t) onRename(renaming.id, t)
    setRenaming(null)
  }

  return (
    <div className="session-sidebar-overlay" onClick={onClose}>
      <aside
        className="session-sidebar-panel"
        role="dialog"
        aria-modal="true"
        aria-label="会话列表"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="session-sidebar-header">
          <h2 className="session-sidebar-title">和 TA 们聊天</h2>
          <button type="button" className="session-sidebar-close" onClick={onClose} aria-label="关闭">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <button type="button" className="session-sidebar-new" onClick={onNew}>
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
          <span>新建会话</span>
        </button>

        {list.length === 0 ? (
          <div className="session-sidebar-empty">
            <p className="session-sidebar-empty-text">还没有会话，点上面新建一个 TA</p>
            <button type="button" className="btn btn-primary" onClick={onNew}>
              新建会话
            </button>
          </div>
        ) : (
          <ul className="session-sidebar-list">
            {list.map((s) => {
              const id = String(s.id)
              const active = id === activeId
              const displayName = displaySessionName(s)
              const last = lastMessage(id)
              const unread = getUnreadCount(s)
              const summary = last ? truncatePreview(stripMemoryMarkers(last.content), 18) : ''
              return (
                <li key={id} className={`session-sidebar-item${active ? ' active' : ''}`}>
                  <button
                    type="button"
                    className="session-sidebar-main"
                    onClick={() => onSwitch(id)}
                    aria-label={`切换到会话：${displayName}`}
                  >
                    <span className="session-sidebar-avatar" aria-hidden="true">
                      {displayName.slice(0, 1)}
                    </span>
                    <span className="session-sidebar-info">
                      <span className="session-sidebar-item-title">{displayName}</span>
                      <span className="session-sidebar-item-summary">
                        {summary || '还没有消息'}
                      </span>
                    </span>
                  </button>
                  <span className="session-sidebar-item-time">{timeAgo(sessionTimestamp(s))}</span>
                  {unread > 0 && (
                    <span className="session-sidebar-badge" aria-label={`${unread} 条未读`}>
                      {unread >= 99 ? '99+' : unread}
                    </span>
                  )}
                  <button
                    type="button"
                    className="session-sidebar-more"
                    onClick={() => setMenuFor(menuFor === id ? null : id)}
                    aria-label={`会话操作：${displayName}`}
                    title="操作"
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
                      <circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
                      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
                      <circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none" />
                    </svg>
                  </button>
                  {menuFor === id && (
                    <div className="session-sidebar-menu" role="menu">
                      <button
                        type="button"
                        className="session-sidebar-menu-item"
                        onClick={() => openRename(id, displayName)}
                      >
                        改名
                      </button>
                      <button
                        type="button"
                        className="session-sidebar-menu-item session-sidebar-menu-danger"
                        onClick={() => handleDelete(id, displayName)}
                        disabled={deleting}
                      >
                        删除
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </aside>

      {renaming && (
        <div
          className="session-sidebar-rename-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="给角色改名"
          onClick={(e) => {
            e.stopPropagation()
            setRenaming(null)
          }}
        >
          <div className="session-sidebar-rename" onClick={(e) => e.stopPropagation()}>
            <h3 className="session-sidebar-rename-title">改个名字</h3>
            <input
              className="input session-sidebar-rename-input"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) confirmRename()
              }}
              placeholder="输入 TA 的新名字"
              maxLength={30}
              autoFocus
            />
            <div className="session-sidebar-rename-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setRenaming(null)}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={confirmRename}
                disabled={!renameDraft.trim()}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
