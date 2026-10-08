import { useEffect, useMemo, useRef, useState } from 'react'
import { loadMemory, MEMORY_UPDATED_EVENT, type MemoryItem } from '../lib/memory'
import { getActiveSessionId, getMemoriesCache } from '../lib/sessionStore'

interface Props {
  onBack: () => void
}

type JarPhase = 'jar' | 'opening' | 'detail' | 'folding'

function fmtDate(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

function memoryPool(sessionId: string): MemoryItem[] {
  const session = sessionId ? getMemoriesCache(sessionId) : []
  const global = loadMemory().filter((item) => item.explicit === true)
  const out: MemoryItem[] = []
  const seen = new Set<string>()
  for (const item of global) {
    const key = `g:${item.id}`
    if (!item?.id || !item.text?.trim() || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  for (const item of session) {
    const key = `s:${item.id}`
    if (!item?.id || !item.text?.trim() || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

export default function StarJar({ onBack }: Props) {
  const sessionId = getActiveSessionId()
  const [version, setVersion] = useState(0)
  const memories = useMemo(() => memoryPool(sessionId), [sessionId, version])
  const numberedMemories = useMemo(
    () => [...memories]
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map((item, index) => ({ item, number: index + 1 })),
    [memories],
  )
  const [phase, setPhase] = useState<JarPhase>('jar')
  const [selected, setSelected] = useState<{ item: MemoryItem; number: number } | null>(null)
  const timers = useRef<number[]>([])
  // 一颗星只对应一条真实记忆；没有记忆时罐子必须是空的。
  const visibleStarCount = numberedMemories.length

  useEffect(() => {
    const refresh = () => setVersion((value) => value + 1)
    window.addEventListener(MEMORY_UPDATED_EVENT, refresh)
    return () => window.removeEventListener(MEMORY_UPDATED_EVENT, refresh)
  }, [])

  useEffect(() => () => {
    for (const timer of timers.current) window.clearTimeout(timer)
    timers.current = []
  }, [])

  const clearTimers = () => {
    for (const timer of timers.current) window.clearTimeout(timer)
    timers.current = []
  }

  const draw = () => {
    if (numberedMemories.length === 0 || phase !== 'jar') return
    clearTimers()
    const next = numberedMemories[Math.floor(Math.random() * numberedMemories.length)]
    setSelected(next)
    setPhase('opening')
    timers.current.push(window.setTimeout(() => setPhase('detail'), 520))
  }

  const foldBack = () => {
    if (phase !== 'detail') return
    clearTimers()
    setPhase('folding')
    timers.current.push(window.setTimeout(() => {
      setPhase('jar')
      setSelected(null)
    }, 460))
  }

  return (
    <div className="page star-jar-page">
      <header className="space-object-topbar star-jar-topbar">
        <button type="button" onClick={onBack} className="space-object-back">‹ 返回</button>
        <div>
          <strong>星星罐</strong>
          <span>REMEMBERED</span>
        </div>
        <span aria-hidden="true" />
      </header>

      <main className={`star-jar-stage is-${phase}`}>
        <button
          type="button"
          className="star-jar-vessel"
          onClick={draw}
          disabled={numberedMemories.length === 0 || phase !== 'jar'}
          aria-label={numberedMemories.length > 0 ? '随机抽一颗记忆星星' : '还没有可以抽取的记忆'}
        >
          <span className="star-jar-approved-art" aria-hidden="true">
            <img src="/space/space-desk.webp" alt="" draggable={false} />
          </span>
          <span className="star-jar-glass" aria-hidden="true">
            {Array.from({ length: visibleStarCount }, (_, index) => (
              <span
                key={numberedMemories[index]?.item.id ?? index}
                className={`star-jar-star${index < Math.min(9, visibleStarCount) ? ' is-moving' : ''}`}
                style={{
                  '--star-x': `${8 + ((index * 37) % 83)}%`,
                  '--star-y': `${12 + ((index * 53) % 76)}%`,
                  '--star-r': `${-18 + ((index * 29) % 37)}deg`,
                  '--star-d': `${(index % 7) * 0.17}s`,
                  '--star-hue': `${(index * 47) % 360}`,
                } as React.CSSProperties}
                aria-hidden="true"
              >
                <i className="fold is-a" />
                <i className="fold is-b" />
                <i className="fold is-c" />
                <i className="fold is-d" />
                <i className="fold is-e" />
              </span>
            ))}
          </span>
          <span className="star-jar-label" aria-hidden="true">被想起</span>
        </button>

        {memories.length === 0 && (
          <p className="star-jar-empty">以后被记住的事情，会慢慢变成这里的星星。</p>
        )}

        {selected && phase !== 'jar' && (
          <section className={`star-memory-paper is-${phase}`} aria-live="polite">
            <div className="star-memory-folds" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <article className="star-memory-content">
              <div className="star-memory-heading">
                <span>第 {selected.number} 颗星</span>
                {fmtDate(selected.item.createdAt) ? <time>{fmtDate(selected.item.createdAt)}</time> : null}
              </div>
              <p className="star-memory-text">{selected.item.text}</p>
              {selected.item.source?.trim() ? (
                <div className="star-memory-source">
                  <span>当时你说</span>
                  <p>「{selected.item.source.trim()}」</p>
                </div>
              ) : null}
              {selected.item.taReply?.trim() ? (
                <div className="star-memory-source">
                  <span>TA 当时回应</span>
                  <p>「{selected.item.taReply.trim()}」</p>
                </div>
              ) : null}
              {phase === 'detail' && (
                <button type="button" className="star-memory-fold-back" onClick={foldBack}>
                  折回去
                </button>
              )}
            </article>
          </section>
        )}

        {memories.length > 0 && phase === 'jar' && (
          <p className="star-jar-hint">轻点一下，随机想起一件事。</p>
        )}
      </main>
    </div>
  )
}
