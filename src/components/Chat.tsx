import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MessageBubble from './MessageBubble'
import { buildSystemPrompt, chatCompletion, looksFabricated, looksRobotic, streamChat, stripActionMarkers, stripEmoji, type ApiMessage } from '../lib/api'
import { extractMemories, loadMemory, notifyMemoryUpdated, recallRelevantMemories, stripMemoryMarkers, toPromptPerspective, touchMemory, upsertMemoryItem } from '../lib/memory'
import { getSessionStart, loadMessages, loadPersona, loadSettings, loadAIProfile, saveMessages, saveSettings, type StoredMessage } from '../lib/storage'
import { filterSessionMessages } from '../lib/aiSpaceDetail'
import { takeChatMessage } from '../lib/chatInject'

interface Props {
  onGoSettings: () => void
  onGoGuide: () => void
}

export default function Chat({ onGoSettings, onGoGuide }: Props) {
  const [messages, setMessages] = useState<StoredMessage[]>(() => loadMessages())
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 发送失败的那条消息：429 切换豆包后填回输入框，不丢内容不重复
  const [failedText, setFailedText] = useState<string | null>(null)
  const [hasKey] = useState(() => Boolean(loadSettings().apiKey))

  // 会话起点（M7-3 刷新对话）：setSessionStart 后聊天页只显示/只发送起点之后的消息；
  // 聊天记录一条不删——messages 里仍是全量，过滤只发生在「显示」与「发给模型的上下文」两层
  const sessionStart = useMemo(() => getSessionStart(), [])
  const visibleMessages = useMemo(
    () => filterSessionMessages(messages, sessionStart),
    [messages, sessionStart],
  )

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
  }, [visibleMessages])

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
    // 发给模型的上下文只带刷新后的消息（base = 可见消息 + 新消息）
    const base = [...visibleMessages, userMsg]
    const assistantTs = Date.now()
    assistantText.current = ''
    // state 存全量（含刷新前的聊天记录，不删），显示仍只出可见部分
    setMessages([...messages, userMsg, { role: 'assistant', content: '', ts: assistantTs }])
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
        content:
          '关于对方你已经记住的事实：\n' + memory.map((m) => `- ${toPromptPerspective(m.text)}`).join('\n'),
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
      // 人机味/编造质检：回复像客服（"我是AI"）或编造共同经历（"我们之前一起…"）→ 自动重写一次
      const cleaned = stripActionMarkers(stripEmoji(raw))
      if (cleaned && (looksRobotic(cleaned) || looksFabricated(cleaned)) && !retriedRef.current) {
        retriedRef.current = true
        setError(null)
        setMessages([...messages, userMsg, { role: 'assistant', content: '…', ts: assistantTs }])
        void chatCompletion(settings, [
          ...apiMessages,
          { role: 'assistant', content: cleaned },
          {
            role: 'user',
            content:
              '你刚才的回复有问题（像客服/程序，或者说了没有依据的话、编造了我们共同经历）。忘掉那句，重新回答：说话要有依据，不知道的事就说不知道、让对方提醒你，别编造、别圆场、别装熟。像真人一样简短自然。',
          },
        ])
          .then((retry) => {
            const retryCleaned = stripActionMarkers(stripEmoji(retry))
            if (!retryCleaned || looksRobotic(retryCleaned) || looksFabricated(retryCleaned)) {
              // 重写还是有问题？就用兜底话，自然带过但不编造
              const fallback = '这个我还真没头绪，你跟我说说呗。'
              const final: StoredMessage[] = [...messages, userMsg, { role: 'assistant', content: fallback, ts: Date.now() }]
              saveMessages(final)
              setMessages(final)
            } else {
              const final: StoredMessage[] = [...messages, userMsg, { role: 'assistant', content: retryCleaned, ts: Date.now() }]
              saveMessages(final)
              setMessages(final)
            }
            setStreaming(false)
            controllerRef.current = null
          })
          .catch(() => {
            const final: StoredMessage[] = [...messages, userMsg, { role: 'assistant', content: cleaned, ts: assistantTs }]
            saveMessages(final)
            setMessages(final)
            setStreaming(false)
            controllerRef.current = null
          })
        return
      }
      const final: StoredMessage[] = cleaned
        ? [...messages, userMsg, { role: 'assistant', content: cleaned, ts: assistantTs }]
        : [...messages, userMsg]
      saveMessages(final)
      setMessages(final)
      setStreaming(false)
      controllerRef.current = null
    }
    finalizeRef.current = finalize

    const controller = streamChat(settings, apiMessages, {
      onToken: (t) => {
        assistantText.current += t
        setMessages([...messages, userMsg, { role: 'assistant', content: stripActionMarkers(stripEmoji(assistantText.current)), ts: assistantTs }])
      },
      onDone: finalize,
      onError: (err) => {
        finalize()
        setError(err.message)
        setFailedText(userMsg.content)
      },
    })
    controllerRef.current = controller
  }, [messages, visibleMessages, streaming])

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

  const isEmpty = visibleMessages.length === 0

  return (
    <div className="chat-page">
      <div className="message-list" ref={scrollRef}>
        {isEmpty ? (
          <div className="welcome">
            <h2>你的 TA 在这里</h2>
            <p>想聊点什么？</p>
            {!hasKey && (
              <div className="welcome-guide">
                <p className="welcome-hint">TA 还没接通大脑，30 秒就能开聊。</p>
                <div className="welcome-actions">
                  <button className="btn btn-primary" onClick={onGoSettings}>
                    现在就去配置
                  </button>
                  <button className="btn btn-ghost" onClick={onGoGuide}>
                    先看使用指南
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          visibleMessages.map((m, i) => (
            <MessageBubble
              key={i}
              message={m}
              typing={streaming && i === visibleMessages.length - 1 && m.role === 'assistant' && m.content === ''}
            />
          ))
        )}
      </div>

      {error && (
        <div className="chat-error-wrap">
          <div className="chat-error">{error}</div>
          {isRateLimitError(error) && (
            <RateLimitFallback
              hasDoubao={Boolean(loadSettings().providers.volcengine?.apiKey)}
              onSwitch={() => {
                const s = loadSettings()
                const doubao = s.providers.volcengine
                if (!doubao.apiKey) return
                saveSettings({
                  provider: 'volcengine',
                  apiKey: doubao.apiKey,
                  baseUrl: doubao.baseUrl,
                  model: doubao.model,
                })
                setError(null)
                if (failedText) setInput(failedText)
              }}
              onGoSettings={onGoSettings}
            />
          )}
        </div>
      )}

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

/** 判断是否是限流/繁忙类错误（智谱高峰 429 等） */
function isRateLimitError(message: string): boolean {
  return message.includes('429') || message.includes('太频繁') || message.includes('访问量过大')
}

/** 429 时的小字提示 + 切换按钮（放在错误提示下面，不打断聊天） */
function RateLimitFallback({
  hasDoubao,
  onSwitch,
  onGoSettings,
}: {
  hasDoubao: boolean
  onSwitch: () => void
  onGoSettings: () => void
}) {
  if (hasDoubao) {
    return (
      <div className="rate-fallback">
        <span className="rate-fallback-text">智谱现在太挤了，切到豆包不排队。</span>
        <button type="button" className="rate-fallback-btn" onClick={onSwitch}>
          切到豆包
        </button>
      </div>
    )
  }
  return (
    <div className="rate-fallback">
      <span className="rate-fallback-text">智谱现在太挤了，去配个豆包（免费）不排队。</span>
      <button type="button" className="rate-fallback-btn" onClick={onGoSettings}>
        去配置豆包
      </button>
    </div>
  )
}
