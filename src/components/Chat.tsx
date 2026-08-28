import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MessageBubble from './MessageBubble'
import { buildSystemPrompt, chatCompletion, looksFabricated, looksRobotic, streamChat, stripActionMarkers, stripEmoji, type ApiMessage } from '../lib/api'
import { detectMemoryInstruction, detectPreferenceFact, extractMemories, inferTopic, isMemoryRetort, notifyMemoryUpdated, stripMemoryKeyword, stripMemoryMarkers, toPromptPerspective, touchMemory, upsertMemoryItem } from '../lib/memory'
import { getSessionStart, loadMessages, loadPersona, loadSettings, loadAIProfile, loadChatBg, saveMessages, saveSettings, type StoredMessage } from '../lib/storage'
import { getToken } from '../lib/auth'
import { getSession, listMemories, postMemory, postMessage, type Session } from '../lib/sessionApi'
import {
  addPendingOp,
  confirmMessageInCache,
  flushPendingOps,
  getActiveSessionId,
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
  saveMemoriesCache,
  saveMessagesCache,
  sessionMemoryToItem,
  splitAssistantReplies,
  touchMemoryCache,
  upsertMemoryCache,
  type PendingOp,
} from '../lib/sessionStore'
import { filterSessionMessages } from '../lib/aiSpaceDetail'
import { takeChatMessage } from '../lib/chatInject'
import { extractOpeningLine } from '../lib/customPersona'
import { getMilestoneStatus, markMilestoneShown } from '../lib/milestone'
import { getWeeklyReviews } from '../lib/weeklyReview'
import { recordChatTopic } from '../lib/chatTopics'
import MilestoneCard from './MilestoneCard'

interface Props {
  onGoSettings: () => void
  onGoGuide: () => void
  /** 点 TA 的头像 → 打开聊天头像资料卡（TASK-UI3） */
  onOpenProfile: () => void
}

export default function Chat({ onGoSettings, onGoGuide, onOpenProfile }: Props) {
  // B2c-1 会话模式：有 activeSessionId → 会话数据走后端（本地缓存秒开，后端权威）；
  // 没有 → 走现有 localStorage 流程（B2c 过渡期，等 B2c-2 选角色新建会话对接）
  const activeSessionId = getActiveSessionId()

  const [messages, setMessages] = useState<StoredMessage[]>(() =>
    activeSessionId ? getMessagesCache(activeSessionId) : loadMessages(),
  )
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 发送失败的那条消息：429 切换豆包后填回输入框，不丢内容不重复
  const [failedText, setFailedText] = useState<string | null>(null)
  const [hasKey] = useState(() => Boolean(loadSettings().apiKey))
  // 当前会话对象（后台拉会话详情后才有）：persona 从这里读，兜底读全局 ai_companion_persona
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const persona = activeSession?.persona ?? loadPersona()
  // 相处里程碑（W1）：打开忆文时检测，今天是里程碑日且没展示过 → 弹纪念卡；关闭即标记
  const [milestone, setMilestone] = useState<{ day: number; hit: boolean; shown: boolean } | null>(null)
  const [showMilestone, setShowMilestone] = useState(false)

  // 会话起点（M7-3 刷新对话）：会话模式下不套全局起点（每会话消息全量显示），遗留流程照旧
  const sessionStart = useMemo(() => (activeSessionId ? 0 : getSessionStart()), [activeSessionId])
  const visibleMessages = useMemo(
    () => filterSessionMessages(messages, sessionStart),
    [messages, sessionStart],
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const controllerRef = useRef<AbortController | null>(null)
  // 流式轮次号（review3 新-8 串台修复）：每次发送/切会话/卸载都 +1，
  // 旧轮次的 onToken/onDone/onError 回调凭 runId 判断自己已作废 → 直接 return，
  // 防止切角色后旧会话的流式内容继续冒进新会话（用户看到的「TA 一直乱说」）。
  const runIdRef = useRef(0)
  const finalizeRef = useRef<() => void>(() => {})
  const retriedRef = useRef(false)
  const assistantText = useRef('')

  // 数据落盘：会话模式写该会话缓存，遗留模式写全局 ai_companion_messages（保留原有裁剪逻辑）。
  // 会话模式下写消息 = 用户在会话内 = 已读（S1 未读红点即时消失，不会给自己新发的消息挂红点）
  const persistMessages = useCallback((msgs: StoredMessage[]) => {
    const sid = getActiveSessionId()
    if (sid) {
      saveMessagesCache(sid, msgs)
      markRead(sid)
    } else {
      saveMessages(msgs)
    }
  }, [])

  // 乐观上传：先入 pendingSync 队列（本地不丢），再异步 postMessage 上传；
  // 成功移出队列并把缓存里的乐观条目对账成服务端版本（ts 换成 createdAt），失败留在队列联网补传
  const uploadMessage = useCallback((msg: StoredMessage) => {
    const sid = getActiveSessionId()
    const token = getToken()
    if (!sid || !token) return
    const op: PendingOp = {
      id: newPendingOpId(),
      type: 'message',
      sessionId: sid,
      payload: { role: msg.role, content: msg.content },
      ts: msg.ts,
    }
    addPendingOp(op)
    postMessage(token, sid, { role: msg.role, content: msg.content }).then((res) => {
      if (res.ok) {
        removePendingOp(op.id)
        confirmMessageInCache(sid, op, res.data)
      }
      // res.ok=false：留在队列，联网自动补传（flushPendingOps），聊天不卡
    })
  }, [])

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

  // 切换会话（B3 侧边栏）：activeSessionId 变化时立即切到新会话的本地缓存，
  // 别让旧会话的消息还挂在屏幕上；会话详情拉回后再合并更新（下面那个 effect）。
  // 切到无会话（游客/过渡）则退回全局 localStorage 流程。进入会话即已读（S1 红点消失）。
  useEffect(() => {
    // 切会话：作废在途流式（runId 失效 + abort 请求），旧会话的流式内容绝不能串进新会话
    runIdRef.current += 1
    controllerRef.current?.abort()
    setMessages(activeSessionId ? getMessagesCache(activeSessionId) : loadMessages())
    setActiveSession(null)
    if (activeSessionId) markRead(activeSessionId)
  }, [activeSessionId])

  // 会话模式挂载：本地缓存秒开 → 后台拉后端会话详情 → 按 ts 合并补最新 → 写缓存。
  // 同一时机拉该会话的记忆列表填缓存（B2c-3 记忆注入来源），后端权威、缓存保留增强字段。
  // 全新会话且会话人设带开场白 → 插入第一句（沿用开场白机制，不调 API、不耗 key）
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
      // 后端拉回的最新消息也在会话内 = 已读（别让刚打开就显示红点）
      markRead(activeSessionId)
      if (merged.length === 0) {
        const opening = extractOpeningLine(res.data.session.persona)
        if (opening) {
          const firstMsg: StoredMessage = { role: 'assistant', content: opening, ts: Date.now() }
          saveMessagesCache(activeSessionId, [firstMsg])
          setMessages([firstMsg])
          // 开场白是 TA 主动发的第一句，但用户就在会话里 = 已读，不给它挂红点
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

  // 联网自动补传：挂载时 + 网络恢复时重试 pendingSync 队列（上传失败的本地消息/记忆补上云）
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

  // 组件卸载：作废在途流式 + 中止请求（review3 新-8：防卸载后回调继续 setState / 落盘残句）
  useEffect(() => {
    return () => {
      runIdRef.current += 1
      controllerRef.current?.abort()
    }
  }, [])

  // 开场白机制（遗留 localStorage 流程）：全新开始（没有任何聊天记录）且人设里写了「初次见面开场白」→
  // 把 TA 的见面第一句话插进来当第一条 assistant 消息。不调 API、不耗 key，
  // 模型后续也能看到这句历史，衔接自然。只在无聊天记录时插入；
  // 老用户换人设（已有聊天记录）不插。StrictMode 双跑靠读 localStorage 去重。
  // 会话模式的开场白在会话详情拉回后处理（上面那个 effect），这里只管遗留流程。
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

  // 相处里程碑：打开忆文（chat 视图）时检测，今天是里程碑日且没展示过 → 弹纪念卡。
  // 无 key 不依赖（纯模板）；StrictMode 双跑读 localStorage，幂等。
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

    // 本轮流式的轮次号：作废之前任何还在途的回调（onToken/onDone/onError 会核对）
    const runId = ++runIdRef.current

    // 每轮新对话重置质检重写标记：上一轮触发过重写不影响本轮
    retriedRef.current = false

    const settings = loadSettings()
    if (!settings.apiKey || !settings.baseUrl || !settings.model) {
      setError('还没接上 TA，去「我的」页填一下 API Key 就能聊了')
      return
    }

    // TASK-LM1 记忆保底写入：有会话 → 会话记忆缓存 upsert + 异步 postMemory 上传（失败留缓存不丢）；
    // 无会话 → 本地记忆库。走现有 upsert（isSimilarMemory 天然去重），与模型标记提取互不重复建条目。
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
            // 上传失败：记忆留在缓存（本地不丢），不打断聊天；记忆页能看到这条待上传的记忆
          })
        }
      } else {
        upsertMemoryItem(trimmed, snippet, opts.topic, opts.explicit)
      }
      notifyMemoryUpdated()
    }

    const userMsg: StoredMessage = { role: 'user', content: text, ts: Date.now() }
    // TASK_UI_BATCH2 事件触发：记录最近聊天话题，TA 的动态可呼应最近聊到的事
    recordChatTopic(text, getActiveSessionId() || undefined)
    // TASK-LM1 显式记忆指令：硬触发检测 + 保底写入（不依赖模型是否输出标记）
    const memInstr = detectMemoryInstruction(text)
    const isRetort = !memInstr.isInstruction && isMemoryRetort(text)
    if (memInstr.isInstruction) {
      // 保底写：fact 非空直接用；为空说明去掉关键词后太短、内容不可靠 → 交给模型提取兜底，
      // 不写零碎记忆（避免单字记忆在 isSimilarMemory 里挡住更完整的事实）
      const content = (memInstr.fact ?? stripMemoryKeyword(text)).trim()
      if (content.length >= 4) {
        writeMemory(content, { source: text, topic: inferTopic(content), explicit: true })
        userMsg.memorySaved = true
      }
    }
    // 2026-08-25 七七反馈：AI 不总带【记忆】标记 → 偏好/事实句前端保底存（不依赖模型自觉）
    if (!userMsg.memorySaved) {
      const pref = detectPreferenceFact(text)
      if (pref) {
        writeMemory(pref, { source: text, topic: inferTopic(pref), explicit: true })
        userMsg.memorySaved = true
      } else if (text.trim().length >= 1 && text.trim().length <= 8) {
        // 追问补全（2026-08-25 实测踩坑）：AI 问「你爱吃什么口味的排骨？」→ 用户回「话梅」（单短词），
        // 前一条 AI 消息含「喜欢/爱吃什么/什么口味/告诉我」类问句时，把短回复并成「喜欢X」存记忆
        const prevAi = visibleMessages.filter((m) => m.role === 'assistant').slice(-1)[0]
        const askText = prevAi ? stripMemoryMarkers(prevAi.content) : ''
        if (askText) {
          const askAsk = /(爱|喜欢|爱吃|爱喝|口味|喜欢什么|想要什么|想要|想去|想做什么|是什么|叫什么)[，,。.！!？?]|(告诉我|说说|讲讲).{0,10}(喜欢|想要|想去|想)/.test(askText)
          const short = text.trim()
          if (askAsk && short.length >= 1) {
            // 拼成「喜欢X」（饮食偏好常见场景）；其余短词用原样存
            const fact = short.length <= 4 ? `喜欢${short}` : short
            writeMemory(fact, { source: `TA问：${askText.slice(0, 30)}\n我答：${text}`, topic: inferTopic(fact), explicit: true })
            userMsg.memorySaved = true
          }
        }
      }
    }
    // 发给模型的上下文只带刷新后的消息（base = 可见消息 + 新消息）
    const base = [...visibleMessages, userMsg]
    const assistantTs = Date.now()
    assistantText.current = ''
    // state 存全量（含刷新前的聊天记录，不删），显示仍只出可见部分
    setMessages([...messages, userMsg, { role: 'assistant', content: '', ts: assistantTs }])
    setInput('')
    setError(null)
    setStreaming(true)

    // 乐观写入：用户消息先落本地缓存再异步上传后端（失败进 pendingSync 队列，联网补传）
    if (activeSessionId) {
      persistMessages([...messages, userMsg])
      uploadMessage(userMsg)
    }

    // 组装请求消息：系统提示词（默认人设+专属人设+AI昵称） + 记忆摘要（如有） + 最近 20 条历史
    // S1 角色名注入身份：TA 自称当前会话的 title（新建即角色默认名/昵称），不再用全局昵称；
    // 侧边栏改名后缓存已更新，兜底读缓存拿新名字；无会话或占位标题 → 全局昵称
    const nameForPrompt = (() => {
      if (!activeSessionId) return loadAIProfile().nickname
      // 侧边栏改名后缓存即时更新，优先读缓存拿新名字；缓存没拉到（刚建会话）再退回会话详情的 title
      const cached = getSessionsCache().find((s) => String(s.id) === activeSessionId)
      const t = (cached?.title || activeSession?.title || '').trim()
      if (!t || t === '新会话' || t === '我们的开始') return loadAIProfile(activeSessionId).nickname
      return t
    })()
    const apiMessages: ApiMessage[] = [{ role: 'system', content: buildSystemPrompt(persona, nameForPrompt, undefined, getActiveSessionId() || undefined) }]
    // 注入记忆改为「按需召回」：重要记忆（pinned）恒带 + 与当前话题相关的记忆（主题/关键词命中），其余省略；
    // 一条都没命中时兜底为最活跃的前 5 条，保证 TA 至少有记忆可依。
    // 排序（双源信任，M5-4）：pinned 恒最前 → 用户明说的（explicit）次之 → 其余按活跃度。
    // 注入格式保持纯文本「- xxx」，不给 explicit 条目加「[你说的]」前缀——怕模型学样在回复里输出类似标记，
    // 双源信任只体现在排序优先级上，来源标签放在记忆页展示。
    const contextText = base
      .slice(-6)
      .map((m) => (m.role === 'assistant' ? stripMemoryMarkers(m.content) : m.content))
      .join('\n')
    // 记忆来源（B2c-3）：有会话读当前会话记忆缓存（后端填充），无会话兜底本地记忆；召回逻辑不变
    const memory = recallSessionMemories(activeSessionId, contextText)
    if (memory.length > 0) {
      apiMessages.push({
        role: 'system',
        content:
          '关于对方你已经记住的事实：\n' + memory.map((m) => `- ${toPromptPerspective(m.text)}`).join('\n'),
      })
      // 这次注入 = 提起了这些记忆：非重要条目刷新「最近提起」活跃度；不广播（频繁调用会让记忆页跟着刷新）。
      // 组合读取里既有全局记忆又有当前会话记忆：两个 store 都 touch 一遍（find 不到自然跳过，双源都不漏）。
      const now = Date.now()
      for (const m of memory) {
        if (m.pinned) continue
        if (activeSessionId) touchMemoryCache(activeSessionId, m.id, now)
        touchMemory(m.id, now)
      }
    }
    // TASK-UI2 相与书注入：当前角色最近一篇周记（若有）给 TA 作「记忆里的信」——
    // 只在聊天上下文里提一句标题+周数，不串读别的角色；无周记不占这一行。
    const weeklyList = getWeeklyReviews(activeSessionId || undefined)
    if (weeklyList.length > 0) {
      apiMessages.push({
        role: 'system',
        content: `你最近写给对方的周记是「${weeklyList[0].title}」（${weeklyList[0].weekLabel}）。对方要是提起周记，就照这篇的语气和内容回应。`,
      })
    }
    // TASK-LM1 显式指令/反问强化：追加系统消息让模型也输出记忆标记（与保底写入去重，不重复建条目）
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
    // 发回给模型的助手消息去掉记忆标记行，免得模型看到一堆标记跟着模仿
    const history: ApiMessage[] = base.slice(-20).map((m) => ({
      role: m.role,
      content: m.role === 'assistant' ? stripMemoryMarkers(m.content) : m.content,
    }))
    apiMessages.push(...history)

    // 收尾统一走这里：落盘 + 上屏 + 异步上传助手消息 + 结束流式态
    const commitFinal = (final: StoredMessage[]) => {
      persistMessages(final)
      setMessages(final)
      // 拆分后可能有多条同 ts 的 assistant 消息：全部上传（不只 last）
      const sid = getActiveSessionId()
      const token = getToken()
      if (sid && token) {
        for (const m of final) {
          if (m.role !== 'assistant' || m.ts !== assistantTs) continue
          uploadMessage(m)
        }
      }
      setStreaming(false)
      controllerRef.current = null
    }

    const finalize = () => {
      const raw = assistantText.current
      // 解析回复里的「【记忆】xxx」标记行，自动存进记忆库（去重、带来源、带主题）。
      // 有会话：写进当前会话记忆缓存（去重）+ 异步 postMemory 上传，失败留缓存不丢；
      // 无会话：写本地记忆库（原逻辑）
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
                  // 上传失败：记忆留在缓存（本地不丢），不打断聊天；记忆页能看到这条待上传的记忆
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
      // 人机味/编造质检：回复像客服（"我是AI"）或编造共同经历（"我们之前一起…"）→ 自动重写一次
      // 先剥掉【记忆】标记行（已存库），避免泄漏到聊天气泡（2026-08-25 真实用户反馈"记忆乱码"）
      const cleaned = stripActionMarkers(stripEmoji(stripMemoryMarkers(raw)))
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
              // ts 用 assistantTs（review3 新-10）：commitFinal 只上传 ts === assistantTs 的助手消息，
              // 之前这里用 Date.now() 导致重写/兜底回复永远不上云
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
      const final: StoredMessage[] = cleaned
        ? [...messages, userMsg, ...splitAssistantReplies(cleaned, assistantTs)]
        : [...messages, userMsg]
      commitFinal(final)
    }
    finalizeRef.current = finalize

    const controller = streamChat(settings, apiMessages, {
      onToken: (t) => {
        if (runId !== runIdRef.current) return
        assistantText.current += t
        // 流式过程中直接追加原文，不做清洗——避免每个 token 都对全文跑两次正则（O(n²) 卡顿）。
        // 最终清洗在 finalize 里统一做一次，用户看到的最终结果是干净的。
        // 流式显示也按行拆多条气泡（微信式）；没换行时是单条；剥记忆标记行（不泄漏到气泡）
        const splits = splitAssistantReplies(stripMemoryMarkers(assistantText.current), assistantTs)
        setMessages([...messages, userMsg, ...splits])
      },
      onDone: () => {
        if (runId !== runIdRef.current) return
        finalize()
      },
      onError: (err) => {
        if (runId !== runIdRef.current) return
        finalize()
        setError(err.message)
        setFailedText(userMsg.content)
      },
    })
    controllerRef.current = controller
  }, [messages, visibleMessages, streaming, persona, activeSession, activeSessionId, persistMessages, uploadMessage])

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

  // 关闭里程碑卡：标记已展示，之后不再弹
  const closeMilestone = () => {
    if (milestone) markMilestoneShown(milestone.day)
    setShowMilestone(false)
  }

  const isEmpty = visibleMessages.length === 0
  // 聊天背景（按会话）：有背景图就全屏铺，没有用默认
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
          visibleMessages.map((m, i) => (
            <MessageBubble
              key={i}
              message={m}
              typing={streaming && i === visibleMessages.length - 1 && m.role === 'assistant' && m.content === ''}
              onAvatarClick={onOpenProfile}
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

      {showMilestone && milestone && <MilestoneCard day={milestone.day} onClose={closeMilestone} />}
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
