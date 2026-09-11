// 角色管理页（批 2-1 独立页化）：从「我的 → 角色管理」进入，全屏、无底部导航、不高亮任何 tab。
// 对标微信列表：每个角色一行（首字圆形头像 + 角色名大字 + 最近消息摘要 + 右侧时间/未读角标）。
// 顶部返回（回「我的」）+ 新建；每行两个按钮：「选择」（确认框 → 切换会话 → 回首页）和「角色详情」（只看资料卡，不切换会话）；
// 行本体点击 = 角色详情（批一行为保留，批 2-1 起不再切换当前会话）；每项「···」操作：改名 / 删除。
// 数据自持：getSessionsCache() 初始化 + 进入页面时 listSessions 刷新；每次改动同步写回缓存。
// 需要 App 配合的只通过 onBack / onNew / onSwitch / onOpenProfile / onSelectDone 五个导航回调。

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
import { wechatListTime } from '../lib/time'
import { loadAIProfile, saveAIProfile } from '../lib/storage'
import type { StoredMessage } from '../lib/storage'

interface Props {
  /** 返回「我的」（角色管理页的返回落点） */
  onBack: () => void
  /** 新建角色：App 跳选角色页（roleMode='first'） */
  onNew: () => void
  /** 会话已切换（本页已 setActiveSessionId），App 回聊天页（删除当前会话后切到最近会话用） */
  onSwitch: () => void
  /** 点角色/角色详情：只看资料卡不切换会话，App 用临时角色参数打开该角色资料卡（onOpenProfile(id)） */
  onOpenProfile: (sessionId: string) => void
  /** 「选择」确认后：App 回首页 */
  onSelectDone?: () => void
  /** 主页化（微信式）：嵌在底部导航里用（批 2-1 后只保留接口兼容，实际都走独立页） */
  standalone?: boolean
}

/** 某会话最近一条消息（按 ts 取最新；空内容不算） */
function lastMessage(sessionId: string): StoredMessage | null {
  const msgs = getMessagesCache(sessionId)
  if (msgs.length === 0) return null
  return msgs.reduce<StoredMessage | null>((best, m) => (!best || m.ts > best.ts ? m : best), null)
}

export default function RolesPage({ onBack, onNew, onSwitch, onOpenProfile, onSelectDone, standalone = true }: Props) {
  // 列表自持：进页面先用缓存秒开，再拉后端刷新（拉取失败用缓存兜底）
  const [sessions, setSessions] = useState<Session[]>(() => getSessionsCache())
  // 「···」动作菜单开在哪个会话上（null = 收起）
  const [menuFor, setMenuFor] = useState<string | null>(null)
  // 改名弹窗：正在改的会话 + 输入框草稿
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  // 删除请求进行中（禁用删除按钮防连点）
  const [deleting, setDeleting] = useState(false)
  // 「选择」确认层：开在哪个会话上（null = 收起）
  const [confirmingSelect, setConfirmingSelect] = useState<string | null>(null)

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

  // 微信式实时刷新（2026-08-26 七七拍板）：有新消息/缓存变化立刻重读重排，不用手动重进
  useEffect(() => {
    const onData = () => setSessions([...getSessionsCache()])
    window.addEventListener('eluvin-data-change', onData)
    return () => window.removeEventListener('eluvin-data-change', onData)
  }, [])

  const list = Array.isArray(sessions) ? sessions : []
  // 微信式排序（2026-08-26 七七拍板）：按最后一条消息的时间排，最新聊的排最上面；
  // 没消息的会话按会话时间戳兜底，排最后
  const sortedList = [...list].sort((a, b) => {
    const ta = lastMessage(String(a.id))?.ts ?? sessionTimestamp(a)
    const tb = lastMessage(String(b.id))?.ts ?? sessionTimestamp(b)
    return tb - ta
  })
  const activeId = getActiveSessionId()

  // 点角色/角色详情：打开该角色资料卡（不切换当前会话；资料卡由 App 用临时角色参数渲染）
  const openRoleProfile = (id: string) => {
    setMenuFor(null)
    setConfirmingSelect(null)
    onOpenProfile(id)
  }

  // 「选择」：弹确认框，确认后切会话 + 回首页
  const askSelect = (id: string) => {
    setMenuFor(null)
    setConfirmingSelect(id)
  }

  const confirmSelect = (id: string) => {
    setConfirmingSelect(null)
    setActiveSessionId(id)
    onSelectDone?.()
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
    // 统一数据源：改名同时写 ai_profile，空间头部显示从 ai_profile 读（2026-09-05 乔定案）
    const sid = String(renaming.id)
    const profile = loadAIProfile(sid)
    saveAIProfile({ ...profile, nickname: t }, sid)
    setRenaming(null)
  }

  const confirmingSession = confirmingSelect ? list.find((s) => String(s.id) === confirmingSelect) : null

  return (
    <div className="roles-page">
      <div className="detail-header roles-header">
        {standalone && (
          <button type="button" className="link-btn ai-space-back" onClick={onBack} aria-label="返回">
            ‹ 返回
          </button>
        )}
        <h1 className="detail-title">{standalone ? '角色管理' : '聊天'}</h1>
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
          {sortedList.map((s) => {
            const id = String(s.id)
            const active = id === activeId
            const displayName = displaySessionName(s)
            const last = lastMessage(id)
            const unread = getUnreadCount(s)
            const summary = last ? truncatePreview(stripMemoryMarkers(last.content), 18) : ''
            // 会话列表头像：显示该角色自己的头像图，没图用首字母（TASK-UI3 按角色隔离）
            const roleAvatar = loadAIProfile(id).avatar
            return (
              <li key={id} className={`roles-item${active ? ' active' : ''}`}>
                <button
                  type="button"
                  className="roles-main"
                  onClick={() => openRoleProfile(id)}
                  aria-label={`打开角色：${displayName}`}
                >
                  <span className="roles-avatar" aria-hidden="true">
                    {roleAvatar.startsWith('data:') ? (
                      <img src={roleAvatar} alt="" className="roles-avatar-img" />
                    ) : (
                      displayName.slice(0, 1)
                    )}
                  </span>
                  <span className="roles-info">
                    <span className="roles-item-title">{displayName}</span>
                    <span className="roles-item-summary">{summary || '还没有消息'}</span>
                  </span>
                </button>
                <span className="roles-side">
                  <span className="roles-item-time">{wechatListTime((last ? last.ts : sessionTimestamp(s)))}</span>
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
                {/* 批 2-1：行内两个按钮 —— 选择（确认后回首页）/ 角色详情（进资料卡） */}
                <span className="roles-actions">
                  <button
                    type="button"
                    className="roles-action roles-action-select"
                    onClick={() => askSelect(id)}
                    aria-label={`选择角色：${displayName}`}
                  >
                    选择
                  </button>
                  <button
                    type="button"
                    className="roles-action roles-action-detail"
                    onClick={() => openRoleProfile(id)}
                    aria-label={`角色详情：${displayName}`}
                  >
                    角色详情
                  </button>
                </span>
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

      {/* 「选择」确认层：确认后切会话回首页 */}
      {confirmingSession && (
        <div
          className="roles-select-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="切换角色"
          onClick={() => setConfirmingSelect(null)}
        >
          <div className="roles-select" onClick={(e) => e.stopPropagation()}>
            <h3 className="roles-select-title">切换到「{displaySessionName(confirmingSession)}」？</h3>
            <p className="roles-select-text">切换后，TA 主页和聊天都会跟着这个 TA 走。</p>
            <div className="roles-select-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmingSelect(null)}>
                取消
              </button>
              <button type="button" className="btn btn-primary" onClick={() => confirmSelect(confirmingSelect!)}>
                确认切换
              </button>
            </div>
          </div>
        </div>
      )}

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
