import { useMemo, useState } from 'react'
import { loadMemory, type MemoryItem } from '../lib/memory'
import { getActiveSessionId, getMemoriesCache } from '../lib/sessionStore'

// UI2-03 · Memory —— 「时间是目录，记忆是正文。」
// 纯展示层改版：数据源 / 排序 / 分组 / 隔离 / 角色边界一律不动。
// 数据：global explicit memories + active session memories，按 createdAt 排序（原逻辑）。

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

const MONTHS_EN = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
]
const MONTHS_ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']

function validTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && !Number.isNaN(new Date(value).getTime())
    ? value
    : null
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

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 短日期：9月13日（river entry 用；年份由章节承载） */
function shortDate(timestamp: number | null): string {
  if (timestamp == null) return '日期未知'
  const d = new Date(timestamp)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function monthKeyOf(timestamp: number | null): string {
  if (timestamp == null) return 'unknown'
  const d = new Date(timestamp)
  return `${d.getFullYear()}-${d.getMonth()}`
}

/** 年份导航点击：滚动到对应年份章节（不筛选、不跳转） */
function scrollToYear(yearKey: string): void {
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  document.getElementById(`memory-year-${yearKey}`)?.scrollIntoView({
    behavior: reduce ? 'auto' : 'smooth',
    block: 'start',
  })
}

export default function Memory() {
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
  const [bookStage, setBookStage] = useState<'cover' | 'body'>('cover')
  const [bookFrom, setBookFrom] = useState<'cover' | 'detail'>('cover')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selected = chronological[selectedIndex] ?? null

  const openDetail = (item: MemoryItem) => {
    const index = chronological.findIndex((memory) => memory.item === item)
    setSelectedIndex(index >= 0 ? index : 0)
    setView('detail')
  }

  const openBookCover = () => {
    setBookStage('cover')
    setBookFrom('cover')
    setView('book')
  }

  const openBookHere = () => {
    setBookStage('body')
    setBookFrom('detail')
    setView('book')
  }

  // cover 年份范围：由真实 createdAt 派生；单年只显示单年；无法可靠确定 → 不显示
  const yearRange = (() => {
    const dates = chronological.filter((m) => m.timestamp != null).map((m) => new Date(m.timestamp as number))
    if (dates.length === 0) return null
    const ys = dates.map((d) => d.getFullYear())
    const min = Math.min(...ys)
    const max = Math.max(...ys)
    return min === max ? `${min}` : `${min} — ${max}`
  })()

  // hero meta：37 段记忆，从 2025 年 11 月开始。
  const heroMeta = useMemo(() => {
    if (memories.length === 0) return null
    const base = `${memories.length} 段记忆`
    if (earliest == null) return `${base}。`
    const d = new Date(earliest)
    return `${base}，从 ${d.getFullYear()} 年 ${d.getMonth() + 1} 月开始。`
  }, [memories, earliest])

  // ---- Book Body ----
  if (view === 'book') {
    if (bookStage === 'cover') {
      return (
        <div className="memory-book-overlay" role="dialog" aria-modal="true" aria-label="记忆书">
          <div className="memory-book-cover-art" aria-hidden="true" />
          <div className="memory-book-cover-veil" aria-hidden="true" />
          <div className="memory-book-cover-content">
            <p className="memory-book-cover-en">E L U V I N</p>
            <h2 className="memory-book-cover-title">TA 记得的你</h2>
            <p className="memory-book-cover-name">MEMORY BOOK</p>
            {yearRange ? <p className="memory-book-cover-years">{yearRange}</p> : null}
            <p className="memory-book-cover-line">那些被记住的小事，</p>
            <p className="memory-book-cover-line">后来都有了自己的位置。</p>
            <button type="button" className="memory-book-open" onClick={() => { setSelectedIndex(0); setBookStage('body') }}>
              开始翻阅
              <span aria-hidden="true">→</span>
            </button>
            <button type="button" className="memory-book-close" onClick={() => setView('river')}>
              ‹ 返回长河
            </button>
          </div>
        </div>
      )
    }

    const d = selected?.timestamp == null ? null : new Date(selected.timestamp)
    const prevTs = selectedIndex > 0 ? chronological[selectedIndex - 1].timestamp : null
    const curTs = selected?.timestamp ?? null
    const showYearChapter =
      selectedIndex === 0
        ? d != null
        : curTs != null && (prevTs == null || new Date(prevTs).getFullYear() !== new Date(curTs).getFullYear())
    const showMonthChapter =
      !showYearChapter && d != null && prevTs != null && monthKeyOf(prevTs) !== monthKeyOf(curTs)

    const chapterYear = d?.getFullYear() ?? null
    const chapterMonth = d?.getMonth() ?? null

    return (
      <div className="memory-book-overlay" role="dialog" aria-modal="true" aria-label="记忆书正文">
        <div className="memory-book-body-page">
          {showYearChapter ? (
            <div className="memory-book-chapter memory-book-chapter-year" aria-hidden="true">
              <span className="memory-book-chapter-num">{chapterYear}</span>
              <span className="memory-book-chapter-zh">我们的记忆从这里</span>
              <span className="memory-book-chapter-zh">慢慢留下来</span>
            </div>
          ) : showMonthChapter && chapterMonth != null ? (
            <div className="memory-book-chapter memory-book-chapter-month" aria-hidden="true">
              <span className="memory-book-chapter-roman">{MONTHS_ROMAN[chapterMonth]}</span>
              <span className="memory-book-chapter-zh">{chapterMonth + 1} 月</span>
              <span className="memory-book-chapter-note">一段被记住的时间</span>
            </div>
          ) : null}

          <div className="memory-book-sheet" key={selectedIndex}>
            <div className="memory-book-head">
              <span className="memory-book-day">{d ? pad2(d.getDate()) : '··'}</span>
              <span className="memory-book-year">{d ? d.getFullYear() : ''}</span>
            </div>
            {d ? (
              <p className="memory-book-month">{MONTHS_EN[d.getMonth()]}</p>
            ) : null}
            <h3 className="memory-book-title">{d ? d.getDate() : '日期未知'}</h3>
            <p className="memory-book-text">{selected?.item.text}</p>
            {selected?.item.source?.trim() ? (
              <>
                <span className="memory-book-sep" aria-hidden="true">·</span>
                <p className="memory-book-quote">「{selected.item.source.trim()}」</p>
              </>
            ) : null}
          </div>

          <div className="memory-book-foot">
            <button
              type="button"
              className="memory-book-turn"
              onClick={() => setSelectedIndex((index) => Math.max(0, index - 1))}
              disabled={selectedIndex === 0}
              aria-label="上一条记忆"
            >
              ‹
            </button>
            <span className="memory-book-count">
              {selectedIndex + 1} / {chronological.length}
            </span>
            <button
              type="button"
              className="memory-book-turn"
              onClick={() => setSelectedIndex((index) => Math.min(chronological.length - 1, index + 1))}
              disabled={selectedIndex === chronological.length - 1}
              aria-label="下一条记忆"
            >
              ›
            </button>
          </div>

          <button
            type="button"
            className="memory-book-exit"
            onClick={() => (bookFrom === 'detail' ? setView('detail') : setBookStage('cover'))}
          >
            {bookFrom === 'detail' ? '‹ 返回详情' : '‹ 返回封面'}
          </button>
        </div>
      </div>
    )
  }

  // ---- Detail ----
  if (view === 'detail' && selected) {
    const pinned = selected.item.pinned === true
    const d = selected.timestamp == null ? null : new Date(selected.timestamp)
    return (
      <div className="page memory-page memory-detail-page">
        <div className="memory-local-bar">
          <button type="button" className="memory-back" onClick={() => setView('river')}>
            ‹ 记忆长河
          </button>
          <span className="memory-local-kicker">一段记忆</span>
        </div>
        <article className="memory-detail-layout">
          {d ? (
            <>
              <p className="memory-detail-year">{d.getFullYear()}</p>
              <p className="memory-detail-date">
                {pad2(d.getMonth() + 1)} <span aria-hidden="true">·</span> {pad2(d.getDate())}
              </p>
            </>
          ) : (
            <p className="memory-detail-date">日期未知</p>
          )}
          <p className="memory-detail-text">{selected.item.text}</p>
          <span className="memory-detail-rule" aria-hidden="true" />
          {selected.item.source?.trim() ? (
            <div className="memory-detail-source">
              <p className="memory-detail-source-label">当时你说</p>
              <p className="memory-detail-source-text">「{selected.item.source.trim()}」</p>
            </div>
          ) : null}
          {pinned ? (
            <p className="memory-detail-pin">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z" />
                <path d="M12 14v7" />
              </svg>
              TA 收下的
            </p>
          ) : null}
        </article>
        <button type="button" className="memory-book-entry" onClick={openBookHere}>
          在记忆书里读这一页
          <span aria-hidden="true">→</span>
        </button>
      </div>
    )
  }

  // ---- River ----
  return (
    <div className="page memory-page">
      <header className="memory-hero">
        <span className="memory-hero-kicker">MEMORY</span>
        <h2 className="memory-page-title">TA 记得的你</h2>
        {heroMeta ? <p className="memory-hero-meta">{heroMeta}</p> : null}
        <div className="memory-hero-entries" role="group" aria-label="记忆入口">
          <span className="memory-hero-entry is-current">
            <span className="memory-hero-entry-dot" aria-hidden="true" />
            记忆长河
          </span>
          <button type="button" className="memory-hero-entry" onClick={openBookCover}>
            翻开记忆书
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </header>

      {memories.length === 0 ? (
        <div className="memory-empty">
          <span className="memory-empty-trace" aria-hidden="true">
            <span className="memory-empty-node" />
            <span className="memory-empty-line" />
            <span className="memory-empty-node" />
          </span>
          <h3 className="memory-empty-title">TA 还在慢慢认识你。</h3>
          <p className="memory-empty-copy">以后被记住的那些小事，会慢慢留在这里。</p>
        </div>
      ) : (
        <section className="memory-river" aria-label="记忆长河">
          {years.length >= 2 ? (
            <nav className="memory-year-nav" aria-label="年份导航">
              {years
                .filter((year) => year.key !== 'unknown')
                .map((year) => (
                  <button
                    key={year.key}
                    type="button"
                    className={`memory-year-nav-btn${year === years[0] ? ' is-current' : ''}`}
                    onClick={() => scrollToYear(year.key)}
                  >
                    {year.label}
                  </button>
                ))}
            </nav>
          ) : null}

          <div className="memory-river-flow">
            {years.map((year) => (
              <section key={year.key} className="memory-year-chapter" aria-labelledby={`memory-year-${year.key}`}>
                <h4 id={`memory-year-${year.key}`} className="memory-year-chapter-label">
                  <span className="memory-year-chapter-num">{year.label}</span>
                </h4>
                {year.months.map((month) => (
                  <div key={month.key} className="memory-month-chapter">
                    <h5 className="memory-month-chapter-label">
                      <span className="memory-month-name">{month.label}</span>
                      <span className="memory-month-count">{month.items.length} 段记忆</span>
                    </h5>
                    <div className="memory-month-entries">
                      {month.items.map(({ item, timestamp }, index) => {
                        const explicit = item.explicit === true
                        const pinned = item.pinned === true
                        const entryClass = [
                          'memory-entry',
                          pinned ? 'is-pinned' : '',
                          explicit ? 'is-explicit' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')
                        return (
                          <button
                            key={`${item.id}-${index}`}
                            type="button"
                            className={entryClass}
                            onClick={() => openDetail(item)}
                          >
                            <span className="memory-entry-dot" aria-hidden="true">
                              {pinned ? (
                                <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true">
                                  <path d="M12 0l2.6 7.4L22 10l-7.4 2.6L12 20l-2.6-7.4L2 10l7.4-2.6Z" />
                                </svg>
                              ) : null}
                            </span>
                            <span className="memory-entry-body">
                              <span className="memory-entry-text">{item.text}</span>
                              <span className="memory-entry-date">{shortDate(timestamp)}</span>
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
          <div className="memory-river-end" aria-hidden="true">
            <span className="memory-river-end-dot" />
          </div>
        </section>
      )}
    </div>
  )
}
