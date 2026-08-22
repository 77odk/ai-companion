import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addMemoryItem,
  inferTopic,
  loadMemory,
  removeMemoryItem,
  MEMORY_UPDATED_EVENT,
  type MemoryItem,
} from '../lib/memory'
import {
  buildKnownSince,
  buildSummaryMessages,
  buildTopTopicLine,
  cleanSummaryText,
  formatFirstRememberedDate,
  summarizeStats,
} from '../lib/memorySummary'
import { chatCompletion } from '../lib/api'
import { loadAIProfile, loadPersona, loadSettings, loadUserProfile } from '../lib/storage'

/** 主题色块：一组柔和配色，按主题名稳定取一个 */
const TOPIC_SOFT = [
  'topic-soft-0',
  'topic-soft-1',
  'topic-soft-2',
  'topic-soft-3',
  'topic-soft-4',
  'topic-soft-5',
]

function topicColorClass(topic: string): string {
  let h = 0
  for (const ch of topic) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TOPIC_SOFT[h % TOPIC_SOFT.length]
}

interface TopicGroup {
  topic: string
  items: MemoryItem[]
}

/** 条目上的轻量删除图标：细描边暖灰，hover 才明显 */
function DeleteIcon() {
  return (
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
}

export default function Memory() {
  const [items, setItems] = useState<MemoryItem[]>(() => loadMemory())
  const [text, setText] = useState('')
  const [topic, setTopic] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  // 「TA 眼中的你」LLM 心里话：有配置才调，失败静默，同一批记忆只生成一次
  const [summary, setSummary] = useState<string | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const generatedKeyRef = useRef('')
  const summarySeqRef = useRef(0)

  // 数据变更自动刷新：聊天里 TA 刚记住的，切回记忆页（或别的页签）立刻能看到
  useEffect(() => {
    const refresh = () => setItems(loadMemory())
    window.addEventListener(MEMORY_UPDATED_EVENT, refresh)
    // storage 事件跨页签才触发，同页签不触发，所以上面还得靠自定义事件
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(MEMORY_UPDATED_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  // 汇总卡 LLM 区：记忆非空 + 有 key/base_url/模型 才调；失败静默，同一批记忆只生成一次。
  // 用 seq 序号作废在飞的旧请求（换了一批记忆 / 清空时），StrictMode 双跑靠 generatedKeyRef 去重。
  useEffect(() => {
    if (items.length === 0) {
      summarySeqRef.current++ // 作废在飞的请求
      setSummary(null)
      setSummaryLoading(false)
      return
    }
    const settings = loadSettings()
    if (!settings.apiKey?.trim() || !settings.baseUrl?.trim() || !settings.model?.trim()) {
      summarySeqRef.current++
      setSummaryLoading(false)
      return
    }

    const key = items.map((m) => m.id).join('|')
    if (key === generatedKeyRef.current) return
    generatedKeyRef.current = key

    const seq = ++summarySeqRef.current
    setSummaryLoading(true)
    const persona = loadPersona()
    const ai = loadAIProfile()
    const yourName = loadUserProfile().nickname || '你'
    chatCompletion(settings, buildSummaryMessages(ai.nickname, yourName, persona, items), {
      maxTokens: 200,
      timeoutMs: 30000,
    })
      .then((raw) => {
        if (seq !== summarySeqRef.current) return
        setSummary(cleanSummaryText(raw))
      })
      .catch(() => {
        // 失败静默：只留统计区
      })
      .finally(() => {
        if (seq === summarySeqRef.current) setSummaryLoading(false)
      })
  }, [items])

  // 按主题动态分组：旧数据没主题就按关键词推断；组按最近添加时间排序，组内新的在前
  const groups = useMemo<TopicGroup[]>(() => {
    const map = new Map<string, MemoryItem[]>()
    for (const m of items) {
      const t = m.topic?.trim() || inferTopic(m.text)
      const list = map.get(t) ?? []
      list.push(m)
      map.set(t, list)
    }
    return Array.from(map.entries())
      .map(([t, list]) => ({ topic: t, items: [...list].sort((a, b) => b.createdAt - a.createdAt) }))
      .sort((a, b) => b.items[0].createdAt - a.items[0].createdAt)
  }, [items])

  // 顶部汇总：统计 / 一句话点评 / 最早一条
  const stats = useMemo(() => summarizeStats(items), [items])
  const topTopicLine = useMemo(() => buildTopTopicLine(stats.topTopic), [stats.topTopic])
  const knownSinceLine = stats.earliestTs != null ? buildKnownSince(stats.earliestTs) : ''

  const handleAdd = () => {
    const t = text.trim()
    if (!t) return
    setItems(addMemoryItem(t, topic))
    setText('')
    setTopic('')
  }

  const handleRemove = (id: string) => {
    setItems(removeMemoryItem(id))
  }

  const toggleTopic = (t: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  return (
    <div className="page memory-page">
      <p className="page-desc">
        TA 会把你放在心上的一句话记下来，下次见面还记得。
        <br />
        这些记忆只留在你的浏览器里，不会传到任何地方。
      </p>

      {stats.count > 0 && (
        <section className="memory-summary-card">
          <div className="memory-summary-head">
            <h3 className="memory-summary-title">TA 眼中的你</h3>
            {summaryLoading && <span className="memory-summary-hint">TA 正在回忆你…</span>}
          </div>
          <p className="memory-summary-stats">
            TA 记得你 <strong>{stats.count}</strong> 件事 · 分布在 <strong>{stats.topicCount}</strong> 个主题
            {knownSinceLine && <span> · {knownSinceLine}</span>}
          </p>
          {topTopicLine && <p className="memory-summary-top">{topTopicLine}</p>}
          {summary && <p className="memory-summary-llm">{summary}</p>}
        </section>
      )}

      <div className="memory-input-row">
        <input
          className="input"
          type="text"
          placeholder="想让 TA 记住什么？比如：我叫小七"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd()
          }}
        />
        <input
          className="input memory-topic-input"
          type="text"
          placeholder="主题"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd()
          }}
        />
      </div>
      <button className="btn btn-primary memory-add-btn" onClick={handleAdd}>
        记住
      </button>

      {groups.length === 0 ? (
        <div className="memory-empty">
          <svg
            className="memory-empty-mark"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
          <p className="memory-empty-title">TA 会慢慢记住你说的话</p>
          <p className="memory-empty-sub">
            聊天时随口说说你的喜欢、你的日子，
            <br />
            或者在上面亲手写下一句，都好。
          </p>
        </div>
      ) : (
        <div className="memory-topics">
          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.topic)
            return (
              <section key={g.topic} className="memory-topic-card">
                <button
                  type="button"
                  className="memory-topic-head"
                  onClick={() => toggleTopic(g.topic)}
                  aria-expanded={!isCollapsed}
                >
                  <span className={`memory-topic-name ${topicColorClass(g.topic)}`}>{g.topic}</span>
                  <span className="memory-topic-count">{g.items.length} 条</span>
                  <svg
                    className={`memory-topic-chevron${isCollapsed ? ' collapsed' : ''}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {!isCollapsed && (
                  <div className="memory-topic-body">
                    {g.items[0] && (
                      <div className="memory-item memory-item-featured">
                        <p className="memory-item-text">{g.items[0].text}</p>
                        <div className="memory-item-foot">
                          <span className="memory-item-date">{formatFirstRememberedDate(g.items[0].createdAt)}</span>
                          {g.items[0].source && (
                            <span className="memory-item-source">来自「{g.items[0].source}」</span>
                          )}
                        </div>
                        <button
                          className="memory-delete"
                          onClick={() => handleRemove(g.items[0].id)}
                          aria-label="删除这条记忆"
                        >
                          <DeleteIcon />
                        </button>
                      </div>
                    )}
                    {g.items.length > 1 && (
                      <ul className="memory-topic-items">
                        {g.items.slice(1).map((m) => (
                          <li key={m.id} className="memory-item">
                            <p className="memory-item-text">{m.text}</p>
                            <div className="memory-item-foot">
                              <span className="memory-item-date">{formatFirstRememberedDate(m.createdAt)}</span>
                              {m.source && <span className="memory-item-source">来自「{m.source}」</span>}
                            </div>
                            <button
                              className="memory-delete"
                              onClick={() => handleRemove(m.id)}
                              aria-label="删除这条记忆"
                            >
                              <DeleteIcon />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
