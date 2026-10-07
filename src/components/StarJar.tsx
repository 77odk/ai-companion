import { useEffect, useMemo, useRef, useState } from 'react'
import { ELUVIN_DATA_CHANGE } from '../lib/dataChange'
import { loadMemory, MEMORY_UPDATED_EVENT, type MemoryItem } from '../lib/memory'
import {
  backfillMemoryPapers,
  canGenerateMemoryPaper,
  getMemoryPaper,
  getMemoryPaperForItem,
  type MemoryPaperKind,
  type MemoryPaperTarget,
} from '../lib/memoryPaper'
import { getActiveSessionId, getMemoriesCache } from '../lib/sessionStore'

interface Props {
  onBack: () => void
}

type JarPhase = 'jar' | 'opening' | 'paper' | 'detail' | 'folding'

interface JarMemory extends MemoryPaperTarget {
  item: MemoryItem
  kind: MemoryPaperKind
}

function fmtDate(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

function memoryPool(sessionId: string): JarMemory[] {
  const session = sessionId ? getMemoriesCache(sessionId) : []
  const global = loadMemory().filter((item) => item.explicit === true)
  const out: JarMemory[] = []
  const seen = new Set<string>()
  for (const item of global) {
    const key = `g:${item.id}`
    if (!item?.id || !item.text?.trim() || seen.has(key)) continue
    seen.add(key)
    out.push({ item, kind: 'global' })
  }
  for (const item of session) {
    const key = `s:${item.id}`
    if (!item?.id || !item.text?.trim() || seen.has(key)) continue
    seen.add(key)
    out.push({ item, kind: 'session' })
  }
  return out.sort((a, b) => b.item.createdAt - a.item.createdAt)
}

export default function StarJar({ onBack }: Props) {
  const sessionId = getActiveSessionId()
  const [version, setVersion] = useState(0)
  const memories = useMemo(() => memoryPool(sessionId), [sessionId, version])
  const numberedMemories = useMemo(
    () => [...memories]
      .sort((a, b) => a.item.createdAt - b.item.createdAt || a.item.id.localeCompare(b.item.id))
      .map((target, index) => ({ ...target, number: index + 1 })),
    [memories],
  )
  const missingPaperCount = useMemo(
    () => sessionId
      ? numberedMemories.filter((target) => !getMemoryPaperForItem(sessionId, target.kind, target.item)).length
      : 0,
    [numberedMemories, sessionId, version],
  )
  const [phase, setPhase] = useState<JarPhase>('jar')
  const [selected, setSelected] = useState<(JarMemory & { number: number }) | null>(null)
  const [backfillBusy, setBackfillBusy] = useState(false)
  const [backfillProgress, setBackfillProgress] = useState<{ done: number; total: number } | null>(null)
  const [backfillNotice, setBackfillNotice] = useState('')
  const timers = useRef<number[]>([])

  // 视觉上维持 30–45 颗的丰满度；真实记忆仍是一条对应一个编号星星。
  // 记忆少于 30 时其余只是无语义填充光点，绝不参与抽取。
  const visibleStarCount = Math.max(30, Math.min(45, numberedMemories.length))
  const selectedRecord = selected && sessionId
    ? getMemoryPaper(sessionId, selected.kind, selected.item.id)
    : null
  const selectedPaper = selected && sessionId
    ? getMemoryPaperForItem(sessionId, selected.kind, selected.item)
    : null
  const selectedMood = selectedRecord?.sourceText.trim() === selected?.item.text.trim()
    ? selectedRecord.mood
    : undefined

  useEffect(() => {
    const refresh = () => setVersion((value) => value + 1)
    window.addEventListener(MEMORY_UPDATED_EVENT, refresh)
    window.addEventListener(ELUVIN_DATA_CHANGE, refresh)
    return () => {
      window.removeEventListener(MEMORY_UPDATED_EVENT, refresh)
      window.removeEventListener(ELUVIN_DATA_CHANGE, refresh)
    }
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
    timers.current.push(window.setTimeout(() => setPhase('paper'), 520))
  }

  const foldBack = () => {
    if (phase !== 'paper' && phase !== 'detail') return
    clearTimers()
    setPhase('folding')
    timers.current.push(window.setTimeout(() => {
      setPhase('jar')
      setSelected(null)
    }, 460))
  }

  const backfill = async () => {
    if (!sessionId || backfillBusy || missingPaperCount === 0) return
    if (!canGenerateMemoryPaper()) {
      setBackfillNotice('先在「我的」里配置好模型，才能用你的 Key 补写旧记忆纸条。')
      return
    }
    setBackfillBusy(true)
    setBackfillNotice('')
    setBackfillProgress({ done: 0, total: missingPaperCount })
    try {
      const result = await backfillMemoryPapers(
        sessionId,
        numberedMemories.map(({ kind, item }) => ({ kind, item })),
        (done, total) => setBackfillProgress({ done, total }),
      )
      setBackfillNotice(
        result.failed > 0
          ? `补好了 ${result.generated} 条，另有 ${result.failed} 条暂时没生成成功，可以稍后再补。`
          : `旧记忆纸条补好了，共 ${result.generated} 条。`,
      )
      setVersion((value) => value + 1)
    } finally {
      setBackfillBusy(false)
    }
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
          disabled={numberedMemories.length === 0 || phase !== 'jar' || backfillBusy}
          aria-label={numberedMemories.length > 0 ? '随机抽一颗记忆星星' : '还没有可以抽取的记忆'}
        >
          <span className="star-jar-lid" aria-hidden="true" />
          <span className="star-jar-glass" aria-hidden="true">
            {Array.from({ length: visibleStarCount }, (_, index) => (
              <span
                key={index}
                className={[
                  'star-jar-star',
                  index < 6 ? 'is-moving' : '',
                  index >= numberedMemories.length ? 'is-filler' : '',
                ].filter(Boolean).join(' ')}
                style={{
                  '--star-x': `${8 + ((index * 37) % 83)}%`,
                  '--star-y': `${12 + ((index * 53) % 76)}%`,
                  '--star-r': `${-18 + ((index * 29) % 37)}deg`,
                  '--star-d': `${(index % 7) * 0.17}s`,
                } as React.CSSProperties}
              >
                ★
              </span>
            ))}
          </span>
          <span className="star-jar-label" aria-hidden="true">被想起</span>
        </button>

        {memories.length === 0 && (
          <p className="star-jar-empty">以后被记住的事情，会慢慢变成这里的星星。</p>
        )}

        {phase === 'jar' && missingPaperCount > 0 && (
          <aside className="star-paper-backfill" role="status">
            <p>
              有 {missingPaperCount} 条旧记忆还没有“造句版”纸条。补齐会调用你自己的模型 Key，
              每条只生成一次；旧记忆没有当时心情，所以心情会保持空白，绝不补编。
            </p>
            <button type="button" onClick={() => void backfill()} disabled={backfillBusy}>
              {backfillBusy && backfillProgress
                ? `正在补 ${backfillProgress.done}/${backfillProgress.total}`
                : '补齐旧记忆纸条'}
            </button>
            {backfillNotice ? <span>{backfillNotice}</span> : null}
          </aside>
        )}

        {selected && phase !== 'jar' && (
          <section
            className={`star-memory-paper is-${phase}`}
            aria-live="polite"
            onClick={() => {
              if (phase === 'paper') setPhase('detail')
            }}
          >
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
              <p className="star-memory-text">
                {selectedPaper?.sentence ?? selected.item.text}
              </p>
              {selectedMood ? (
                <p className="star-memory-mood">
                  那时我的心情 · <strong>{selectedMood.mood}</strong>
                </p>
              ) : null}
              {!selectedPaper ? (
                <p className="star-memory-paper-missing">
                  {selectedMood
                    ? '这条记忆的当时心情已经保存，纸条正文还没有生成成功，可以稍后补写。'
                    : '这是一条旧记忆，还没有补写成纸条；没有当时心情的数据。'}
                </p>
              ) : null}

              {phase === 'paper' && (
                <p className="star-memory-detail-hint">再点一下纸条，看看当时留下的细节</p>
              )}

              {phase === 'detail' && (
                <div className="star-memory-detail-bubble" onClick={(event) => event.stopPropagation()}>
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
                  {!selected.item.source?.trim() && !selected.item.taReply?.trim() ? (
                    <p className="star-memory-no-detail">这条记忆当时没有留下可追溯的原话或回应。</p>
                  ) : null}
                </div>
              )}

              {(phase === 'paper' || phase === 'detail') && (
                <button
                  type="button"
                  className="star-memory-fold-back"
                  onClick={(event) => {
                    event.stopPropagation()
                    foldBack()
                  }}
                >
                  折回去
                </button>
              )}
            </article>
          </section>
        )}

        {memories.length > 0 && phase === 'jar' && !backfillBusy && (
          <p className="star-jar-hint">轻点一下，随机想起一件事。</p>
        )}
      </main>
    </div>
  )
}
