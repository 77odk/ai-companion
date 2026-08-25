// 关于我（TASK-UI 2026-08-25 七七拍板）：
// 忆览页「关于我」入口 → 这里只放「你自己的事」：
//   1) 我的资料头（头像/名字/签名）
//   2) 我的重要日子（生日、姨妈周期等 personal 纪念日，标题右侧加号添加，正数/倒数）
//   3) 想让 TA 记住你什么？（输入框 → explicit 记忆，=「我自己说的」）
//   4) 我自己说的列表（explicit 记忆，可删）
// 与 TA 相关的（AI 提炼的记忆、你们的日子）一律不进这页——TA 记得的去 TA 空间 TA所忆。

import { useEffect, useState } from 'react'
import {
  ANNIVERSARY_COLORS,
  addAnniversary,
  anniversaryColorIndex,
  formatAnniversaryDate,
  formatCountdown,
  getAnniversaries,
  isValidAnniversaryDate,
  removeAnniversary,
  type Anniversary,
  type CountMode,
} from '../lib/anniversary'
import {
  addMemoryItem,
  loadMemory,
  removeMemoryItem,
  stripMemoryMarkers,
  MEMORY_UPDATED_EVENT,
  type MemoryItem,
} from '../lib/memory'
import { getToken } from '../lib/auth'
import { deleteMemory, postMemory } from '../lib/sessionApi'
import {
  addMemoryCacheItem,
  getActiveSessionId,
  getMemoriesCache,
  reconcileMemoryCacheId,
  saveMemoriesCache,
} from '../lib/sessionStore'
import { loadUserProfile } from '../lib/storage'

interface Props {
  /** 返回忆览页 */
  onBack: () => void
}

/* ---- 线条图标（去 emoji，全站统一描边风格） ---- */

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

const DeleteIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
  </svg>
)

/** 「我自己说的」里的显式记忆：用户主动输入框添加的（explicit=true） */
function myExplicitMemories(sessionId: string | null): MemoryItem[] {
  const all = sessionId ? getMemoriesCache(sessionId) : loadMemory()
  return all.filter((m) => m.explicit === true)
}

export default function AboutMe({ onBack }: Props) {
  const user = loadUserProfile()
  const yourName = user.nickname || '你'

  // 我的重要日子：personal（自己的生日/节日）存全局 key，不绑任何角色
  const [days, setDays] = useState<Anniversary[]>(() =>
    getAnniversaries().filter((a) => a.kind === 'personal'),
  )

  // 我自己说的：explicit 记忆（会话模式读当前会话缓存，无会话读全局）
  const sid = getActiveSessionId() || null
  const [memories, setMemories] = useState<MemoryItem[]>(() => myExplicitMemories(sid))
  const [text, setText] = useState('')
  const [memError, setMemError] = useState<string | null>(null)

  // 添加纪念日表单
  const [formOpen, setFormOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [date, setDate] = useState('')
  const [countMode, setCountMode] = useState<CountMode>('forward')
  const [color, setColor] = useState('warm-orange')

  // 数据变更自动刷新
  useEffect(() => {
    const refresh = () => {
      setDays(getAnniversaries().filter((a) => a.kind === 'personal'))
      const s = getActiveSessionId() || null
      setMemories(myExplicitMemories(s))
    }
    window.addEventListener(MEMORY_UPDATED_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(MEMORY_UPDATED_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  const closeForm = () => {
    setFormOpen(false)
    setLabel('')
    setDate('')
    setCountMode('forward')
    setColor('warm-orange')
  }

  const handleAddDay = () => {
    const l = label.trim()
    const d = date.trim()
    if (!l || !isValidAnniversaryDate(d)) return
    addAnniversary(l, d, { countMode, color, kind: 'personal' })
    setDays(getAnniversaries().filter((a) => a.kind === 'personal'))
    closeForm()
  }

  const handleRemoveDay = (id: string) => {
    removeAnniversary(id)
    setDays(getAnniversaries().filter((a) => a.kind === 'personal'))
  }

  const handleAddMemory = () => {
    const t = text.trim()
    if (!t) return
    const s = getActiveSessionId()
    if (s) {
      const item = addMemoryCacheItem(s, t, '其他', true)
      setMemories(getMemoriesCache(s).filter((m) => m.explicit === true))
      const token = getToken()
      if (item && token) {
        postMemory(token, s, { content: t }).then((res) => {
          if (res.ok) {
            reconcileMemoryCacheId(s, item.id, res.data.id)
            setMemories(getMemoriesCache(s).filter((m) => m.explicit === true))
            setMemError(null)
          } else {
            setMemError('这条没传上去，已留在本地，稍后可再试')
          }
        })
      }
    } else {
      setMemories(addMemoryItem(t, '其他', true).filter((m) => m.explicit === true))
    }
    setText('')
  }

  const handleRemoveMemory = (id: string) => {
    const s = getActiveSessionId()
    if (s) {
      const list = getMemoriesCache(s)
      const item = list.find((m) => m.id === id)
      saveMemoriesCache(s, list.filter((m) => m.id !== id))
      setMemories(getMemoriesCache(s).filter((m) => m.explicit === true))
      const token = getToken()
      if (item && token && /^\d+$/.test(item.id)) {
        deleteMemory(token, item.id).then((res) => {
          if (!res.ok) {
            const cur = getMemoriesCache(s)
            if (!cur.some((m) => m.id === item.id)) {
              saveMemoriesCache(s, [item, ...cur])
              setMemories(getMemoriesCache(s).filter((m) => m.explicit === true))
            }
            setMemError('删除没成功，这条留在了本地')
          }
        })
      }
    } else {
      setMemories(removeMemoryItem(id).filter((m) => m.explicit === true))
    }
  }

  return (
    <div className="page ai-space-page-sub aboutme-page">
      <div className="ai-space-topbar ai-space-sub-bar">
        <button type="button" className="link-btn ai-space-back" onClick={onBack}>
          ‹ 返回
        </button>
        <h2 className="ai-space-sub-title">关于我</h2>
        <span className="ai-space-topbar-spacer" aria-hidden="true" />
      </div>

      <div className="aboutme-body">
        {/* 我的资料头 */}
        <div className="aboutme-head">
          {user.avatar.startsWith('data:') ? (
            <img className="aboutme-avatar-img" src={user.avatar} alt="" />
          ) : (
            <span className="aboutme-avatar">{yourName.slice(0, 1) || '我'}</span>
          )}
          <div className="aboutme-name">{yourName}</div>
          <p className="aboutme-sig">{user.bio || '我的日子、我想让 TA 记住的，都在这里'}</p>
        </div>

        {/* 我的重要日子：标题 + 右侧加号 */}
        <div className="aboutme-section-head">
          <h3 className="aboutme-section-title">我的重要日子</h3>
          <button type="button" className="aboutme-add-btn" onClick={() => setFormOpen(true)} aria-label="添加我的日子">
            <PlusIcon />
          </button>
        </div>

        {days.length === 0 ? (
          <div className="aboutme-days-empty">还没有，点右上角 + 记一个（生日、姨妈周期…）</div>
        ) : (
          <div className="aboutme-days">
            {days.map((a) => (
              <div key={a.id} className="aboutme-day-card">
                <span className={`aboutme-day-dot ann-color-${anniversaryColorIndex(a.color)}`} aria-hidden="true" />
                <div className="aboutme-day-label">{a.label}</div>
                <div className="aboutme-day-count">{formatCountdown(a)}</div>
                <div className="aboutme-day-date">{formatAnniversaryDate(a.date)}</div>
                <button
                  type="button"
                  className="aboutme-day-del"
                  onClick={() => handleRemoveDay(a.id)}
                  aria-label={`删除${a.label}`}
                >
                  <DeleteIcon />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 想让 TA 记住 */}
        <div className="aboutme-input-card">
          <p className="aboutme-input-title">想让 TA 记住你什么？</p>
          <div className="aboutme-input-row">
            <input
              className="aboutme-input"
              placeholder="比如：我最爱吃红烧肉"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddMemory()
              }}
            />
            <button type="button" className="btn btn-primary aboutme-input-btn" onClick={handleAddMemory}>
              记住
            </button>
          </div>
        </div>

        {/* 我自己说的 */}
        <div className="aboutme-section-head">
          <h3 className="aboutme-section-title">我自己说的 · {memories.length} 条</h3>
          <span className="aboutme-section-spacer" aria-hidden="true" />
        </div>

        {memError && <p className="aboutme-error">{memError}</p>}

        {memories.length === 0 ? (
          <div className="aboutme-mem-empty">还没记过。在上面说一句，TA 就会记得。</div>
        ) : (
          <div className="aboutme-mem-list">
            {memories.map((m) => (
              <div key={m.id} className="aboutme-mem-item">
                <span className="aboutme-mem-dot" aria-hidden="true" />
                <div className="aboutme-mem-main">
                  <div className="aboutme-mem-text">{stripMemoryMarkers(m.text)}</div>
                  <div className="aboutme-mem-date">
                    {new Date(m.createdAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })} · 我说的
                  </div>
                </div>
                <button
                  type="button"
                  className="aboutme-mem-del"
                  onClick={() => handleRemoveMemory(m.id)}
                  aria-label="删除这条"
                >
                  <DeleteIcon />
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="aboutme-footnote">TA 自己从聊天里记住的，在 TA 的空间 → TA所忆 里</p>
      </div>

      {/* 添加我的日子表单（弹出层） */}
      {formOpen && (
        <div className="aboutme-form-mask" onClick={closeForm}>
          <div className="aboutme-form" onClick={(e) => e.stopPropagation()}>
            <h3 className="aboutme-form-title">添加我的日子</h3>
            <input
              className="aboutme-form-input"
              placeholder="名称，比如：我的生日 / 姨妈周期"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <input
              className="aboutme-form-input"
              placeholder="日期：MM-DD（每年）或 YYYY-MM-DD"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <div className="aboutme-form-mode">
              <button
                type="button"
                className={`aboutme-mode-btn${countMode === 'forward' ? ' is-active' : ''}`}
                onClick={() => setCountMode('forward')}
              >
                正数（已经 X 天）
              </button>
              <button
                type="button"
                className={`aboutme-mode-btn${countMode === 'countdown' ? ' is-active' : ''}`}
                onClick={() => setCountMode('countdown')}
              >
                倒数（还剩 X 天）
              </button>
            </div>
            <div className="aboutme-form-colors">
              {ANNIVERSARY_COLORS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={`aboutme-color-dot ann-color-${ANNIVERSARY_COLORS.findIndex((x) => x.key === c.key)}${color === c.key ? ' is-active' : ''}`}
                  onClick={() => setColor(c.key)}
                  aria-label={c.label}
                />
              ))}
            </div>
            <div className="aboutme-form-actions">
              <button type="button" className="btn btn-ghost" onClick={closeForm}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleAddDay}
                disabled={!label.trim() || !isValidAnniversaryDate(date.trim())}
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
