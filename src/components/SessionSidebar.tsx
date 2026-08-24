// 会话侧边栏（B3）：聊天页左上角按钮点开的左侧滑出面板
// 会话列表（标题+最近更新）、新建会话、点击切换、删除会话（二次确认）。
// 纯展示组件：所有动作通过 props 回调交给 App 处理。
// 红线：全站图标用线条 SVG（禁 emoji）；文案用「TA」；删除是用户显式操作，走 window.confirm。

import type { Session } from '../lib/sessionApi'
import { sessionTimestamp } from '../lib/sessionFlow'
import { timeAgo } from '../lib/time'

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
  /** 删除请求进行中（禁用删除按钮防连点） */
  deleting?: boolean
}

export default function SessionSidebar({
  open,
  onClose,
  sessions,
  activeId,
  onSwitch,
  onNew,
  onDelete,
  deleting,
}: Props) {
  if (!open) return null

  const list = Array.isArray(sessions) ? sessions : []

  const handleDelete = (id: string, title: string) => {
    if (deleting) return
    if (!window.confirm(`删掉「${title}」这个会话？聊天、记忆会一起清除，删了找不回。`)) return
    onDelete(id)
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
              const title = s.title || '新会话'
              const active = id === activeId
              return (
                <li key={id} className={`session-sidebar-item${active ? ' active' : ''}`}>
                  <button
                    type="button"
                    className="session-sidebar-main"
                    onClick={() => onSwitch(id)}
                    aria-label={`切换到会话：${title}`}
                  >
                    <span className="session-sidebar-item-title">{title}</span>
                    <span className="session-sidebar-item-time">{timeAgo(sessionTimestamp(s))}</span>
                  </button>
                  <button
                    type="button"
                    className="session-sidebar-delete"
                    onClick={() => handleDelete(id, title)}
                    disabled={deleting}
                    aria-label={`删除会话：${title}`}
                    title="删除"
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
                      <path d="M4 7h16" />
                      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
                      <path d="M10 11v6M14 11v6" />
                    </svg>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </aside>
    </div>
  )
}
