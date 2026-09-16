import { useMemo, useState } from 'react'
import {
  createEvent,
  getEvents,
  softDeleteEvent,
  updateEvent,
  type CompanionEvent,
} from '../lib/eventStore'
import '../styles/eventArchive.css'

interface Props {
  sessionId?: string
}

function fmtDate(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getMonth() + 1).padStart(2, '0')} · ${String(d.getDate()).padStart(2, '0')}`
}

function fmtDateLong(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

function bodyOf(event: CompanionEvent): string {
  return event.description?.trim() || event.title.trim()
}

function compatibilityTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return '一起经历过的一件事'
  return clean.length > 28 ? `${clean.slice(0, 28)}…` : clean
}

function firstSentence(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  const end = clean.search(/[。！？!?]/)
  const short = end >= 0 ? clean.slice(0, end + 1) : clean
  return short.length > 36 ? `${short.slice(0, 36)}…` : short
}

export default function EventArchive({ sessionId }: Props) {
  const [version, setVersion] = useState(0)
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formDate, setFormDate] = useState('')
  const [formBody, setFormBody] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const events = useMemo(() => getEvents(sessionId), [sessionId, version])
  const selected = selectedId ? events.find((event) => event.id === selectedId) ?? null : null

  const openForm = (event?: CompanionEvent) => {
    const d = event ? new Date(event.occurredAt) : new Date()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    setEditingId(event?.id ?? null)
    setFormDate(`${d.getFullYear()}-${month}-${day}`)
    setFormBody(event ? bodyOf(event) : '')
    setFormError(null)
    setFormOpen(true)
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditingId(null)
    setFormError(null)
  }

  const saveForm = () => {
    const body = formBody.trim()
    if (!body) {
      setFormError('写下那天发生了什么')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(formDate)) {
      setFormError('选一个日期')
      return
    }
    const occurredAt = new Date(`${formDate}T00:00:00`).getTime()
    if (!Number.isFinite(occurredAt) || occurredAt > Date.now()) {
      setFormError('这件事还没发生，先别放进经历里')
      return
    }

    const title = compatibilityTitle(body)
    if (editingId) {
      updateEvent(sessionId, editingId, { title, description: body, occurredAt })
    } else {
      createEvent({
        sessionId,
        type: 'activity',
        title,
        description: body,
        occurredAt,
        confidence: 1,
        source: 'manual',
      })
    }
    closeForm()
    setVersion((value) => value + 1)
  }

  const deleteEvent = (event: CompanionEvent) => {
    const label = firstSentence(bodyOf(event)) || '这条经历'
    if (!window.confirm(`删掉「${label}」吗？`)) return
    if (!softDeleteEvent(sessionId, event.id)) return
    if (selectedId === event.id) setSelectedId(null)
    setVersion((value) => value + 1)
  }

  const timeline = (compact = false) => (
    <div className={`event-archive-timeline${compact ? ' is-compact' : ''}`}>
      {events.map((event) => (
        <button
          key={event.id}
          type="button"
          className={`event-archive-item${event.type === 'milestone' ? ' is-milestone' : ''}`}
          onClick={() => {
            setSelectedId(event.id)
            setOpen(true)
          }}
        >
          <span className="event-archive-rail" aria-hidden="true">
            <span className="event-archive-dot" />
          </span>
          <span className="event-archive-content">
            <span className="event-archive-date">
              {fmtDate(event.occurredAt)}
              {event.type === 'milestone' && <em>里程碑</em>}
            </span>
            <span className="event-archive-body">{bodyOf(event)}</span>
          </span>
        </button>
      ))}
    </div>
  )

  return (
    <>
      <section className="ai-space-v2-section space-archive-section event-archive-preview">
        <div className="ai-space-v2-head">
          <span className="ai-space-v2-title">一起经历过</span>
          <span className="ai-space-v2-en">MOMENTS WE SHARED</span>
          {events.length > 0 && (
            <button type="button" className="ai-space-v2-all" onClick={() => setOpen(true)}>
              查看全部 ›
            </button>
          )}
        </div>
        {events.length === 0 ? (
          <button type="button" className="event-archive-empty" onClick={() => openForm()}>
            <span>有些日子，后来才知道很重要。</span>
            <small>＋ 记下一件事</small>
          </button>
        ) : (
          <>
            <div className="event-archive-preview-list">
              {events.slice(0, 3).map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className={`event-archive-preview-item${event.type === 'milestone' ? ' is-milestone' : ''}`}
                  onClick={() => {
                    setSelectedId(event.id)
                    setOpen(true)
                  }}
                >
                  <span className="event-archive-date">{fmtDate(event.occurredAt)}</span>
                  <span className="event-archive-body">{bodyOf(event)}</span>
                </button>
              ))}
            </div>
            <button type="button" className="event-archive-add-inline" onClick={() => openForm()}>
              ＋ 记下一件事
            </button>
          </>
        )}
      </section>

      {open && (
        <div className="event-archive-page" role="dialog" aria-label="一起经历过">
          <div className="event-archive-topbar">
            <button
              type="button"
              className="event-archive-back"
              onClick={() => {
                if (selectedId) setSelectedId(null)
                else setOpen(false)
              }}
            >
              ‹ 返回
            </button>
            <div>
              <strong>{selected ? '那一天' : '一起经历过'}</strong>
              <span>{selected ? 'A MOMENT WE KEPT' : 'MOMENTS WE SHARED'}</span>
            </div>
            <button type="button" className="event-archive-add" onClick={() => openForm()}>
              ＋ 记下
            </button>
          </div>

          {selected ? (
            <div className="event-archive-detail">
              <p className="event-archive-detail-date">{fmtDateLong(selected.occurredAt)}</p>
              {selected.type === 'milestone' && <span className="event-archive-badge">里程碑</span>}
              <p className="event-archive-detail-body">{bodyOf(selected)}</p>
              <div className="event-archive-detail-actions">
                <button type="button" onClick={() => openForm(selected)}>编辑这条</button>
                <button type="button" className="is-danger" onClick={() => deleteEvent(selected)}>删除</button>
              </div>
            </div>
          ) : (
            <div className="event-archive-scroll">
              {events.length === 0 ? (
                <button type="button" className="event-archive-empty is-page" onClick={() => openForm()}>
                  <span>有些日子，后来才知道很重要。</span>
                  <small>＋ 记下一件事</small>
                </button>
              ) : (
                timeline()
              )}
            </div>
          )}
        </div>
      )}

      {formOpen && (
        <div className="event-archive-form-backdrop" role="dialog" aria-label="记下一件事">
          <div className="event-archive-form">
            <div className="event-archive-form-head">
              <strong>{editingId ? '改一改这段经历' : '记下一件事'}</strong>
              <button type="button" onClick={closeForm}>×</button>
            </div>
            <label>
              <span>日期</span>
              <input type="date" value={formDate} onChange={(event) => setFormDate(event.target.value)} />
            </label>
            <label>
              <span>那天发生了什么？</span>
              <textarea
                value={formBody}
                onChange={(event) => setFormBody(event.target.value)}
                placeholder="不用整理得很漂亮，按你记得的样子写下来就好。"
                rows={7}
              />
            </label>
            {formError && <p className="event-archive-form-error">{formError}</p>}
            <div className="event-archive-form-actions">
              <button type="button" className="is-ghost" onClick={closeForm}>取消</button>
              <button type="button" className="is-primary" onClick={saveForm}>
                {editingId ? '保存修改' : '记下来'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
