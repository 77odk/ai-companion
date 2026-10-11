import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { StoredMessage } from '../../lib/storage'
import { messageIdentity } from '../../lib/space3d/bookPages'
import type { ReadingPosition } from '../../lib/environmentPreferences'

export default function ReadingOverlay({ messages, onClose, onPosition, position }: {
  messages: StoredMessage[]; onClose: () => void; onPosition: (position: ReadingPosition) => void;
  position?: ReadingPosition
}) {
  const [query, setQuery] = useState('')
  const [fontSize, setFontSize] = useState(18)
  const content = useRef<HTMLDivElement>(null)
  const initialPosition = useRef(position)
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restored = useRef(false)
  const saveVisiblePosition = () => {
    const container = content.current
    if (!container) return
    const top = container.getBoundingClientRect().top + 12
    const article = [...container.querySelectorAll<HTMLElement>('[data-message-id]')]
      .find(element => element.getBoundingClientRect().bottom > top)
    if (!article) return
    const text = article.querySelector<HTMLElement>('[data-message-text]')!
    let offset = 0
    const browserDocument = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null
    }
    const range = browserDocument.caretRangeFromPoint?.(text.getBoundingClientRect().left + 4, top)
    if (range && text.contains(range.startContainer)) {
      const prefix = document.createRange()
      prefix.selectNodeContents(text); prefix.setEnd(range.startContainer, range.startOffset)
      offset = Array.from(prefix.toString()).length
    }
    onPosition({ messageId: article.dataset.messageId!, offset })
  }
  useLayoutEffect(() => {
    if (restored.current || !content.current) return
    const saved = initialPosition.current
    if (!saved) { restored.current = true; return }
    const article = [...content.current.querySelectorAll<HTMLElement>('[data-message-id]')]
      .find(element => element.dataset.messageId === saved.messageId)
    const text = article?.querySelector('[data-message-text]')?.firstChild
    if (!text) return
    const range = document.createRange()
    const offset = Array.from(text.textContent ?? '').slice(0, saved.offset).join('').length
    range.setStart(text, offset); range.collapse(true)
    content.current.scrollTop += range.getBoundingClientRect().top - content.current.getBoundingClientRect().top - 12
    restored.current = true
  }, [])
  useEffect(() => () => { if (scrollTimer.current) clearTimeout(scrollTimer.current) }, [])
  return <section className="space3d-reader" role="dialog" aria-modal="true" aria-label="聊天记录">
    <div className="space3d-reader-tools">
      <button type="button" onClick={() => { saveVisiblePosition(); onClose() }}>返回</button>
      <input aria-label="搜索聊天内容" placeholder="搜索聊天内容" value={query} onChange={e => setQuery(e.target.value)} />
      <button type="button" aria-label="缩小字号" onClick={() => setFontSize(Math.max(16, fontSize - 2))}>A−</button>
      <button type="button" aria-label="放大字号" onClick={() => setFontSize(Math.min(30, fontSize + 2))}>A＋</button>
    </div>
    <div ref={content} className="space3d-reader-content" style={{ fontSize }} onScroll={() => {
      if (scrollTimer.current) clearTimeout(scrollTimer.current)
      scrollTimer.current = setTimeout(saveVisiblePosition, 250)
    }}>
      {messages.filter(message => !query || message.content.includes(query)).map(message => {
        const id = messageIdentity(message)
        return <article key={id} tabIndex={0} data-message-id={id}
          onFocus={() => onPosition({ messageId: id, offset: 0 })}
          onPointerUp={() => {
            const selection = window.getSelection()
            onPosition({ messageId: id, offset: selection?.anchorNode?.parentElement?.closest('[data-message-id]')?.getAttribute('data-message-id') === id
              ? Array.from((selection.anchorNode.textContent ?? '').slice(0, selection.anchorOffset)).length : 0 })
          }}>
          <p>{message.role === 'user' ? '我' : 'TA'}</p>
          <p data-message-text>{message.content}</p>
        </article>
      })}
    </div>
  </section>
}
