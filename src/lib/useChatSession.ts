import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { StoredMessage, ContextUsageState } from './storage'
import type { Lang } from './langDetect'
import {
  getSessionStart,
  loadMessages,
  saveMessages,
  getContextCompactAt,
  getContextCompactSummary,
  getContextBridge,
  getContextUsage,
} from './storage'
import {
  getActiveSessionId,
  getBusyState,
  getMessagesCache,
  getPendingOps,
  markRead,
  saveBusyState,
  saveMessagesCache,
  saveSessionLang,
} from './sessionStore'
import { getSession, type Session } from './sessionApi'
import { getToken } from './auth'
import { cancelBusyReturn } from './busyReturn'
import { allowsBusyState, resolveIdentityMode } from './companionPolicy'
import { normalizeStaleReplyLifecycle, preserveReplyLifecycle } from './replyLifecycle'
import { mergeSessionMessages } from './sessionStore'
import {
  CONVERSATION_STATE_CHANGE_EVENT,
  getActiveConversationBranchCreatedAt,
  loadConversationState,
  resolveConversationMessages,
  type ConversationState,
} from './conversationState'
import { extractOpeningLine } from './customPersona'
import { filterSessionMessages } from './aiSpaceDetail'
import { collapseAdjacentDuplicateAssistantReplies } from './chatDisplay'
import { resolveChatLang } from './chatLang'
import { retryPendingMemoryUploads } from './memoryUploadRetry'
import { enqueueSessionMessageCommits } from './sessionMessageQueue'
import { flushPendingOpsSnapshot } from './pendingReplay'
import type { MessageQuote } from './messageQuote'
import type { MemoryCorrectionTarget } from './memoryCorrection'
import { loadPendingMemoryCorrection } from './memoryCorrection'

/**
 * 第三组拆分：会话装载与切换（第二轮拆分第 2 组）。
 * 只搬结构，不改逻辑：activeSession / conversationState 状态、
 * activeMessages / visibleMessages / displayMessages 三个 useMemo、
 * refreshSessionMessages 与其用到的 memoryRetryInFlightRef / sessionRecoveryInFlightRef、
 * 会话切换时的装载与落盘时序、会话语言判定结果落盘。
 * 跨组共享的状态（messages / 流式域 refs / 忙碌域依赖 / 切会话重置用 setter）一律留在
 * Chat.tsx，以入参传进本 hook；后续组（3/4/5/6/7）搬走对应状态后本 hook 的入参逐步缩小。
 */
export function useChatSession(options: {
  activeSessionId: string | null
  messages: StoredMessage[]
  setMessages: Dispatch<SetStateAction<StoredMessage[]>>
  // 恢复链路依赖（refreshSessionMessages / runSessionRecovery 使用）—— 本组只引用不改
  mountedRef: { current: boolean }
  streamingRef: { current: boolean }
  // 忙碌恢复补发 return 时需要当前 runId（流中断 effect 已先 +1）—— 本组只引用不改
  runIdRef: { current: number }
  // 忙碌域依赖 —— 第 4 组搬走后移除
  busyTimerRef: { current: number | null }
  sendBusyReturnRef: { current: (runId: number, sid: string, state: import('./aiBusy').BusyState) => Promise<void> }
  setIsBusy: (value: boolean) => void
  // 切会话状态重置 setter —— 后续组（3/5/6/7）搬走后移除
  failedReplyRetryRef: { current: (() => void) | null }
  setFailedReplyRetryAvailable: (value: boolean) => void
  setRecoveryDismissedTs: (value: number | null) => void
  setError: (value: string | null) => void
  setFailedText: (value: string | null) => void
  setQuoteDraft: (value: MessageQuote | null) => void
}) {
  const {
    activeSessionId,
    messages,
    setMessages,
    mountedRef,
    streamingRef,
    runIdRef,
    busyTimerRef,
    sendBusyReturnRef,
    setIsBusy,
    failedReplyRetryRef,
    setFailedReplyRetryAvailable,
    setRecoveryDismissedTs,
    setError,
    setFailedText,
    setQuoteDraft,
  } = options

  const [conversationState, setConversationState] = useState<ConversationState | null>(() =>
    activeSessionId ? loadConversationState(activeSessionId) : null,
  )
  const [activeSession, setActiveSession] = useState<Session | null>(null)

  // 刷新对话只推进当前 session 的上下文分界线；历史仍完整保留。
  const sessionStart = getSessionStart(activeSessionId || undefined)
  // 新 branch 创建后，旧 branch 生成的 Compact/Bridge/Meter 都不能继续注入。
  const conversationBranchBoundary = getActiveConversationBranchCreatedAt(conversationState)
  const contextBoundary = Math.max(sessionStart, conversationBranchBoundary)

  // Context：session 级状态。退出聊天 / 页面刷新不清零；sessionStart 或 active branch 变化都会进入新上下文段。
  const [contextMeter, setContextMeter] = useState<ContextUsageState | null>(() => {
    if (!activeSessionId) return null
    const stored = getContextUsage(activeSessionId)
    return stored && stored.sessionStart === sessionStart && stored.updatedAt >= contextBoundary ? stored : null
  })
  // Compact：用户主动「压缩」→ 最多 1 次模型调用，把较老历史压成 summary；之后注入 = summary + recent raw。
  // 每会话最多压缩 1 次；原聊天记录绝不删除。summary 持久化，刷新后无需再调模型。
  const [compactDone, setCompactDone] = useState(() => {
    if (!activeSessionId) return false
    const compactedAt = getContextCompactAt(activeSessionId)
    return compactedAt > 0 && compactedAt >= contextBoundary
  })
  const [compactSummary, setCompactSummary] = useState(() => {
    if (!activeSessionId) return ''
    const compactedAt = getContextCompactAt(activeSessionId)
    return compactedAt > 0 && compactedAt >= contextBoundary ? getContextCompactSummary(activeSessionId) : ''
  })
  // Bridge：用户主动「承接」→ 最多 1 次模型调用生成 evidence-only bridge，临时参与约 6–10 轮后退出。
  const [bridgeInfo, setBridgeInfo] = useState(() => {
    if (!activeSessionId) return null
    const stored = getContextBridge(activeSessionId)
    return stored && stored.bridgedAt >= contextBoundary ? stored : null
  })
  // contextBusy：防止 Compact / Bridge 的模型调用并发（每次最多 1 次）。
  const [contextBusy, setContextBusy] = useState<'compact' | 'bridge' | null>(null)
  const [contextNotice, setContextNotice] = useState<string | null>(null)
  const [pendingMemoryCorrection, setPendingMemoryCorrection] = useState<{ target: MemoryCorrectionTarget; value: string } | null>(() =>
    activeSessionId ? loadPendingMemoryCorrection(activeSessionId, sessionStart, getToken() ?? '') : null,
  )
  const [memoryCorrectionBusy, setMemoryCorrectionBusy] = useState(false)
  const [memoryCorrectionNotice, setMemoryCorrectionNotice] = useState<string | null>(null)

  // messages 始终保留完整 raw 历史；只有 activeMessages 参与显示/上下文。
  const activeMessages = useMemo(
    () => resolveConversationMessages(conversationState, messages),
    [conversationState, messages],
  )
  const visibleMessages = useMemo(
    () => filterSessionMessages(activeMessages, sessionStart),
    [activeMessages, sessionStart],
  )
  // 只在展示层合并“同一生成批次内、相邻、内容完全相同”的 TA 气泡；底层历史/上传/上下文一律不改。
  const displayMessages = useMemo(
    () => collapseAdjacentDuplicateAssistantReplies(visibleMessages),
    [visibleMessages],
  )

  useEffect(() => {
    const refreshConversationState = (event: Event) => {
      const sid = (event as CustomEvent<{ sessionId?: string }>).detail?.sessionId
      if (!activeSessionId || (sid && sid !== activeSessionId)) return
      setConversationState(loadConversationState(activeSessionId))
    }
    window.addEventListener(CONVERSATION_STATE_CHANGE_EVENT, refreshConversationState)
    return () => window.removeEventListener(CONVERSATION_STATE_CHANGE_EVENT, refreshConversationState)
  }, [activeSessionId])

  useEffect(() => {
    // 切会话 / 刷新当前上下文段：上一轮失败的“重试”立即失效。
    failedReplyRetryRef.current = null
    setFailedReplyRetryAvailable(false)
    setRecoveryDismissedTs(null)
    setError(null)
    setFailedText(null)
    setQuoteDraft(null)
    if (!activeSessionId) {
      setCompactDone(false)
      setCompactSummary('')
      setBridgeInfo(null)
      setContextMeter(null)
      setContextNotice(null)
      setContextBusy(null)
      setPendingMemoryCorrection(null)
      setMemoryCorrectionBusy(false)
      setMemoryCorrectionNotice(null)
      return
    }
    const compactedAt = getContextCompactAt(activeSessionId)
    const compactIsCurrent = compactedAt > 0 && compactedAt >= contextBoundary
    setCompactDone(compactIsCurrent)
    setCompactSummary(compactIsCurrent ? getContextCompactSummary(activeSessionId) : '')
    const storedBridge = getContextBridge(activeSessionId)
    setBridgeInfo(storedBridge && storedBridge.bridgedAt >= sessionStart ? storedBridge : null)
    const storedUsage = getContextUsage(activeSessionId)
    setContextMeter(storedUsage && storedUsage.sessionStart === sessionStart && storedUsage.updatedAt >= contextBoundary ? storedUsage : null)
    setContextNotice(null)
    setContextBusy(null)
    setPendingMemoryCorrection(loadPendingMemoryCorrection(activeSessionId, sessionStart, getToken() ?? ''))
    setMemoryCorrectionBusy(false)
    setMemoryCorrectionNotice(null)
  }, [activeSessionId, sessionStart, contextBoundary])

  // 切会话 / 刷新上下文：装载新会话消息（缓存读取 → normalize → 落盘 → 状态装载），
  // 然后恢复忙碌状态（只有沉浸档允许恢复；自然 / AI 遇到旧 busy 立即取消，避免模式切换后继续“闭嘴”）。
  // 注意：同一提交内「流中断收口」（runId++ / abort / finalize / timer 清理）仍在 Chat.tsx 的原
  // effect 中先执行（流式 / engine 域，后续组处理）；本 effect 只负责会话域的装载与忙碌恢复。
  useEffect(() => {
    const cachedMessages = activeSessionId ? getMessagesCache(activeSessionId) : loadMessages()
    const normalizedReply = normalizeStaleReplyLifecycle(cachedMessages, activeSessionId || null)
    if (normalizedReply.changed) {
      if (activeSessionId) saveMessagesCache(activeSessionId, normalizedReply.messages)
      else saveMessages(normalizedReply.messages)
    }
    setMessages(normalizedReply.messages)
    setConversationState(activeSessionId ? loadConversationState(activeSessionId) : null)
    setActiveSession(null)
    if (activeSessionId) markRead(activeSessionId)
    // 恢复忙碌状态：只有沉浸档允许恢复；自然 / AI 遇到旧 busy 立即取消，避免模式切换后继续“闭嘴”。
    if (activeSessionId) {
      const state = getBusyState(activeSessionId)
      if (!allowsBusyState(resolveIdentityMode(activeSessionId)) && state.status === 'busy') {
        cancelBusyReturn(activeSessionId, state, { saveState: saveBusyState, onIdle: () => setIsBusy(false) })
        setIsBusy(false)
      } else if (state.status === 'busy' && state.busyUntil > 0) {
        if (Date.now() >= state.busyUntil && !state.returnSent) {
          // 忙碌已结束但没发回来的消息，补发
          setIsBusy(false)
          void sendBusyReturnRef.current(runIdRef.current, activeSessionId, state)
        } else if (Date.now() < state.busyUntil) {
          // 还在忙碌中，恢复定时器
          setIsBusy(true)
          const remaining = state.busyUntil - Date.now()
          const triggerRunId = runIdRef.current
          busyTimerRef.current = window.setTimeout(() => {
            setIsBusy(false)
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

  // P0-A：会话消息恢复只复用现有 session API + merge；不建第二套同步层。
  // 调用方保证先 flush pending 再 pull，避免“本机看见已发送、服务端还没收到”的窗口继续扩大。
  const refreshSessionMessages = useCallback(async (sessionId: string) => {
    const token = getToken()
    if (!token || !sessionId) return
    const res = await getSession(token, sessionId)
    if (!res.ok || !mountedRef.current || String(getActiveSessionId()) !== String(sessionId)) return
    const cloud: StoredMessage[] = res.data.messages
      .map((m) => ({ id: m.id, role: m.role, content: m.content, ts: Date.parse(m.createdAt), thinking: m.thinking }))
      .filter((m) => Number.isFinite(m.ts))
    const local = getMessagesCache(sessionId)
    const latestLocalUser = [...local].reverse().find((message) => message.role === 'user')
    const hasActiveLocalReply = Boolean(
      latestLocalUser &&
      (latestLocalUser.replyState === 'pending' || latestLocalUser.replyState === 'streaming'),
    )
    // pending / streaming 仍属于正在运行的本机 BYOK 请求，暂缓 pull，避免中途改写本轮基线。
    if (hasActiveLocalReply) {
      setActiveSession(res.data.session)
      setMessages(local)
      markRead(sessionId)
      return
    }
    // interrupted 已经收口，不能永久阻断 cloud refresh。先正常合并权威历史，
    // 再只按 id 或精确 role+ts+content 恢复本机中断标记；绝不按“唯一正文”猜身份。
    const interruptedLifecycle = local.filter((message) => message.replyState === 'interrupted')
    const merged = preserveReplyLifecycle(interruptedLifecycle, mergeSessionMessages(local, cloud))
    saveMessagesCache(sessionId, merged)
    setActiveSession(res.data.session)
    if (merged.length > 0) {
      setMessages(merged)
      markRead(sessionId)
      return
    }
    const opening = extractOpeningLine(res.data.session.persona)
    if (!opening) {
      setMessages([])
      markRead(sessionId)
      return
    }
    const firstMsg: StoredMessage = { role: 'assistant', content: opening, ts: Date.now() }
    saveMessagesCache(sessionId, [firstMsg])
    setMessages([firstMsg])
    markRead(sessionId)
  }, [])

  // #20 + P0-A：沿用同一 pending outbox。挂载/联网/回前台时先补传消息，再拉当前 session 收敛。
  // 不轮询；生成中的聊天不做 pull，避免把正在显示的流式占位覆盖掉。
  const memoryRetryInFlightRef = useRef<Set<string>>(new Set())
  const sessionRecoveryInFlightRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!activeSessionId) return

    const runMemoryRetry = async () => {
      const token = getToken()
      if (!token || memoryRetryInFlightRef.current.has(activeSessionId)) return
      memoryRetryInFlightRef.current.add(activeSessionId)
      try {
        await retryPendingMemoryUploads(token, activeSessionId)
      } finally {
        memoryRetryInFlightRef.current.delete(activeSessionId)
      }
    }

    const runSessionRecovery = async () => {
      const token = getToken()
      if (!token || sessionRecoveryInFlightRef.current.has(activeSessionId)) return
      sessionRecoveryInFlightRef.current.add(activeSessionId)
      try {
        const pendingSnapshot = getPendingOps()
        const pendingMessageSessionIds = pendingSnapshot.flatMap((op) =>
          op.type === 'message' && typeof op.sessionId === 'string' ? [op.sessionId] : [],
        )
        await enqueueSessionMessageCommits(
          [activeSessionId, ...pendingMessageSessionIds],
          () => flushPendingOpsSnapshot(token, pendingSnapshot),
        )
        if (!streamingRef.current) await refreshSessionMessages(activeSessionId)
      } finally {
        sessionRecoveryInFlightRef.current.delete(activeSessionId)
      }
    }

    void runSessionRecovery()
    void runMemoryRetry()

    const onOnline = () => {
      void runSessionRecovery()
      void runMemoryRetry()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void runSessionRecovery()
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [activeSessionId, refreshSessionMessages])

  // 会话语言判定结果落盘（TASK-ENGLISH-MODE）：判定函数在 src/lib/chatLang.ts，这里不重复实现。
  const persistChatLang = (args: {
    persona: string
    replayExistingUser: boolean
    visibleMessages: StoredMessage[]
    text: string
  }): Lang => {
    const lang = resolveChatLang({ persona: args.persona, replayExistingUser: args.replayExistingUser, roundVisibleMessages: args.visibleMessages, text: args.text })
    if (activeSessionId) saveSessionLang(activeSessionId, lang)
    if (activeSessionId) saveSessionLang(activeSessionId, lang)
    return lang
  }

  return {
    activeSession,
    conversationState,
    activeMessages,
    visibleMessages,
    displayMessages,
    refreshSessionMessages,
    persistChatLang,
    contextMeter,
    setContextMeter,
    compactDone,
    setCompactDone,
    compactSummary,
    setCompactSummary,
    bridgeInfo,
    setBridgeInfo,
    contextBusy,
    setContextBusy,
    contextNotice,
    setContextNotice,
    pendingMemoryCorrection,
    setPendingMemoryCorrection,
    memoryCorrectionBusy,
    setMemoryCorrectionBusy,
    memoryCorrectionNotice,
    setMemoryCorrectionNotice,
  }
}
