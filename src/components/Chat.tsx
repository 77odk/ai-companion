import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MessageBubble from './MessageBubble'
import { buildBusyReturnPrompt, buildSystemPrompt, chatCompletion, computeThinkDelayMs, looksFabricated, looksRobotic, streamChat, stripActionMarkers, stripEmoji, type ApiMessage, type ChatError } from '../lib/api'
import { detectMemoryInstruction, detectPreferenceFact, extractMemories, extractThinkBlocks, inferTopic, isMemoryRetort, notifyMemoryUpdated, stripMemoryKeyword, stripMemoryMarkers, stripThinkBlocks, toPromptPerspective, touchMemory, upsertMemoryItem } from '../lib/memory'
import { getSessionStart, loadMessages, loadPersona, loadSettings, loadAIProfile, loadChatBg, saveMessages, saveSettings, type StoredMessage } from '../lib/storage'
import { getToken } from '../lib/auth'
import { getSession, listMemories, postMemory, postMessage, type Session } from '../lib/sessionApi'
import {
  addPendingOp,
  clearBusyState,
  confirmMessageInCache,
  flushPendingOps,
  getActiveSessionId,
  getBusyState,
  getMemoriesCache,
  getMessagesCache,
  getSessionsCache,
  markRead,
  mergeSessionMemories,
  mergeSessionMessages,
  newPendingOpId,
  recallSessionMemories,
  reconcileMemoryCacheId,
  removePendingOp,
  saveBusyState,
  saveMemoriesCache,
  saveMessagesCache,
  sessionMemoryToItem,
  splitAssistantReplies,
  touchMemoryCache,
  upsertMemoryCache,
  type PendingOp,
} from '../lib/sessionStore'
import { containsBusyKeyword, findBusyCutoff, inferBusyReason, pickBusyReply, randomBusyDurationMs, serializeBusyContext, type BusyState } from '../lib/aiBusy'
import { loadCurrentPosts } from '../lib/aiSpace'
import { buildSpacePostsBlock, personaHasLifeAnchors, LIFE_BASELINE } from '../lib/spaceChatInject'
import { buildSelfTimelineBlock } from '../lib/selfTimeline'
import { filterSessionMessages } from '../lib/aiSpaceDetail'
import { takeChatMessage } from '../lib/chatInject'
import { extractOpeningLine } from '../lib/customPersona'
import { getMilestoneStatus, markMilestoneShown } from '../lib/milestone'
import { getWeeklyReviews } from '../lib/weeklyReview'
import { recordChatTopic } from '../lib/chatTopics'
import { estimateToken, truncateByToken } from '../lib/token'
import MilestoneCard from './MilestoneCard'

/** 总输入 token 预算：系统提示词+记忆注入+历史消息合计不超过此值 */
const TOTAL_INPUT_BUDGET = 64000

interface Props {
  onGoSettings: () => void
  onGoGuide: () => void
  /** 点 TA 的头像 → 打开聊天头像资料卡 */
  onOpenProfile: () => void
}

export default function Chat({ onGoSettings, onGoGuide, onOpenProfile }: Props) {
  const activeSessionId = getActiveSessionId()

  const [messages, setMessages] = useState<StoredMessage[]>(() =>
    activeSessionId ? getMessagesCache(activeSessionId) : loadMessages(),
  )
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failedText, setFailedText] = useState<string | null>(null)
  const [hasKey] = useState(() => Boolean(loadSettings().apiKey))
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [busyReplyText, setBusyReplyText] = useState<string | null>(null)
  const persona = activeSession?.persona ?? loadPersona()
  const [milestone, setMilestone] = useState<{ day: number; hit: boolean; shown: boolean } | null>(null)
  const [showMilestone, setShowMilestone] = useState(false)

  const sessionStart = useMemo(() => getSessionStart(activeSessionId || undefined), [activeSessionId])
  const visibleMessages = useMemo(
    () => filterSessionMessages(messages, sessionStart),
    [messages, sessionStart],
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const thinkTimerRef = useRef<number | null>(null)
  const playTimerRef = useRef<number | null>(null)
  const showLenRef = useRef(0)
  const streamEndedRef = useRef(false)
  const pauseLeftRef = useRef(0)
  const streamErrorRef = useRef<ChatError | null>(null)
  const tickPlayRef = useRef<() => void>(() => {})
  const displayCleanRef = useRef('')
  const finishedRef = useRef(false)
  const runIdRef = useRef(0)
  const mountedRef = useRef(true)
  const finalizeRef = useRef<() => void>(() => {})
  const retriedRef = useRef(false)
  const assistantText = useRef('')
  // 忙碌状态相关 ref
  const busyTimerRef = useRef<number | null>(null)
  const busyTriggeredRef = useRef(false)
  const busyRepliedRef = useRef(false)
  const enterBusyRef = useRef<(text: string) => void>(() => {})
  const sendBusyReturnRef = useRef<(runId: number, sid: string, state: BusyState) => Promise<void>>(async () => {})

  const persistMessages = useCallback((msgs: StoredMessage[]) => {
    const sid = getActiveSessionId()
    if (sid) {
      saveMessagesCache(sid, msgs)
      markRead(sid)
    } else {
      saveMessages(msgs)
    }
  }, [])

  const uploadMessage = useCallback((msg: StoredMessage): Promise<void> => {
    const sid = getActiveSessionId()
    const token = getToken()
    if (!sid || !token) return Promise.resolve()
    const op: PendingOp = {
      id: newPendingOpId(),
      type: 'message',
      sessionId: sid,
      payload: { role: msg.role, content: msg.content, thinking: msg.thinking ?? '' },
      ts: msg.ts,
    }
    addPendingOp(op)
    return postMessage(token, sid, { role: msg.role, content: msg.content, thinking: msg.thinking }).then((res) => {
      if (res.ok) {
        removePendingOp(op.id)
        confirmMessageInCache(sid, op, res.data)
      }
    })
  }, [])

  // ---- 忙碌状态：进入忙碌 ----
  const enterBusy = (triggerText: string) => {
    const sid = getActiveSessionId()
    const duration = randomBusyDurationMs()
    const busyUntil = Date.now() + duration
    const reason = inferBusyReason(triggerText)
    const context = serializeBusyContext(visibleMessages.slice(-3))
    const state: BusyState = {
      status: 'busy',
      busyUntil,
      busyReason: reason,
      busyContext: context,
      returnSent: false,
    }
    if (sid) saveBusyState(sid, state)
    setIsBusy(true)
    setBusyReplyText(null)
    busyRepliedRef.current = false
    if (busyTimerRef.current !== null) {
      clearTimeout(busyTimerRef.current)
    }
    const triggerRunId = runIdRef.current
    busyTimerRef.current = window.setTimeout(() => {
      void sendBusyReturnRef.current(triggerRunId, sid, state)
    }, duration)
  }
  enterBusyRef.current = enterBusy

  // ---- 忙碌状态：忙完回来自动发消息 ----
  const sendBusyReturn = async (triggerRunId: number, sid: string, state: BusyState) => {
    // runId + sessionId 双重校验：切角色/发新消息后旧定时器作废
    if (triggerRunId !== runIdRef.current) return
    if (sid !== getActiveSessionId()) return
    // 标记已发，防重复补发
    if (sid) {
      saveBusyState(sid, { ...state, returnSent: true })
    } else {
      clearBusyState('')
    }
    setIsBusy(false)
    setBusyReplyText(null)
    if (busyTimerRef.current !== null) {
      clearTimeout(busyTimerRef.current)
      busyTimerRef.current = null
    }
    const settings = loadSettings()
    if (!settings.apiKey || !settings.baseUrl || !settings.model) return
    const nameForPrompt = (() => {
      if (!sid) return loadAIProfile().nickname
      const cached = getSessionsCache().find((s) => String(s.id) === sid)
      const t = (cached?.title || activeSession?.title || '').trim()
      if (!t || t === '新会话' || t === '我们的开始') return loadAIProfile(sid).nickname
      return t
    })()
    const systemPrompt = buildSystemPrompt(persona, nameForPrompt, undefined, sid || undefined)
    // 生成"忙完回来"前重新读缓存：busy 期间用户可能又发了消息（handleBusySend 只落库没进 busyContext），
    // 不带上的话 TA 回来会接不上用户最新的内容（2026-09-04 乔部署审查抓到）。
    // 取最近 3 条（含 busy 期间用户新发的），有新的用新的，没有退回进 busy 时存的 context。
    let latestContext = state.busyContext
    try {
      const cache = sid ? getMessagesCache(sid) : loadMessages()
      const tail = cache.slice(-3).map((m) => ({
        role: m.role,
        content: stripThinkBlocks(stripMemoryMarkers(m.content)),
      }))
      const fresh = serializeBusyContext(tail)
      if (fresh) latestContext = fresh
    } catch {
      // 读缓存失败就用进 busy 时的快照
    }
    const busyPrompt = buildBusyReturnPrompt(state.busyReason, latestContext)
    try {
      const content = await chatCompletion(
        settings,
        [
          { role: 'system', content: systemPrompt },
          { role: 'system', content: busyPrompt },
        ],
        { maxTokens: 150, temperature: 0.9 },
      )
      const cleaned = stripActionMarkers(stripEmoji(content)).trim()
      if (!cleaned) return
      const msg: StoredMessage = { role: 'assistant', content: cleaned, ts: Date.now() }
      const current = sid ? getMessagesCache(sid) : loadMessages()
      const next = [...current, msg]
      if (sid) {
        saveMessagesCache(sid, next)
        markRead(sid)
      } else {
        saveMessages(next)
      }
      setMessages(next)
      void uploadMessage(msg)
    } catch {
      // 生成失败静默，不打扰用户
    }
  }
  sendBusyReturnRef.current = sendBusyReturn

  // ---- 忙碌状态：忙碌中用户发消息，只回一句"在忙" ----
  const handleBusySend = (text: string) => {
    const userMsg: StoredMessage = { role: 'user', content: text, ts: Date.now() }
    const next = [...messages, userMsg]
    persistMessages(next)
    if (activeSessionId) void uploadMessage(userMsg)
    setMessages(next)
    setInput('')
    if (!busyRepliedRef.current) {
      busyRepliedRef.current = true
      setBusyReplyText(pickBusyReply())
    }
  }

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [visibleMessages, busyReplyText])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [input])

  useEffect(() => {
    runIdRef.current += 1
    controllerRef.current?.abort()
    if (thinkTimerRef.current !== null) {
      clearTimeout(thinkTimerRef.current)
      thinkTimerRef.current = null
    }
    if (busyTimerRef.current !== null) {
      clearTimeout(busyTimerRef.current)
      busyTimerRef.current = null
    }
    setMessages(activeSessionId ? getMessagesCache(activeSessionId) : loadMessages())
    setActiveSession(null)
    setBusyReplyText(null)
    if (activeSessionId) markRead(activeSessionId)
    // 恢复忙碌状态：切换会话/挂载时检查
    if (activeSessionId) {
      const state = getBusyState(activeSessionId)
      if (state.status === 'busy' && state.busyUntil > 0) {
        if (Date.now() >= state.busyUntil && !state.returnSent) {
          // 忙碌已结束但没发回来的消息，补发
          setIsBusy(false)
          void sendBusyReturnRef.current(runIdRef.current, activeSessionId, state)
        } else if (Date.now() < state.busyUntil) {
          // 还在忙碌中，恢复定时器
          setIsBusy(true)
          busyRepliedRef.current = false
          const remaining = state.busyUntil - Date.now()
          const triggerRunId = runIdRef.current
          busyTimerRef.current = window.setTimeout(() => {
            void sendBusyReturnRef.current(triggerRunId, activeSessionId, state)
          }, remaining)
        } else {
          setIsBusy(false)
        }
      } else {
        setIsBusy(false)
      }
    } else {
      setIsBusy(false)
    }
  }, [activeSessionId])

  useEffect(() => {
    if (!activeSessionId) return
    const token = getToken()
    if (!token) return
    let cancelled = false
    getSession(token, activeSessionId).then((res) => {
      if (cancelled || !res.ok) return
      setActiveSession(res.data.session)
      const cloud: StoredMessage[] = res.data.messages
        .map((m) => ({ role: m.role, content: m.content, ts: Date.parse(m.createdAt) }))
        .filter((m) => Number.isFinite(m.ts))
      const merged = mergeSessionMessages(getMessagesCache(activeSessionId), cloud)
      saveMessagesCache(activeSessionId, merged)
      setMessages(merged)
      markRead(activeSessionId)
      if (merged.length === 0) {
        const opening = extractOpeningLine(res.data.session.persona)
        if (opening) {
          const firstMsg: StoredMessage = { role: 'assistant', content: opening, ts: Date.now() }
          saveMessagesCache(activeSessionId, [firstMsg])
          setMessages([firstMsg])
          markRead(activeSessionId)
        }
      }
    })
    listMemories(token, activeSessionId).then((res) => {
      if (cancelled || !res.ok) return
      const cloudMem = res.data.memories.map(sessionMemoryToItem)
      const mergedMem = mergeSessionMemories(getMemoriesCache(activeSessionId), cloudMem)
      saveMemoriesCache(activeSessionId, mergedMem)
    })
    return () => {
      cancelled = true
    }
  }, [activeSessionId])

  useEffect(() => {
    if (!activeSessionId) return
    const token = getToken()
    if (token) void flushPendingOps(token)
    const onOnline = () => {
      const t = getToken()
      if (t) void flushPendingOps(t)
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [activeSessionId])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      // 模块二：组件卸载不中断请求（让 TA 想完说完落库），只清理定时器
      // 去掉了 runIdRef.current += 1 和 controllerRef.current?.abort()
      // ——卸载不是换会话，不应使旧请求回调失效或中断请求
      mountedRef.current = false
      if (thinkTimerRef.current !== null) {
        clearTimeout(thinkTimerRef.current)
        thinkTimerRef.current = null
      }
      if (playTimerRef.current !== null) {
        clearInterval(playTimerRef.current)
        playTimerRef.current = null
      }
      if (busyTimerRef.current !== null) {
        clearTimeout(busyTimerRef.current)
        busyTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    playTimerRef.current = window.setInterval(() => tickPlayRef.current(), 70)
    return () => {
      if (playTimerRef.current !== null) {
        clearInterval(playTimerRef.current)
        playTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (activeSessionId) return
    const existing = loadMessages()
    if (existing.length > 0) return
    const opening = extractOpeningLine(loadPersona())
    if (!opening) return
    const firstMsg: StoredMessage = { role: 'assistant', content: opening, ts: Date.now() }
    const next = [...existing, firstMsg]
    saveMessages(next)
    setMessages(next)
  }, [activeSessionId])

  useEffect(() => {
    const st = getMilestoneStatus(Date.now(), getActiveSessionId() || undefined)
    if (st.hit && !st.shown) {
      setMilestone(st)
      setShowMilestone(true)
    }
  }, [])

  const send = useCallback((raw: string) => {
    const text = raw.trim()
    if (!text || streaming) return

    // 忙碌中：不调 API，只回一句"在忙"
    if (isBusy) {
      handleBusySend(text)
      return
    }

    const runId = ++runIdRef.current
    retriedRef.current = false
    busyTriggeredRef.current = false

    const settings = loadSettings()
    if (!settings.apiKey || !settings.baseUrl || !settings.model) {
      setError('还没接上 TA，去「我的」页填一下 API Key 就能聊了')
      return
    }

    const writeMemory = (content: string, opts: { source?: string; topic?: string; explicit?: boolean } = {}) => {
      const trimmed = content.trim()
      if (!trimmed) return
      const src = opts.source?.trim()
      const snippet = src && src.length > 20 ? `${src.slice(0, 20)}…` : src
      if (activeSessionId) {
        const token = getToken()
        const item = upsertMemoryCache(activeSessionId, trimmed, snippet, opts.topic, opts.explicit)
        if (item && token) {
          postMemory(token, activeSessionId, { content: trimmed }).then((res) => {
            if (res.ok) reconcileMemoryCacheId(activeSessionId, item.id, res.data.id)
          })
        }
      } else {
        upsertMemoryItem(trimmed, snippet, opts.topic, opts.explicit)
      }
      notifyMemoryUpdated()
    }

    const userMsg: StoredMessage = { role: 'user', content: text, ts: Date.now() }
    recordChatTopic(text, getActiveSessionId() || undefined)
    const memInstr = detectMemoryInstruction(text)
    const isRetort = !memInstr.isInstruction && isMemoryRetort(text)
    if (memInstr.isInstruction) {
      const content = (memInstr.fact ?? stripMemoryKeyword(text)).trim()
      if (content.length >= 4) {
        writeMemory(content, { source: text, topic: inferTopic(content), explicit: true })
        userMsg.memorySaved = true
      }
    }
    if (!userMsg.memorySaved) {
      const pref = detectPreferenceFact(text)
      if (pref) {
        writeMemory(pref, { source: text, topic: inferTopic(pref), explicit: true })
        userMsg.memorySaved = true
      } else if (text.trim().length >= 1 && text.trim().length <= 8) {
        const prevAi = visibleMessages.filter((m) => m.role === 'assistant').slice(-1)[0]
        const askText = prevAi ? stripMemoryMarkers(prevAi.content) : ''
        if (askText) {
          const askAsk = /(爱|喜欢|爱吃|爱喝|口味|喜欢什么|想要什么|想要|想去|想做什么|是什么|叫什么)[，,。.！!？?]|(告诉我|说说|讲讲).{0,10}(喜欢|想要|想去|想)/.test(askText)
          const short = text.trim()
          if (askAsk && short.length >= 1) {
            const fact = short.length <= 4 ? `喜欢${short}` : short
            writeMemory(fact, { source: `TA问：${askText.slice(0, 30)}\n我答：${text}`, topic: inferTopic(fact), explicit: true })
            userMsg.memorySaved = true
          }
        }
      }
    }
    const base = [...visibleMessages, userMsg]
    const assistantTs = Date.now()
    assistantText.current = ''
    setMessages([...messages, userMsg, { role: 'assistant', content: '', ts: assistantTs }])
    setInput('')
    setError(null)
    setStreaming(true)

    if (activeSessionId) {
      persistMessages([...messages, userMsg])
      uploadMessage(userMsg)
    }

    const nameForPrompt = (() => {
      if (!activeSessionId) return loadAIProfile().nickname
      const cached = getSessionsCache().find((s) => String(s.id) === activeSessionId)
      const t = (cached?.title || activeSession?.title || '').trim()
      if (!t || t === '新会话' || t === '我们的开始') return loadAIProfile(activeSessionId).nickname
      return t
    })()
    const apiMessages: ApiMessage[] = [{ role: 'system', content: buildSystemPrompt(persona, nameForPrompt, undefined, getActiveSessionId() || undefined) }]

    const contextText = base
      .slice(-6)
      .map((m) => (m.role === 'assistant' ? stripThinkBlocks(stripMemoryMarkers(m.content)) : m.content))
      .join('\n')
    const memory = recallSessionMemories(activeSessionId, contextText)
    if (memory.length > 0) {
      apiMessages.push({
        role: 'system',
        content:
          '关于对方你已经记住的事实：\n' + memory.map((m) => `- ${toPromptPerspective(m.text)}`).join('\n'),
      })
      const now = Date.now()
      for (const m of memory) {
        if (m.pinned) continue
        if (activeSessionId) touchMemoryCache(activeSessionId, m.id, now)
        touchMemory(m.id, now)
      }
    }
    // 自我时间线：TA 刚说过的话，让它记得自己做过什么，不依附忙碌机制（TASK-SELF-TIMELINE）
    const timelineBlock = buildSelfTimelineBlock(base)
    if (timelineBlock) {
      apiMessages.push({ role: 'system', content: timelineBlock })
    }
    const weeklyList = getWeeklyReviews(activeSessionId || undefined)
    if (weeklyList.length > 0) {
      const w = weeklyList[0]
      // TASK-JOURNAL-INJECT：不只带标题，带最近一篇正文前 200 字摘要，被问"周记写的啥"有内容可答
      const excerpt = (w.content ?? '').trim().slice(0, 200)
      const excerptLine = excerpt ? `\n周记内容摘录：${excerpt}` : ''
      apiMessages.push({
        role: 'system',
        content: `你最近写给对方的周记是「${w.title}」（${w.weekLabel}）。${excerptLine}\n对方要是提起周记，就照这篇的语气和内容回应。`,
      })
    }
    // TA 最近发过的动态注入：让 TA 知道自己的空间历史，被问"你发过…"时有真凭据（TASK-SPACE-CHAT）
    const spaceBlock = buildSpacePostsBlock(loadCurrentPosts(activeSessionId || undefined))
    if (spaceBlock) {
      apiMessages.push({ role: 'system', content: spaceBlock })
    }
    // 生活基线：人设没写生活信息时补中性事实锚，让 TA 说"在洗碗/翻书"有根（TASK-SPACE-CHAT）
    if (!personaHasLifeAnchors(persona)) {
      apiMessages.push({ role: 'system', content: LIFE_BASELINE })
    }
    if (memInstr.isInstruction) {
      apiMessages.push({
        role: 'system',
        content: `用户刚要求你记住：${memInstr.fact ?? text}。请在回复末尾单独一行输出【记忆·主题】标记（主题词概括类别），内容写这条事实，并在回复里简短确认已经记下。`,
      })
    } else if (isRetort) {
      apiMessages.push({
        role: 'system',
        content:
          '用户刚才在提醒你记下之前提到的信息。从最近的对话里提取值得长期记住的事实（作息、喜好、身体情况、重要经历等），在回复末尾单独一行输出【记忆·主题】标记，并确认已经记下。',
      })
    }

    // 按总 token 预算动态截断：系统消息占多少，剩下的全给历史消息
    const systemTokens = apiMessages.reduce((sum, m) => sum + estimateToken(m.content), 0)
    const historyBudget = Math.max(0, TOTAL_INPUT_BUDGET - systemTokens)
    const history: ApiMessage[] = truncateByToken(
      base.map((m) => ({
        role: m.role,
        content: m.role === 'assistant' ? stripThinkBlocks(stripMemoryMarkers(m.content)) : m.content,
      })),
      historyBudget,
    )
    apiMessages.push(...history)

    const commitFinal = (final: StoredMessage[]) => {
      persistMessages(final)
      // 模块二：组件卸载后跳过 UI 更新，落库/云同步继续执行
      if (mountedRef.current) setMessages(final)
      const sid = getActiveSessionId()
      const token = getToken()
      if (sid && token) {
        let chain: Promise<void> = Promise.resolve()
        for (const m of final) {
          if (m.role !== 'assistant' || m.ts !== assistantTs) continue
          chain = chain.then(() => uploadMessage(m))
        }
      }
      if (mountedRef.current) setStreaming(false)
      controllerRef.current = null
    }

    const finalize = () => {
      const raw = assistantText.current
      if (raw) {
        const memories = extractMemories(raw)
        if (memories.length > 0) {
          const source = userMsg.content.trim()
          const snippet = source.length > 20 ? `${source.slice(0, 20)}…` : source
          if (activeSessionId) {
            const token = getToken()
            for (const mem of memories) {
              const item = upsertMemoryCache(activeSessionId, mem.text, snippet, mem.topic)
              if (item && token) {
                postMemory(token, activeSessionId, { content: mem.text }).then((res) => {
                  if (res.ok) reconcileMemoryCacheId(activeSessionId, item.id, res.data.id)
                })
              }
            }
          } else {
            for (const mem of memories) {
              upsertMemoryItem(mem.text, snippet, mem.topic)
            }
          }
          notifyMemoryUpdated()
        }
      }
      // 模块三·内心戏：提取思考链原文（存到 thinking 字段），正文剥离思考链
      const thinking = extractThinkBlocks(raw)
      const cleaned = stripActionMarkers(stripEmoji(stripThinkBlocks(stripMemoryMarkers(raw))))
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
              const fallback = '这个我还真没头绪，你跟我说说呗。'
              const final: StoredMessage[] = [...messages, userMsg, { role: 'assistant', content: fallback, ts: assistantTs }]
              commitFinal(final)
            } else {
              const final: StoredMessage[] = [...messages, userMsg, { role: 'assistant', content: retryCleaned, ts: assistantTs }]
              commitFinal(final)
            }
          })
          .catch(() => {
            const final: StoredMessage[] = [...messages, userMsg, { role: 'assistant', content: cleaned, ts: assistantTs }]
            commitFinal(final)
          })
        return
      }
      const assistantMsgs = cleaned ? splitAssistantReplies(cleaned, assistantTs) : []
      // 思考链存到第一条 assistant 消息的 thinking 字段（内心戏展示用）
      if (assistantMsgs.length > 0 && thinking) {
        assistantMsgs[0].thinking = thinking
      }
      const final: StoredMessage[] = [...messages, userMsg, ...assistantMsgs]
      commitFinal(final)
    }
    finalizeRef.current = finalize

    const playTick = () => {
      if (runId !== runIdRef.current) return
      if (finishedRef.current) return
      if (pauseLeftRef.current > 0) {
        pauseLeftRef.current -= 1
        return
      }
      const clean = stripThinkBlocks(stripMemoryMarkers(assistantText.current))
      const total = clean.length
      if (showLenRef.current >= total) {
        if (streamEndedRef.current) finishStreaming()
        return
      }
      showLenRef.current += 1
      const ch = clean[showLenRef.current - 1]
      if (ch === '\n' || ch === '。' || ch === '！' || ch === '？' || ch === '…' || ch === '.' || ch === '!' || ch === '?') {
        pauseLeftRef.current = 5
      }
      displayCleanRef.current = clean.slice(0, showLenRef.current)
      const splits = splitAssistantReplies(displayCleanRef.current, assistantTs)
      setMessages([...messages, userMsg, ...splits])
      if (showLenRef.current >= total && streamEndedRef.current) finishStreaming()
    }
    const finishStreaming = () => {
      if (finishedRef.current) return
      finishedRef.current = true
      const err = streamErrorRef.current
      finalize()
      if (err && mountedRef.current) {
        setError(err.message)
        setFailedText(userMsg.content)
      }
    }
    tickPlayRef.current = playTick

    const startStream = () => {
      if (runId !== runIdRef.current) return
      streamEndedRef.current = false
      streamErrorRef.current = null
      showLenRef.current = 0
      pauseLeftRef.current = 0
      displayCleanRef.current = ''
      finishedRef.current = false
      const controller = streamChat(settings, apiMessages, {
        onToken: (t) => {
          if (runId !== runIdRef.current) return
          assistantText.current += t
          // 忙碌关键词检测：流式累积层截断，不是显示层
          if (!busyTriggeredRef.current && containsBusyKeyword(assistantText.current)) {
            busyTriggeredRef.current = true
            const cutoff = findBusyCutoff(assistantText.current)
            if (cutoff > 0 && cutoff < assistantText.current.length) {
              assistantText.current = assistantText.current.slice(0, cutoff)
            }
            // 停流：abort 后 catch 里会直接 return，不会触发 onError
            controllerRef.current?.abort()
            streamEndedRef.current = true
            // 进入忙碌状态（用 ref 避免闭包）
            enterBusyRef.current(assistantText.current)
          }
        },
        onDone: () => {
          if (runId !== runIdRef.current) return
          streamEndedRef.current = true
          // 模块二：直接 finalize，不依赖 playTick 定时器
          // ——组件卸载后 playTimer 已被清理，靠 playTick 间接调用 finalize 会导致消息落不了库
          finalizeRef.current?.()
        },
        onError: (err) => {
          if (runId !== runIdRef.current) return
          streamErrorRef.current = err
          streamEndedRef.current = true
          finalizeRef.current?.()
        },
      })
      controllerRef.current = controller
    }
    const thinkMs = computeThinkDelayMs(text.length)
    thinkTimerRef.current = window.setTimeout(startStream, thinkMs)
  }, [messages, visibleMessages, streaming, persona, activeSession, activeSessionId, isBusy, persistMessages, uploadMessage])

  useEffect(() => {
    const injected = takeChatMessage()
    if (injected) send(injected)
  }, [send])

  const handleSend = () => send(input)

  const handleStop = () => {
    runIdRef.current += 1
    if (thinkTimerRef.current !== null) {
      clearTimeout(thinkTimerRef.current)
      thinkTimerRef.current = null
    }
    controllerRef.current?.abort()
    if (displayCleanRef.current) assistantText.current = displayCleanRef.current
    finishedRef.current = true
    retriedRef.current = true
    finalizeRef.current()
  }

  const closeMilestone = () => {
    if (milestone) markMilestoneShown(milestone.day)
    setShowMilestone(false)
  }

  const isEmpty = visibleMessages.length === 0
  const chatBg = useMemo(() => loadChatBg(activeSessionId ?? undefined), [activeSessionId])

  return (
    <div className="chat-page" style={chatBg ? { backgroundImage: `url(${chatBg})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' } : undefined}>
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
          <>
            {visibleMessages.map((m, i) => (
              <MessageBubble
                key={i}
                message={m}
                typing={streaming && i === visibleMessages.length - 1 && m.role === 'assistant' && m.content === ''}
                onAvatarClick={onOpenProfile}
              />
            ))}
            {busyReplyText && (
              <div style={{ color: '#888', fontSize: '13px', margin: '4px 0 4px 12px', paddingLeft: '28px' }}>
                {busyReplyText}
              </div>
            )}
          </>
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
          placeholder={isBusy ? 'TA 正在忙，消息会稍后回复' : '说点什么…'}
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

      {showMilestone && milestone && <MilestoneCard day={milestone.day} onClose={closeMilestone} />}
    </div>
  )
}

function isRateLimitError(message: string): boolean {
  return message.includes('429') || message.includes('太频繁') || message.includes('访问量过大')
}

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
