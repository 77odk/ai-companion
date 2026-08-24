// 全屏角色列表页（S2）：删除侧边栏后，角色/会话列表搬到这里
// 对标 ling/微信列表：每个角色一行（首字圆形头像 + 角色名大字 + 最近消息摘要 + 右侧时间/未读角标）。
// 顶部返回 + 新建；每项「···」操作：改名（PATCH title）/ 删除（确认后级联删）。
// 数据自持：getSessionsCache() 初始化 + 进入页面时 listSessions 刷新；每次改动同步写回缓存，
// 这样聊天页头部入口、Chat 取名都拿到新名字。纯展示外的事（切会话/新建/删除/改名）都在这页做，
// 需要 App 配合的只通过 onBack / onNew / onSwitch 三个导航回调。

import { useEffect, useState } from 'react'
import { getToken } from '../lib/auth'
import { deleteSession, listSessions, patchSession, type Session } from '../lib/sessionApi'
import { displaySessionName, pickNextSessionAfterDelete, sessionTimestamp } from '../lib/sessionFlow'
import {
  clearMemoriesCache,
  clearMessagesCache,
  getActiveSessionId,
  getMessagesCache,
  getSessionsCache,
  getUnreadCount,
  setActiveSessionId,
  setSessionsCache,
} from '../lib/sessionStore'
import { stripMemoryMarkers } from '../lib/memory'
import { truncatePreview } from '../lib/aiSpaceDetail'
import { timeAgo } from '../lib/time'
import type { StoredMessage } from '../lib/storage'

interface Props {
  /** 返回聊天页 */
  onBack: () => void
  /** 新建角色：App 跳选角色页（roleMode='first'） */
  onNew: () => void
  /** 会话已切换（本页已 setActiveSessionId），App 回聊天页 */
  onSwitch: () => void
}

/** 某会话最近一条消息（按 ts 取最新；空内容不算） */
function lastMessage(sessionId: string): StoredMessage | null {
  const msgs = getMessagesCache(sessionId)
  if (msgs.length === 0) return null
  return msgs.reduce<StoredMessage | null>((best, m) => (!best || m.ts > best.ts ? m : best), null)
}

export default function RolesPage({ onBack, onNew, onSwitch }: Props) {
  // 列表自持：进页面先用缓存秒开，再拉后端刷新（拉取失败用缓存兜底）
  const [sessions, setSessions] = useState<Session[]>(() => getSessionsCache())
  // 「···」动作菜单开在哪个会话上（null = 收起）
  const [menuFor, setMenuFor] = useState<string | null>(null)
  // 改名弹窗：正在改的会话 + 输入框草稿
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  // 删除请求进行中（禁用删除按钮防连点）
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const token = getToken()
    if (!token) return
    let cancelled = false
    listSessions(token).then((res) => {
      if (cancelled || !res.ok) return
      setSessions(res.data.sessions)
      setSessionsCache(res.data.sessions)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const list = Array.isArray(sessions) ? sessions : []
  const activeId = getActiveSessionId()

  const switchSession = (id: string) => {
    setMenuFor(null)
    setActiveSessionId(id)
    onSwitch()
  }

  const handleNew = () => {
    setMenuFor(null)
    onNew()
  }

  const handleDelete = async (id: string, title: string) => {
    setMenuFor(null)
    if (deleting) return
    if (!window.confirm(`删掉「${title}」这个会话？聊天、记忆会一起清除，删了找不回。`)) return
    const token = getToken()
    if (!token) return
    setDeleting(true)
    try {
      const res = await deleteSession(token, id)
      if (!res.ok) {
        window.alert('没删掉，网络开小差了，稍后再试试。')
        return
      }
      clearMessagesCache(id)
      clearMemoriesCache(id)
      const remaining = list.filter((s) => String(s.id) !== String(id))
      setSessions(remaining)
      setSessionsCache(remaining)
      // 删的是当前会话：剩 >0 切最近一个，无会话进选角色页新建
      if (getActiveSessionId() === String(id)) {
        const next = pickNextSessionAfterDelete(remaining, id)
        if (next) {
          setActiveSessionId(String(next.id))
          onSwitch()
        } else {
          setActiveSessionId('')
          onNew()
        }
      }
    } finally {
      setDeleting(false)
    }
  }

  const openRename = (id: string, title: string) => {
    setMenuFor(null)
    setRenaming({ id, title })
    setRenameDraft(title)
  }

  const confirmRename = async () => {
    const t = renameDraft.trim()
    if (!renaming || !t) return
    const token = getToken()
    if (!token) return
    const res = await patchSession(token, renaming.id, { title: t })
    if (!res.ok) {
      window.alert('没改掉，网络开小差了，稍后再试试。')
      return
    }
    const updated = list.map((s) => (String(s.id) === String(renaming.id) ? { ...s, title: t } : s))
    setSessions(updated)
    setSessionsCache(updated)
    setRenaming(null)
  }

  return (
    <div className="roles-page">
      <div className="detail-header roles-header">
        <button type="button" className="detail-back" onClick={onBack} aria-label="返回">
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
        <h1 className="detail-title">角色</h1>
        <button type="button" className="roles-new" onClick={handleNew} aria-label="新建角色">
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
          <span>新建</span>
        </button>
      </div>

      {list.length === 0 ? (
        <div className="roles-empty">
          <p className="roles-empty-text">还没有角色，点下面新建一个 TA</p>
          <button type="button" className="btn btn-primary" onClick={handleNew}>
            新建角色
          </button>
        </div>
      ) : (
        <ul className="roles-list">
          {list.map((s) => {
            const id = String(s.id)
            const active = id === activeId
            const displayName = displaySessionName(s)
            const last = lastMessage(id)
            const unread = getUnreadCount(s)
            const summary = last ? truncatePreview(stripMemoryMarkers(last.content), 18) : ''
            return (
              <li key={id} className={`roles-item${active ? ' active' : ''}`}>
                <button
                  type="button"
                  className="roles-main"
                  onClick={() => switchSession(id)}
                  aria-label={`切换到角色：${displayName}`}
                >
                  <span className="roles-avatar" aria-hidden="true">
                    {displayName.slice(0, 1)}
                  </span>
                  <span className="roles-info">
                    <span className="roles-item-title">{displayName}</span>
                    <span className="roles-item-summary">{summary || '还没有消息'}</span>
                  </span>
                </button>
                <span className="roles-side">
                  <span className="roles-item-time">{timeAgo(sessionTimestamp(s))}</span>
                  {unread > 0 && (
                    <span className="roles-badge" aria-label={`${unread} 条未读`}>
                      {unread >= 99 ? '99+' : unread}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="roles-more"
                  onClick={() => setMenuFor(menuFor === id ? null : id)}
                  aria-label={`角色操作：${displayName}`}
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
                  <div className="roles-menu" role="menu">
                    <button
                      type="button"
                      className="roles-menu-item"
                      onClick={() => openRename(id, displayName)}
                    >
                      改名
                    </button>
                    <button
                      type="button"
                      className="roles-menu-item roles-menu-danger"
                      onClick={() => void handleDelete(id, displayName)}
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

      {/* 菜单展开时点列表其他位置收起（半透明遮罩，不拦截菜单本体） */}
      {menuFor && <div className="roles-menu-backdrop" onClick={() => setMenuFor(null)} aria-hidden="true" />}

      {renaming && (
        <div
          className="roles-rename-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="给角色改名"
          onClick={(e) => {
            e.stopPropagation()
            setRenaming(null)
          }}
        >
          <div className="roles-rename" onClick={(e) => e.stopPropagation()}>
            <h3 className="roles-rename-title">改个名字</h3>
            <input
              className="input roles-rename-input"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) void confirmRename()
              }}
              placeholder="输入 TA 的新名字"
              maxLength={30}
              autoFocus
            />
            <div className="roles-rename-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setRenaming(null)}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void confirmRename()}
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
