import { useState } from 'react'
import { addMemoryItem, loadMemory, removeMemoryItem, type MemoryItem } from '../lib/memory'

export default function Memory() {
  const [items, setItems] = useState<MemoryItem[]>(() => loadMemory())
  const [text, setText] = useState('')

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
        TA 会把你说的重要的话记下来，下次见面还记得。
        <br />
        这些记忆只存在你浏览器本地，不会上传。
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

      {items.length === 0 ? (
        <p className="memory-empty">还没有记住的事实，上面添加一条试试。</p>
      ) : (
        <ul className="memory-list">
          {items.map((m) => (
            <li key={m.id} className="memory-item">
              <span className="memory-text">{m.text}</span>
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
