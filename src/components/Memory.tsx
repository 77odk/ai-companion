import { useEffect, useMemo, useState } from 'react'
import { addMemoryItem, loadMemory, removeMemoryItem, MEMORY_UPDATED_EVENT, type MemoryItem } from '../lib/memory'
import { timeAgo } from '../lib/time'

export default function Memory() {
  const [items, setItems] = useState<MemoryItem[]>(() => loadMemory())
  const [text, setText] = useState('')

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

  // 按最近一次变化排序（被去重更新过的会浮到上面）
  const sorted = useMemo(
    () => [...items].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)),
    [items],
  )

  const handleAdd = () => {
    const t = text.trim()
    if (!t) return
    setItems(addMemoryItem(t))
    setText('')
  }

  const handleRemove = (id: string) => {
    setItems(removeMemoryItem(id))
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
        <button className="btn btn-primary" onClick={handleAdd}>
          记住
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="memory-empty">
          <span className="memory-empty-mark">💌</span>
          <p className="memory-empty-title">TA 会慢慢记住你说的话</p>
          <p className="memory-empty-sub">
            聊天时随口说说你的喜欢、你的日子，
            <br />
            或者在上面亲手写下一句，都好。
          </p>
        </div>
      ) : (
        <ul className="memory-list">
          {sorted.map((m) => (
            <li key={m.id} className="memory-card">
              <p className="memory-card-text">{m.text}</p>
              <div className="memory-card-foot">
                <span className="memory-card-time">{timeAgo(m.updatedAt ?? m.createdAt)}</span>
                {m.source && <span className="memory-card-badge">TA 记住的</span>}
                {m.source && <span className="memory-card-source">来自「{m.source}」</span>}
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
    </div>
  )
}
