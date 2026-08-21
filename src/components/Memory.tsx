import { useEffect, useMemo, useState } from 'react'
import {
  addMemoryItem,
  inferTopic,
  loadMemory,
  removeMemoryItem,
  MEMORY_UPDATED_EVENT,
  type MemoryItem,
} from '../lib/memory'

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

/** 首次记住的那天：有温度的小字 */
function firstDateLabel(ts: number): string {
  const d = new Date(ts)
  const md = `${d.getMonth() + 1} 月 ${d.getDate()} 日`
  return d.getFullYear() === new Date().getFullYear()
    ? `TA 从 ${md} 起记得`
    : `TA 从 ${d.getFullYear()} 年 ${md} 起记得`
}

interface TopicGroup {
  topic: string
  items: MemoryItem[]
}

export default function Memory() {
  const [items, setItems] = useState<MemoryItem[]>(() => loadMemory())
  const [text, setText] = useState('')
  const [topic, setTopic] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

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
                  <ul className="memory-topic-items">
                    {g.items.map((m) => (
                      <li key={m.id} className="memory-item">
                        <p className="memory-item-text">{m.text}</p>
                        <div className="memory-item-foot">
                          <span className="memory-item-date">{firstDateLabel(m.createdAt)}</span>
                          {m.source && <span className="memory-item-source">来自「{m.source}」</span>}
                        </div>
                        <button
                          className="memory-delete"
                          onClick={() => handleRemove(m.id)}
                          aria-label="删除这条记忆"
                        >
                          删除
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
