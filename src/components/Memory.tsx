import { useMemo, useState } from 'react'
import { inferTopic, loadMemory, type MemoryItem } from '../lib/memory'
import { getActiveSessionId, getMemoriesCache } from '../lib/sessionStore'

interface MemoryProps {
  onBack: () => void
}

interface DatedMemory {
  item: MemoryItem
  timestamp: number | null
}

interface MemoryMonth {
  key: string
  label: string
  items: DatedMemory[]
}

interface MemoryYear {
  key: string
  label: string
  months: MemoryMonth[]
}

function validTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && !Number.isNaN(new Date(value).getTime())
    ? value
    : null
}

function formatDate(timestamp: number | null): string {
  if (timestamp == null) return '日期未知'
  return new Date(timestamp).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatEarliest(timestamp: number | null): string {
  if (timestamp == null) return '最早的日期还没有留下来'
  return `最早从 ${new Date(timestamp).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })} 开始`
}

function groupMemories(items: DatedMemory[]): MemoryYear[] {
  const years = new Map<string, { label: string; months: Map<string, MemoryMonth> }>()

  for (const memory of items) {
    const date = memory.timestamp == null ? null : new Date(memory.timestamp)
    const yearKey = date ? String(date.getFullYear()) : 'unknown'
    const monthKey = date ? `${yearKey}-${date.getMonth()}` : 'unknown'
    const yearLabel = date ? yearKey : '较早的记忆'
    const monthLabel = date ? `${date.getMonth() + 1}月` : '日期未知'
    let year = years.get(yearKey)
    if (!year) {
      year = { label: yearLabel, months: new Map() }
      years.set(yearKey, year)
    }
    let month = year.months.get(monthKey)
    if (!month) {
      month = { key: monthKey, label: monthLabel, items: [] }
      year.months.set(monthKey, month)
    }
    month.items.push(memory)
  }

  return [...years.entries()].map(([key, year]) => ({
    key,
    label: year.label,
    months: [...year.months.values()],
  }))
}

export default function Memory({ onBack }: MemoryProps) {
  const sessionId = getActiveSessionId()
  const memories = useMemo(() => {
    const globalExplicit = loadMemory().filter((memory) => memory.explicit === true)
    const sessionMemories = sessionId ? getMemoriesCache(sessionId) : []
    return [...globalExplicit, ...sessionMemories]
  }, [sessionId])

  const chronological = useMemo<DatedMemory[]>(() => {
    return memories
      .map((item) => ({ item, timestamp: validTimestamp(item.createdAt) }))
      .sort((a, b) => {
        if (a.timestamp == null && b.timestamp == null) return 0
        if (a.timestamp == null) return -1
        if (b.timestamp == null) return 1
        return a.timestamp - b.timestamp
      })
  }, [memories])

  const riverItems = useMemo(() => [...chronological].reverse(), [chronological])
  const years = useMemo(() => groupMemories(riverItems), [riverItems])
  const earliest = chronological.find((memory) => memory.timestamp != null)?.timestamp ?? null
  const [view, setView] = useState<'river' | 'detail' | 'book'>('river')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selected = chronological[selectedIndex] ?? null

  const openDetail = (item: MemoryItem) => {
    const index = chronological.findIndex((memory) => memory.item === item)
    setSelectedIndex(index >= 0 ? index : 0)
    setView('detail')
  }

  if (view === 'book' && selected) {
    return (
      <div className="page memory-page memory-book-page">
        <div className="memory-local-bar">
          <button type="button" className="memory-back" onClick={() => setView('detail')}>
            ‹ 返回详情
          </button>
          <span className="memory-local-kicker">记忆书</span>
        </div>
        <article className="memory-book" aria-live="polite">
          <div className="memory-book-rule" aria-hidden="true" />
          <p className="memory-book-date">{formatDate(selected.timestamp)}</p>
          <p className="memory-book-text">{selected.item.text}</p>
          <footer className="memory-book-footer">
            <button
              type="button"
              className="memory-book-turn"
              onClick={() => setSelectedIndex((index) => Math.max(0, index - 1))}
              disabled={selectedIndex === 0}
              aria-label="上一条记忆"
            >
              ‹
            </button>
            <span>{selectedIndex + 1} / {chronological.length}</span>
            <button
              type="button"
              className="memory-book-turn"
              onClick={() => setSelectedIndex((index) => Math.min(chronological.length - 1, index + 1))}
              disabled={selectedIndex === chronological.length - 1}
              aria-label="下一条记忆"
            >
              ›
            </button>
          </footer>
        </article>
      </div>
    )
  }

  if (view === 'detail' && selected) {
    const topic = selected.item.topic?.trim() || inferTopic(selected.item.text)
    return (
      <div className="page memory-page memory-detail-page">
        <div className="memory-local-bar">
          <button type="button" className="memory-back" onClick={() => setView('river')}>
            ‹ 返回长河
          </button>
          <span className="memory-local-kicker">一段记忆</span>
        </div>
        <article className={`memory-detail-sheet${selected.item.pinned ? ' is-pinned' : ''}`}>
          <p className="memory-detail-date">{formatDate(selected.timestamp)}</p>
          <p className="memory-detail-text">{selected.item.text}</p>
          {topic && <span className="memory-topic">{topic}</span>}
          <p className="memory-detail-note">这是 TA 在与你相处时留下的一段记忆。</p>
        </article>
        <button type="button" className="memory-read-button" onClick={() => setView('book')}>
          以记忆书阅读
          <span aria-hidden="true">›</span>
        </button>
      </div>
    )
  }

  return (
    <div className="page memory-page">
      <button type="button" className="memory-back memory-page-back" onClick={onBack}>
        ‹ 返回我的
      </button>

      <header className="memory-hero">
        <span className="memory-hero-kicker">MEMORY</span>
        <h2 className="memory-page-title">TA 记得的你</h2>
        <p className="memory-hero-copy">这些，是 TA 一点一点记住的你。</p>
        {memories.length > 0 && (
          <p className="memory-hero-meta">
            共 {memories.length} 条记忆 <span aria-hidden="true">·</span> {formatEarliest(earliest)}
          </p>
        )}
      </header>

      {memories.length === 0 ? (
        <div className="memory-empty">
          <span className="memory-empty-line" aria-hidden="true" />
          <h3 className="memory-empty-title">TA 还在慢慢认识你。</h3>
          <p className="memory-empty-copy">以后被记住的那些小事，会慢慢留在这里。</p>
        </div>
      ) : (
        <section className="memory-river" aria-label="记忆长河">
          <div className="memory-river-heading">
            <div>
              <span className="memory-river-en">THE RIVER OF TIME</span>
              <h3>记忆长河</h3>
            </div>
            <span className="memory-river-whisper">还在继续向前</span>
          </div>

          <div className="memory-river-flow">
            {years.map((year) => (
              <section key={year.key} className="memory-year" aria-labelledby={`memory-year-${year.key}`}>
                <h4 id={`memory-year-${year.key}`} className="memory-year-label">{year.label}</h4>
                {year.months.map((month) => (
                  <div key={month.key} className="memory-month">
                    <h5 className="memory-month-label">{month.label}</h5>
                    <div className="memory-month-items">
                      {month.items.map(({ item, timestamp }, index) => {
                        const topic = item.topic?.trim()
                        return (
                          <button
                            key={`${item.id}-${index}`}
                            type="button"
                            className={`memory-river-node${item.pinned ? ' is-pinned' : ''}`}
                            onClick={() => openDetail(item)}
                          >
                            <span className="memory-river-dot" aria-hidden="true" />
                            <span className="memory-river-paper">
                              <span className="memory-river-text">{item.text}</span>
                              <span className="memory-river-meta">
                                {formatDate(timestamp)}
                                {topic ? <span className="memory-topic">{topic}</span> : null}
                              </span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </div>
          <p className="memory-river-end">这是 TA 目前记得的最早一件事。</p>
        </section>
      )}
    </div>
  )
}
