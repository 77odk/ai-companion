import { useCallback, useEffect, useRef, useState } from 'react'
import MessageBubble from './MessageBubble'
import { buildSystemPrompt, chatCompletion, looksRobotic, streamChat, stripEmoji, type ApiMessage } from '../lib/api'
import { extractMemories, loadMemory, notifyMemoryUpdated, recallRelevantMemories, stripMemoryMarkers, touchMemory, upsertMemoryItem } from '../lib/memory'
import { loadMessages, loadPersona, loadSettings, loadAIProfile, saveMessages, type StoredMessage } from '../lib/storage'
import { takeChatMessage } from '../lib/chatInject'

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
  const retriedRef = useRef(false)
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

  const send = useCallback((raw: string) => {
    const text = raw.trim()
    if (!text || streaming) return

    const settings = loadSettings()
    if (!settings.apiKey || !settings.baseUrl || !settings.model) {
      setError('还没接上 TA，去「我的」页填一下 API Key 就能聊了')
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
    // 注入记忆改为「按需召回」：重要记忆（pinned）恒带 + 与当前话题相关的记忆（主题/关键词命中），其余省略；
    // 一条都没命中时兜底为最活跃的前 5 条，保证 TA 至少有记忆可依。
    // 排序（双源信任，M5-4）：pinned 恒最前 → 用户明说的（explicit）次之 → 其余按活跃度。
    // 注入格式保持纯文本「- xxx」，不给 explicit 条目加「[你说的]」前缀——怕模型学样在回复里输出类似标记，
    // 双源信任只体现在排序优先级上，来源标签放在记忆页展示。
    const contextText = base
      .slice(-6)
      .map((m) => (m.role === 'assistant' ? stripMemoryMarkers(m.content) : m.content))
      .join('\n')
    const memory = recallRelevantMemories(loadMemory(), contextText)
    if (memory.length > 0) {
      apiMessages.push({
        role: 'system',
        content: '关于对方你已经记住的事实：\n' + memory.map((m) => `- ${m.text}`).join('\n'),
      })
      // 这次注入 = 提起了这些记忆：非重要条目刷新「最近提起」活跃度；不广播（频繁调用会让记忆页跟着刷新）
      const now = Date.now()
      for (const m of memory) {
        if (!m.pinned) touchMemory(m.id, now)
      }
    }
    // 发回给模型的助手消息去掉记忆标记行，免得模型看到一堆标记跟着模仿
    const history: ApiMessage[] = base.slice(-20).map((m) => ({
      role: m.role,
      content: m.role === 'assistant' ? stripMemoryMarkers(m.content) : m.content,
    }))
    apiMessages.push(...history)

    const finalize = () => {
      const raw = assistantText.current
      // 解析回复里的「【记忆】xxx」标记行，自动存进记忆库（去重、带来源、带主题）
      if (raw) {
        const memories = extractMemories(raw)
        if (memories.length > 0) {
          const source = userMsg.content.trim()
          const snippet = source.length > 20 ? `${source.slice(0, 20)}…` : source
          for (const mem of memories) {
            upsertMemoryItem(mem.text, snippet, mem.topic)
          }
          notifyMemoryUpdated()
        }
      }
      // 人机味质检：这轮回复像客服/程序（"我是AI""TA是指""有什么可以帮你的吗"），自动重写一次
      const cleaned = stripEmoji(raw)
      if (cleaned && looksRobotic(cleaned) && !retriedRef.current) {
        retriedRef.current = true
        setError(null)
        setMessages([...base, { role: 'assistant', content: '…', ts: assistantTs }])
        void chatCompletion(settings, [
          ...apiMessages,
          { role: 'assistant', content: cleaned },
          {
            role: 'user',
            content:
              '你刚才的回复太像客服/程序了。忘掉那句，用你真实的身份、像真人一样重新回答一遍，简短自然。',
          },
        ])
          .then((retry) => {
            const retryCleaned = stripEmoji(retry)
            if (!retryCleaned || looksRobotic(retryCleaned)) {
              // 重写还是人机味？就用示范语气兜底，别让用户看到AI腔
              const fallback = '嗯，我在。刚才没好好说话，重说一遍——我在呢。'
              const final: StoredMessage[] = [...base, { role: 'assistant', content: fallback, ts: Date.now() }]
              saveMessages(final)
              setMessages(final)
            } else {
              const final: StoredMessage[] = [...base, { role: 'assistant', content: retryCleaned, ts: Date.now() }]
              saveMessages(final)
              setMessages(final)
            }
            setStreaming(false)
            controllerRef.current = null
          })
          .catch(() => {
            const final: StoredMessage[] = [...base, { role: 'assistant', content: cleaned, ts: assistantTs }]
            saveMessages(final)
            setMessages(final)
            setStreaming(false)
            controllerRef.current = null
          })
        return
      }
      const final: StoredMessage[] = cleaned
        ? [...base, { role: 'assistant', content: cleaned, ts: assistantTs }]
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
        setMessages([...base, { role: 'assistant', content: stripEmoji(assistantText.current), ts: assistantTs }])
      },
      onDone: finalize,
      onError: (err) => {
        finalize()
        setError(err.message)
      },
    })
    controllerRef.current = controller
  }, [messages, streaming])

  // 工作台「跟 TA 说」带话进来：Chat 挂载时取走并直接发给 TA（StrictMode 双跑靠 take 清空去重）
  useEffect(() => {
    const injected = takeChatMessage()
    if (injected) send(injected)
  }, [send])

  const handleSend = () => send(input)

  const handleStop = () => {
    controllerRef.current?.abort()
    finalizeRef.current()
  }

  // 清空会话：清空本地历史 + 界面（下次 TA 就不会被旧对话污染人设）
  const handleClear = () => {
    if (streaming) handleStop()
    retriedRef.current = false
    saveMessages([])
    setMessages([])
    setError(null)
  }

  const isEmpty = messages.length === 0

  return (
    <div className="chat-page">
      {!isEmpty && (
        <div className="chat-clear-row">
          <button type="button" className="link-btn chat-clear-btn" onClick={handleClear}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="chat-clear-icon">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            </svg>
            清空对话
          </button>
        </div>
      )}
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
