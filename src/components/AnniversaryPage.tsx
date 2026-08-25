import { useEffect, useState } from 'react'
import {
  ANNIVERSARY_COLORS,
  addAnniversary,
  anniversaryColorIndex,
  formatAnniversaryDate,
  getMainAnniversaryId,
  isValidAnniversaryDate,
  loadAnniversaries,
  removeAnniversary,
  resolveMainAnniversary,
  setMainAnniversaryId,
  updateAnniversary,
  type Anniversary,
  type CountMode,
} from '../lib/anniversary'
import { MEMORY_UPDATED_EVENT } from '../lib/memory'

/* ---- 线条图标（去 emoji，跟全站同一种描边风格） ---- */

const PlusIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
)

const EditIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
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

interface Props {
  /** 返回记忆页 */
  onBack: () => void
}

/** 纪念日管理页：主展示切换 + 添加/编辑/删除各种纪念日、生日 */
export default function AnniversaryPage({ onBack }: Props) {
  const [anniversaries, setAnniversaries] = useState<Anniversary[]>(() => loadAnniversaries())

  // 添加 / 编辑表单
  const [formMode, setFormMode] = useState<'idle' | 'add' | 'edit'>('idle')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [date, setDate] = useState('')
  const [countMode, setCountMode] = useState<CountMode>('forward')
  const [color, setColor] = useState('warm-orange')
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)

  // 当前主展示：有主展示 id 用主展示，否则默认取列表第一条（跟记忆页小卡片一致）。
  // 每次渲染直接算：setMainAnniversaryId 广播后触发下面的事件刷新，重渲染即拿到最新主展示。
  const mainDisplay = resolveMainAnniversary(anniversaries)

  // 数据变更自动刷新：记忆页/别处改了纪念日，进来立刻同步
  useEffect(() => {
    const refresh = () => {
      setAnniversaries(loadAnniversaries())
    }
    window.addEventListener(MEMORY_UPDATED_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(MEMORY_UPDATED_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  const resetForm = () => {
    setFormMode('idle')
    setEditingId(null)
    setLabel('')
    setDate('')
    setCountMode('forward')
    setColor('warm-orange')
    setConfirmingDelete(null)
  }

  const handleSetMain = (id: string) => {
    if (mainDisplay?.id === id) return // 已经是主展示，不用重复设
    setMainAnniversaryId(id)
  }

  const startAdd = () => {
    resetForm()
    setFormMode('add')
  }

  const startEdit = (a: Anniversary) => {
    resetForm()
    setEditingId(a.id)
    setLabel(a.label)
    setDate(a.date)
    setCountMode(a.countMode ?? 'forward')
    setColor(a.color || 'warm-orange')
    setFormMode('edit')
  }

  const handleSubmit = () => {
    const l = label.trim()
    const d = date.trim()
    if (!l || !isValidAnniversaryDate(d)) return
    if (formMode === 'edit' && editingId != null) {
      setAnniversaries(updateAnniversary(editingId, l, d, { countMode, color }))
    } else {
      const next = addAnniversary(l, d, { countMode, color })
      setAnniversaries(next)
      // 第一个纪念日：没设过主展示就自动设成主展示，小卡片直接能看到
      if (getMainAnniversaryId() == null && next.length === 1) {
        setMainAnniversaryId(next[0].id)
      }
    }
    resetForm()
  }

  const handleDelete = (id: string) => {
    const wasMain = mainDisplay?.id === id
    setAnniversaries(removeAnniversary(id))
    if (wasMain) {
      // 删的是主展示 → 清掉主展示 id，回落到默认取列表第一条
      setMainAnniversaryId(null)
    }
    setConfirmingDelete(null)
  }

  return (
    <div className="page ai-space-page-sub anniversary-page">
      <div className="ai-space-topbar ai-space-sub-bar">
        <button type="button" className="link-btn ai-space-back" onClick={onBack}>
          ‹ 返回
        </button>
        <h2 className="ai-space-sub-title">相逢纪</h2>
        <span className="ai-space-topbar-spacer" aria-hidden="true" />
      </div>

      <div className="anniversary-page-body">
        {/* 主展示切换区：决定记忆页小卡片上显示哪个日子 */}
        {anniversaries.length > 0 && (
          <section className="anniversary-main-section">
            <div className="anniversary-section-head">
              <h3 className="anniversary-section-title">主展示</h3>
              <p className="anniversary-section-desc">忆览页小卡片上显示的日子</p>
            </div>
            <ul className="anniversary-main-list">
              {anniversaries.map((a) => {
                const isMain = mainDisplay?.id === a.id
                return (
                  <li key={a.id} className={`anniversary-main-item${isMain ? ' is-main' : ''}`}>
                    <span
                      className={`anniversary-main-dot ann-color-${anniversaryColorIndex(a.color)}`}
                      aria-hidden="true"
                    />
                    <span className="anniversary-main-name">{a.label}</span>
                    <span className="anniversary-main-date">{formatAnniversaryDate(a.date)}</span>
                    <button
                      type="button"
                      className="anniversary-main-btn"
                      onClick={() => handleSetMain(a.id)}
                      disabled={isMain}
                    >
                      {isMain ? '主展示' : '设为主展示'}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {/* 纪念日列表：名称 + 日期 + 计时模式 + 编辑/删除 */}
        <section className="anniversary-list-section">
          <div className="anniversary-section-head">
            <h3 className="anniversary-section-title">全部纪念日</h3>
          </div>
          {anniversaries.length === 0 ? (
            <div className="anniversary-page-empty">还没有纪念日，添加第一个吧</div>
          ) : (
            <ul className="anniversary-page-list">
              {anniversaries.map((a) => (
                <li key={a.id} className="anniversary-page-item">
                  <div className="anniversary-page-info">
                    <span className="anniversary-page-label">
                      <span
                        className={`anniversary-page-dot ann-color-${anniversaryColorIndex(a.color)}`}
                        aria-hidden="true"
                      />
                      {a.label}
                    </span>
                    <span className="anniversary-page-meta">
                      <span className="anniversary-page-date">{formatAnniversaryDate(a.date)}</span>
                      <span className={`anniversary-mode-tag${a.countMode === 'countdown' ? ' is-countdown' : ''}`}>
                        {a.countMode === 'countdown' ? '倒计时' : '正计时'}
                      </span>
                    </span>
                  </div>
                  <div className="anniversary-page-actions">
                    <button
                      type="button"
                      className="anniversary-page-btn"
                      onClick={() => startEdit(a)}
                      aria-label={`编辑「${a.label}」`}
                    >
                      <EditIcon />
                    </button>
                    {confirmingDelete === a.id ? (
                      <span className="anniversary-confirm">
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => handleDelete(a.id)}>
                          删除
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setConfirmingDelete(null)}
                        >
                          取消
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="anniversary-page-btn danger"
                        onClick={() => setConfirmingDelete(a.id)}
                        aria-label={`删除「${a.label}」`}
                      >
                        <DeleteIcon />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 添加按钮 */}
        {formMode === 'idle' && (
          <button type="button" className="anniversary-page-add" onClick={startAdd}>
            <PlusIcon />
            添加纪念日
          </button>
        )}

        {/* 添加 / 编辑表单 */}
        {(formMode === 'add' || formMode === 'edit') && (
          <form
            className="anniversary-form"
            onSubmit={(e) => {
              e.preventDefault()
              handleSubmit()
            }}
          >
            <h3 className="anniversary-form-title">{formMode === 'edit' ? '编辑纪念日' : '添加纪念日'}</h3>
            <input
              className="input"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="名称，如 在一起纪念日"
              autoFocus
            />
            <input
              className="input"
              type="text"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              placeholder="日期：08-22（每年）或 2026-08-22（一次）"
            />
            <div className="anniversary-form-mode">
              <span className="anniversary-form-label">计时</span>
              <div className="anniversary-mode-options">
                <label className={`anniversary-mode-option${countMode === 'forward' ? ' active' : ''}`}>
                  <input
                    type="radio"
                    name="ann-count-mode"
                    checked={countMode === 'forward'}
                    onChange={() => setCountMode('forward')}
                  />
                  正计时（已经 X 天）
                </label>
                <label className={`anniversary-mode-option${countMode === 'countdown' ? ' active' : ''}`}>
                  <input
                    type="radio"
                    name="ann-count-mode"
                    checked={countMode === 'countdown'}
                    onChange={() => setCountMode('countdown')}
                  />
                  倒计时（还剩 X 天）
                </label>
              </div>
            </div>
            <div className="anniversary-form-color">
              <span className="anniversary-form-label">主题色</span>
              <div className="anniversary-color-options">
                {ANNIVERSARY_COLORS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={`anniversary-color-swatch ann-color-${anniversaryColorIndex(c.key)}${
                      color === c.key ? ' selected' : ''
                    }`}
                    onClick={() => setColor(c.key)}
                    aria-label={`主题色 ${c.label}`}
                    title={c.label}
                  />
                ))}
              </div>
            </div>
            <div className="anniversary-form-actions">
              <button type="submit" className="btn btn-primary btn-sm">
                保存
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={resetForm}>
                取消
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
