import { useEffect, useRef, useState } from 'react'
import MessageBubble from './MessageBubble'
import { buildSystemPrompt, streamChat, type ApiMessage } from '../lib/api'
import { loadMemory } from '../lib/memory'
import { loadMessages, loadPersona, loadSettings, loadAIProfile, saveMessages, type StoredMessage } from '../lib/storage'

interface Props {
  onGoSettings: () => void
}

export default function Chat({ onGoSettings }: Props) {
  const [messages, setMessages] = useState<StoredMessage[]>(() => loadMessages())
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasKey] = useState(() => Boolean(loadSettings().apiKey))

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const finalizeRef = useRef<() => void>(() => {})
  const assistantText = useRef('')

  // 新消息时自动滚到底部
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // 输入框自适应高度（最多约 4 行）
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [input])

  const handleSend = () => {
    const text = input.trim()
    if (!text || streaming) return

    const settings = loadSettings()
    if (!settings.apiKey || !settings.baseUrl || !settings.model) {
      setError('还没配置 API Key，请先到「设置」页完成配置')
      return
    }

    const userMsg: StoredMessage = { role: 'user', content: text, ts: Date.now() }
    const base = [...messages, userMsg]
    const assistantTs = Date.now()
    assistantText.current = ''
    setMessages([...base, { role: 'assistant', content: '', ts: assistantTs }])
    setInput('')
    setError(null)
    setStreaming(true)

    // 组装请求消息：系统提示词（默认人设+专属人设+AI昵称） + 记忆摘要（如有） + 最近 20 条历史
    const apiMessages: ApiMessage[] = [{ role: 'system', content: buildSystemPrompt(loadPersona(), loadAIProfile().nickname) }]
    const memory = loadMemory()
    if (memory.length > 0) {
      apiMessages.push({
        role: 'system',
        content: '关于对方你已经记住的事实：\n' + memory.map((m) => `- ${m.text}`).join('\n'),
      })
    }
    const history: ApiMessage[] = base.slice(-20).map((m) => ({ role: m.role, content: m.content }))
    apiMessages.push(...history)

    const finalize = () => {
      const final: StoredMessage[] = assistantText.current
        ? [...base, { role: 'assistant', content: assistantText.current, ts: assistantTs }]
        : base
      saveMessages(final)
      setMessages(final)
      setStreaming(false)
      controllerRef.current = null
    }
    finalizeRef.current = finalize

    const controller = streamChat(settings, apiMessages, {
      onToken: (t) => {
        assistantText.current += t
        setMessages([...base, { role: 'assistant', content: assistantText.current, ts: assistantTs }])
      },
      onDone: finalize,
      onError: (err) => {
        finalize()
        setError(err.message)
      },
    })
    controllerRef.current = controller
  }

  const handleStop = () => {
    controllerRef.current?.abort()
    finalizeRef.current()
  }

  const isEmpty = messages.length === 0

  return (
    <div className="chat-page">
      <div className="message-list" ref={scrollRef}>
        {isEmpty ? (
          <div className="welcome">
            <h2>你的 TA 在这里</h2>
            <p>想聊点什么？</p>
            {!hasKey && (
              <>
                <p className="welcome-hint">还没配 API Key，先去设置一下吧。</p>
                <button className="btn btn-primary" onClick={onGoSettings}>
                  去设置
                </button>
              </>
            )}
          </div>
        ) : (
          messages.map((m, i) => (
            <MessageBubble
              key={i}
              message={m}
              typing={streaming && i === messages.length - 1 && m.role === 'assistant' && m.content === ''}
            />
          ))
        )}
      </div>

      {error && <div className="chat-error">{error}</div>}

      <div className="composer">
        <textarea
          ref={inputRef}
          className="composer-input"
          rows={1}
          placeholder="说点什么…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              handleSend()
            }
          }}
        />
        {streaming ? (
          <button className="btn btn-stop" onClick={handleStop}>
            停止
          </button>
        ) : (
          <button className="btn btn-send" onClick={handleSend} disabled={!input.trim()}>
            发送
          </button>
        )}
      </div>
    </div>
  )
}
