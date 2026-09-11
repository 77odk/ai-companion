import { useEffect, useMemo, useState } from 'react'
import {
  ANNIVERSARY_COLORS,
  addAnniversary,
  anniversaryColorIndex,
  formatAnniversaryDate,
  formatCountdown,
  getMainAnniversaryId,
  isMilestoneAnniversary,
  isValidAnniversaryDate,
  mergeDuplicateAnniversaries,
  readRoleAnniversaries,
  removeAnniversary,
  resolveMainAnniversary,
  setMainAnniversaryId,
  updateAnniversary,
  type Anniversary,
  type CountMode,
} from '../lib/anniversary'
import { MEMORY_UPDATED_EVENT } from '../lib/memory'
import { getActiveSessionId } from '../lib/sessionStore'

interface Props { onBack: () => void }

export default function AnniversaryManager({ onBack }: Props) {
  const sessionId = getActiveSessionId() || undefined
  const readCurrent = () => mergeDuplicateAnniversaries(
    readRoleAnniversaries(sessionId).filter((item) => item.kind !== 'personal' && !isMilestoneAnniversary(item)),
  )
  const [items, setItems] = useState<Anniversary[]>(readCurrent)
  const [mainId, setMainId] = useState(() => getMainAnniversaryId(sessionId))
  const [editing, setEditing] = useState<Anniversary | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [date, setDate] = useState('')
  const [countMode, setCountMode] = useState<CountMode>('forward')
  const [color, setColor] = useState('warm-orange')
  const main = useMemo(() => resolveMainAnniversary(items, sessionId), [items, mainId, sessionId])

  useEffect(() => {
    const refresh = () => {
      setItems(readCurrent())
      setMainId(getMainAnniversaryId(sessionId))
    }
    window.addEventListener(MEMORY_UPDATED_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(MEMORY_UPDATED_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [sessionId])

  const closeForm = () => {
    setFormOpen(false)
    setEditing(null)
    setLabel('')
    setDate('')
    setCountMode('forward')
    setColor('warm-orange')
  }

  const openEdit = (item: Anniversary) => {
    setEditing(item)
    setLabel(item.label)
    setDate(item.date)
    setCountMode(item.countMode ?? 'forward')
    setColor(item.color || 'warm-orange')
    setFormOpen(true)
  }

  const save = () => {
    const nextLabel = label.trim()
    const nextDate = date.trim()
    if (!nextLabel || !isValidAnniversaryDate(nextDate)) return
    if (editing) updateAnniversary(editing.id, nextLabel, nextDate, { countMode, color }, sessionId)
    else addAnniversary(nextLabel, nextDate, { countMode, color }, sessionId)
    setItems(readCurrent())
    closeForm()
  }

  const remove = (item: Anniversary) => {
    if (!window.confirm(`删除「${item.label}」？`)) return
    removeAnniversary(item.id, sessionId)
    if (main?.id === item.id) {
      setMainAnniversaryId(null, sessionId)
      setMainId(null)
    }
    setItems(readCurrent())
  }

  const selectMain = (item: Anniversary) => {
    setMainAnniversaryId(item.id, sessionId)
    setMainId(item.id)
  }

  return (
    <div className="page settings-page anniversary-manager">
      <div className="detail-header">
        <button type="button" className="detail-back detail-back-text" onClick={onBack} aria-label="返回">
          ‹ 返回
        </button>
        <h2 className="detail-title">纪念日</h2>
        <span className="detail-spacer" aria-hidden="true" />
      </div>
      <p className="anniversary-manager-note">这里是你和当前 TA 的关系日期。</p>

      {items.length > 0 ? (
        <ul className="anniversary-page-list">
          {items.map((item) => (
            <li key={item.id} className={`anniversary-page-item${main?.id === item.id ? ' is-displayed' : ''}`}>
              <div className="anniversary-page-info">
                <span className="anniversary-page-label">
                  <span className={`anniversary-page-dot ann-color-${anniversaryColorIndex(item.color)}`} aria-hidden="true" />
                  {item.label}
                </span>
                <span className="anniversary-page-meta">{formatAnniversaryDate(item.date)} · {formatCountdown(item)}</span>
              </div>
              <div className="anniversary-manager-actions">
                <button type="button" onClick={() => selectMain(item)} disabled={main?.id === item.id}>
                  {main?.id === item.id ? '首页展示中' : '设为首页展示'}
                </button>
                <button type="button" onClick={() => openEdit(item)}>编辑</button>
                <button type="button" className="danger" onClick={() => remove(item)}>删除</button>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="anniversary-page-empty">还没有属于你们的纪念日。</p>}

      {!formOpen ? (
        <button type="button" className="anniversary-page-add" onClick={() => setFormOpen(true)}>＋ 添加纪念日</button>
      ) : (
        <form className="anniversary-form" onSubmit={(event) => { event.preventDefault(); save() }}>
          <h3 className="anniversary-form-title">{editing ? '编辑纪念日' : '添加纪念日'}</h3>
          <label className="anniversary-manager-field">名称<input className="input" value={label} onChange={(event) => setLabel(event.target.value)} /></label>
          <label className="anniversary-manager-field">日期<input className="input" value={date} onChange={(event) => setDate(event.target.value)} placeholder="08-22（每年）或 2026-08-22（一次）" /></label>
          <fieldset className="anniversary-manager-fieldset">
            <legend>计时方式</legend>
            <label><input type="radio" name="anniversary-mode" checked={countMode === 'forward'} onChange={() => setCountMode('forward')} /> 正计时</label>
            <label><input type="radio" name="anniversary-mode" checked={countMode === 'countdown'} onChange={() => setCountMode('countdown')} /> 倒计时</label>
          </fieldset>
          <fieldset className="anniversary-manager-fieldset">
            <legend>主题色</legend>
            <div className="anniversary-color-options">
              {ANNIVERSARY_COLORS.map((option) => <button key={option.key} type="button" className={`anniversary-color-swatch ann-color-${anniversaryColorIndex(option.key)}${color === option.key ? ' selected' : ''}`} onClick={() => setColor(option.key)} aria-label={`主题色 ${option.label}`} />)}
            </div>
          </fieldset>
          <div className="anniversary-form-actions">
            <button type="button" className="btn btn-ghost" onClick={closeForm}>取消</button>
            <button type="submit" className="btn btn-primary">保存</button>
          </div>
        </form>
      )}
    </div>
  )
}
