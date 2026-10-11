// 第二轮拆分 · 第 8 组：send 编排壳下沉（只搬不改）
// 本文件把 Chat.tsx 的 send（原 423–757 行）整体搬为 useChatSendFlow：只留顺序编排，
// 记忆候选（chatMemoryCandidates）、payload 组装（chatPayload）、engine 启动为内部步骤。
// 轮次 owner 固定、废弃上一轮失败重试、busy 到期取消、真人忙碌只属沉浸档、runId 递增、
// regenerate 不重复建 Space pair、会话语言判定与落盘——全部与拆分前一致。
import {useCallback} from 'react'
import {computeThinkDelayMs} from '../lib/api'
import {formatQuotedMessage, type MessageQuote} from '../lib/messageQuote'
import {loadSettings, setContextUsage, type StoredMessage, type ContextBridgeState} from '../lib/storage'
import {getBusyState, saveBusyState} from '../lib/sessionStore'
import {cancelBusyReturn} from '../lib/busyReturn'
import {allowsBusyState, resolveIdentityMode} from '../lib/companionPolicy'
import {recordChatTopic} from '../lib/chatTopics'
import {registerActiveReplyRun, setReplyLifecycle, unregisterActiveReplyRun} from '../lib/replyLifecycle'
import {createChatStreamEngineStream} from '../lib/chatStreamEngine'
import type {ConversationState} from '../lib/conversationState'
import type {AvailabilityDecision} from '../lib/availability'
import type {MemoryCorrectionTarget} from '../lib/memoryCorrection'
import type {Session} from '../lib/sessionApi'
import type {Lang} from '../lib/langDetect'
import {cleanAssistantReplyBody, guardAssistantReplyBody, assembleChatPayload, applyContextOverBudget} from '../lib/chatPayload'
import {createWriteMemory, collectMemoryCandidates} from '../lib/chatMemoryCandidates'
import {extractMemories, planMemoryWrites, stripMemoryMarkers, stripThinkBlocks} from '../lib/memory'
import {cleanAttributionArtifacts} from '../lib/promptAttribution'
import {hasMemoryCorrectionMarker, stripMemoryCorrectionMarkers} from '../lib/memoryCorrection'

export interface UseChatSendFlowProps {
  // 数据 / state
  messages: StoredMessage[]
  setMessages: (messages: StoredMessage[]) => void
  visibleMessages: StoredMessage[]
  streaming: boolean
  persona: string
  activeSession: Session | null
  activeSessionId: string
  isBusy: boolean
  setIsBusy: (value: boolean) => void
  bridgeInfo: ContextBridgeState | null
  setBridgeInfo: (info: ContextBridgeState | null) => void
  compactDone: boolean
  compactSummary: string
  pendingMemoryCorrection: { target: MemoryCorrectionTarget; value: string } | null
  currentConversationBranchId: string | undefined
  conversationState: ConversationState | null
  sessionStart: number
  contextBoundary: number
  // setters
  setInput: (value: string) => void
  setQuoteDraft: (value: MessageQuote | null) => void
  setError: (value: string | null) => void
  setStreaming: (value: boolean) => void
  setFailedReplyRetryAvailable: (value: boolean) => void
  setFailedText: (value: string | null) => void
  setContextMeter: (state: ReturnType<typeof import('../lib/contextMeterState').buildEstimatedContextState>) => void
  setRecoveryDismissedTs: (value: number | null) => void
  setPendingMemoryCorrection: (value: { target: MemoryCorrectionTarget; value: string } | null) => void
  setMemoryCorrectionNotice: (value: string | null) => void
  // refs
  failedReplyRetryRef: { current: (() => void) | null }
  runIdRef: { current: number }
  retriedRef: { current: boolean }
  spacePairEligibleRef: { current: boolean }
  busyTriggeredRef: { current: boolean }
  assistantText: { current: string }
  reasoningRef: { current: string }
  partialTsRef: { current: number | null }
  partialUserTsRef: { current: number | null }
  partialSessionIdRef: { current: string | null }
  replyInterruptionReasonRef: { current: string | null }
  streamingRef: { current: boolean }
  enterBusyRef: { current: ((sid: string | null, text: string, decision: AvailabilityDecision, contextMessages?: StoredMessage[]) => void) | null }
  displayCleanRef: { current: string }
  finalizeRef: { current: (() => void) | null }
  finishedRef: { current: boolean }
  showLenRef: { current: number }
  tickPlayRef: { current: (() => void) | null }
  thinkTimerRef: { current: number | null }
  controllerRef: { current: AbortController | null }
  streamEndedRef: { current: boolean }
  streamErrorRef: { current: Error | null }
  pauseLeftRef: { current: number }
  mountedRef: { current: boolean }
  // 函数
  releaseJumpHold: () => void
  persistChatLang: (input: { persona: string; replayExistingUser: boolean; visibleMessages: StoredMessage[]; text: string }) => Lang
  persistMessages: (sessionId: string | null, messages: StoredMessage[]) => void
  uploadMessage: (sessionId: string | null, userMsg: StoredMessage, onConfirmed?: (confirmed: { id: number; ts: number }) => void) => Promise<void>
  handleBusySend: (text: string) => void
}

export function useChatSendFlow(props: UseChatSendFlowProps): { send: (raw: string, quote?: MessageQuote | null, existingRound?: { userMessage: StoredMessage; visibleHistory: StoredMessage[]; branchId: string }) => void } {
  const {
    messages, setMessages, visibleMessages, streaming, persona, activeSession, activeSessionId,
    isBusy, setIsBusy, bridgeInfo, setBridgeInfo, compactDone, compactSummary, pendingMemoryCorrection,
    currentConversationBranchId, conversationState, sessionStart, contextBoundary,
    setInput, setQuoteDraft, setError, setStreaming, setFailedReplyRetryAvailable, setFailedText,
    setContextMeter, setRecoveryDismissedTs, setPendingMemoryCorrection, setMemoryCorrectionNotice,
    failedReplyRetryRef, runIdRef, retriedRef, spacePairEligibleRef, busyTriggeredRef, assistantText, reasoningRef,
    partialTsRef, partialUserTsRef, partialSessionIdRef, replyInterruptionReasonRef, streamingRef,
    enterBusyRef, displayCleanRef, finalizeRef, finishedRef, showLenRef, tickPlayRef, thinkTimerRef,
    controllerRef, streamEndedRef, streamErrorRef, pauseLeftRef, mountedRef,
    releaseJumpHold, persistChatLang, persistMessages, uploadMessage, handleBusySend,
  } = props

  const send = useCallback((
    raw: string,
    quote: MessageQuote | null = null,
    existingRound?: {
      userMessage: StoredMessage
      visibleHistory: StoredMessage[]
      branchId: string
    },
  ) => {
    // UI2-03B-1：用户自己发了消息 → 立刻解除「看原对话」的跳转保护，恢复正常滚到底。
    // 必须在这里显式释放：不能靠 auto-scroll 里猜「最后一条是不是 user」——
    // 历史最后一条本来就常是 user，那样会在挂载瞬间误解除保护，把列表拉到底。
    releaseJumpHold()
    const text = raw.trim()
    if (!text || streaming) return
    const messageText = quote ? formatQuotedMessage(quote, text) : text
    const replayExistingUser = Boolean(existingRound)
    const roundVisibleMessages = existingRound?.visibleHistory ?? visibleMessages
    const roundBranchId = existingRound?.branchId ?? currentConversationBranchId
    // 轮次 owner 在发送瞬间固定；之后 UI 切会话/卸载都不能改变数据写入目标。
    const roundSessionId = activeSessionId || null
    // 新消息开始即废弃上一轮的失败重试；重试永远不能跨轮次存活。
    failedReplyRetryRef.current = null
    setFailedReplyRetryAvailable(false)

    // busy 已到期且 Return 尚未落地时，用户主动回来优先：取消旧 cycle，避免紧跟一条自动“回来”。
    if (activeSessionId && !isBusy) {
      const pendingBusy = getBusyState(activeSessionId)
      if (pendingBusy.status === 'busy' && !pendingBusy.returnSent) {
        cancelBusyReturn(activeSessionId, pendingBusy, { saveState: saveBusyState, onIdle: () => setIsBusy(false) })
      }
    }

    // 真人忙碌只属于沉浸档。自然 / AI 即使残留 isBusy，也立即回正常聊天路径。
    if (!replayExistingUser && isBusy && activeSessionId && allowsBusyState(resolveIdentityMode(activeSessionId))) {
      handleBusySend(messageText)
      setQuoteDraft(null)
      return
    }
    if (!replayExistingUser && isBusy) setIsBusy(false)

    let runId = ++runIdRef.current
    retriedRef.current = false
    // Regenerate reuses an existing user turn: never create a second Space pair for the same user evidence.
    spacePairEligibleRef.current = !replayExistingUser
    busyTriggeredRef.current = false

    const userMsg: StoredMessage = existingRound
      ? { ...existingRound.userMessage, replyState: 'pending', replyInterruptedReason: undefined }
      : {
          role: 'user',
          content: messageText,
          ts: Date.now(),
          replyState: 'pending',
          ...(roundBranchId ? { conversationBranchId: roundBranchId } : {}),
        }
    const rawWithUser = replayExistingUser
      ? setReplyLifecycle(messages, userMsg.ts, null, 'pending')
      : [...messages, userMsg]
    let replyBaseMessages = rawWithUser
    let lifecycleUserTs = userMsg.ts
    const initialConfirmedAssistantIds = new Set(
      rawWithUser
        .filter((message) => message.role === 'assistant' && typeof message.id === 'number')
        .map((message) => message.id as number),
    )
    const tagCurrentBranch = (message: StoredMessage): StoredMessage =>
      roundBranchId
        ? { ...message, conversationBranchId: roundBranchId }
        : message

    // TASK-ENGLISH-MODE：计算会话语言（人设优先，人设空看包含当前消息的最近5条用户消息），存 sessionStore
    const lang = persistChatLang({ persona, replayExistingUser, visibleMessages: roundVisibleMessages, text })

    const settings = loadSettings()
    if (!settings.apiKey || !settings.baseUrl || !settings.model) {
      setError('还没接上 TA，去「我的」页填一下 API Key 就能聊了')
      return
    }

    const writeMemory = createWriteMemory(activeSessionId)

    // TASK-MEM-DISTILL：本地显式检测先收集候选、不抢先写——等模型回复的【记忆】marker 到达后统一归并
    const { correctionIntent, explicitCandidates, memInstr, isRetort } = collectMemoryCandidates({
      text,
      replayExistingUser,
      pendingMemoryCorrection,
      roundVisibleMessages,
    })

    if (!replayExistingUser) {
      recordChatTopic(
        text,
        activeSessionId || undefined,
        userMsg.ts,
        roundBranchId ?? conversationState?.activeBranchId ?? 'root',
      )
    }

    const base = replayExistingUser ? roundVisibleMessages : [...roundVisibleMessages, userMsg]
    let assistantTs = Date.now()
    assistantText.current = ''
    reasoningRef.current = ''
    setMessages([...rawWithUser, tagCurrentBranch({ role: 'assistant', content: '', ts: assistantTs })])
    setInput('')
    setQuoteDraft(null)
    setError(null)
    setStreaming(true)
    setRecoveryDismissedTs(null)
    partialTsRef.current = assistantTs
    partialUserTsRef.current = lifecycleUserTs
    partialSessionIdRef.current = roundSessionId
    replyInterruptionReasonRef.current = null
    streamingRef.current = true
    registerActiveReplyRun(roundSessionId, lifecycleUserTs)

    if (roundSessionId) {
      // retry / reload recovery 只更新本地生命周期，不重复上传 user。
      persistMessages(roundSessionId, rawWithUser)
      if (!replayExistingUser) {
        void uploadMessage(roundSessionId, userMsg, (confirmed) => {
          const previousTs = lifecycleUserTs
          lifecycleUserTs = confirmed.ts
          // user POST 的 server createdAt 是后续 lifecycle 的稳定身份；只更新本轮闭包与缓存镜像，
          // 不改 sessionStore / merge / dedupe 链。
          replyBaseMessages = replyBaseMessages.map((message) =>
            message.role === 'user' && message.ts === previousTs && message.content === userMsg.content
              ? { ...message, id: confirmed.id, ts: confirmed.ts }
              : message
          )
          if (partialUserTsRef.current === previousTs) partialUserTsRef.current = confirmed.ts
          unregisterActiveReplyRun(roundSessionId, previousTs)
          if (!finishedRef.current) registerActiveReplyRun(roundSessionId, confirmed.ts)
        })
      }
    }

    const assembled = assembleChatPayload({
      activeSession,
      activeSessionId,
      base,
      bridgeInfo,
      compactDone,
      compactSummary,
      contextBoundary,
      persona,
      lang,
      text,
      userMsg,
      roundVisibleMessages,
      replayExistingUser,
      correctionIntent,
      memInstr,
      isRetort,
      sessionStart,
      setContextMeter,
      setContextUsage,
      setBridgeInfo,
    })
    const { composed, apiMessages, replyLength, allowActionNarration, correctionTargets } = assembled

    // TASK-MEM-DISTILL：本轮候选 + 模型 marker 统一归并写入（唯一写入出口；correctionTargets 运行时已就绪）
    const flushMemoryWrites = (rawText: string) => {
      if (replayExistingUser) return false
      // 纠正申请必须先经过用户确认；只要本轮存在可纠正目标，就禁止 fallback 新写一条矛盾 Memory。
      if ((correctionIntent && correctionTargets.size > 0) || hasMemoryCorrectionMarker(rawText)) return false
      if (explicitCandidates.length === 0 && !rawText) return
      const plans = planMemoryWrites(explicitCandidates, rawText ? extractMemories(rawText) : [], text)
      // 当轮 TA 回应短快照（仅追溯展示；去系统标记/思考链后截断，不整段复制聊天历史）
      const replySnapshot = rawText
        ? cleanAttributionArtifacts(
            stripMemoryCorrectionMarkers(stripMemoryMarkers(stripThinkBlocks(rawText, lang))),
            lang,
          ).trim().slice(0, 160) || undefined
        : undefined
      let created = false
      for (const p of plans) {
        const res = writeMemory(p.text, { source: p.source || text, topic: p.topic, explicit: p.explicit, taReply: replySnapshot })
        // 只要这一轮真实新增过 ≥1 条就给一次轻量成功反馈（不再要求必须 explicit）；去重命中 / 写失败都不算
        if (res.created) created = true
      }
      if (created) userMsg.memorySaved = true
      return created
    }

    if (composed.overBudget) {
      // 当前用户消息 / 核心 system 本身已经放不进 64k：不静默裁用户原话，也不把超限请求发给 provider。
      // 用户消息已经正常落历史；这里只撤掉空 assistant 占位并结束本轮流式状态。
      applyContextOverBudget({
        replyInterruptionReasonRef,
        replyBaseMessages,
        lifecycleUserTs,
        assistantTs,
        persistMessages,
        setMessages,
        setStreaming,
        streamingRef,
        unregisterActiveReplyRunFn: unregisterActiveReplyRun,
        roundSessionId,
        partialTsRef,
        partialUserTsRef,
        partialSessionIdRef,
        setError,
        lang,
      })
      return
    }

    const engine = createChatStreamEngineStream({
      activeSessionId,
      allowActionNarration,
      apiMessages,
      assistantText,
      assistantTs,
      busyTriggeredRef,
      cleanAssistantReplyBody,
      composed,
      controllerRef,
      correctionIntent,
      correctionTargets,
      displayCleanRef,
      enterBusyRef,
      failedReplyRetryRef,
      finalizeRef,
      finishedRef,
      flushMemoryWrites,
      guardAssistantReplyBody,
      initialConfirmedAssistantIds,
      lang,
      lifecycleUserTs,
      mountedRef,
      partialSessionIdRef,
      partialTsRef,
      partialUserTsRef,
      pauseLeftRef,
      persistMessages,
      quote,
      reasoningRef,
      replayExistingUser,
      replyBaseMessages,
      replyInterruptionReasonRef,
      replyLength,
      retriedRef,
      roundBranchId,
      roundSessionId,
      roundVisibleMessages,
      runId,
      runIdRef,
      sessionStart,
      setContextMeter,
      setError,
      setFailedReplyRetryAvailable,
      setFailedText,
      setMemoryCorrectionNotice,
      setMessages,
      setPendingMemoryCorrection,
      setQuoteDraft,
      setRecoveryDismissedTs,
      setStreaming,
      settings,
      showLenRef,
      spacePairEligibleRef,
      streamEndedRef,
      streamErrorRef,
      streamingRef,
      tagCurrentBranch,
      text,
      thinkTimerRef,
      tickPlayRef,
      uploadMessage,
      userMsg,
    })
    const thinkMs = computeThinkDelayMs(text.length)
    thinkTimerRef.current = window.setTimeout(engine.startStream, thinkMs)
  }, [messages, visibleMessages, streaming, persona, activeSession, activeSessionId, isBusy, persistMessages, uploadMessage, bridgeInfo, compactDone, compactSummary, pendingMemoryCorrection, currentConversationBranchId, releaseJumpHold, persistChatLang, handleBusySend, sessionStart, contextBoundary, conversationState, setMessages, setInput, setQuoteDraft, setError, setStreaming, setFailedReplyRetryAvailable, setFailedText, setContextMeter, setRecoveryDismissedTs, setPendingMemoryCorrection, setMemoryCorrectionNotice, setIsBusy, setBridgeInfo])

  return { send }
}
