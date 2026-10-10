import {getToken} from '../lib/auth'
import {getAccount} from '../lib/sync'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {buildEstimatedContextState} from '../lib/contextMeterState'
import {createChatStreamEngineStream} from '../lib/chatStreamEngine'
import MessageBubble from './MessageBubble'
import {buildBusyReturnPrompt, buildSystemPrompt, chatCompletion, computeThinkDelayMs, flattenActionMarkersForGuard, looksEmbodiedSelfClaim, isThinkingUnsupported, stripActionMarkers, stripEmoji, stripTimeLabels, type ApiMessage, type ChatError} from '../lib/api'
import {cleanMemoryProtocolArtifacts, detectMemoryInstruction, detectPreferenceFact, detectScheduleFact, extractMemories, inferTopic, isMemoryRetort, isSimilarMemory, notifyMemoryUpdated, planMemoryWrites, stripMemoryKeyword, upsertMemoryItem, type ExplicitCandidate, type MemoryWriteResult, loadMemory, stripMemoryMarkers, stripThinkBlocks} from '../lib/memory'
import {getSessionStart, loadMessages, loadPersona, loadSettings, loadChatBg, saveMessages, saveSettings, setContextCompactAt, setContextCompactSummary, setContextBridge, setContextBridgeTurns, clearContextBridge, setContextUsage, clearContextUsage, type ReplyInterruptionReason, type StoredMessage, isActionNarrationEnabled, loadAIProfile} from '../lib/storage'
import {type ChatJumpTarget} from '../lib/chatJump'
import {useChatScroll} from '../lib/useChatScroll'
import {useChatSession} from '../lib/useChatSession'
import {useChatMessages} from '../lib/useChatMessages'
import {listMemories, postMemory, postMessage} from '../lib/sessionApi'
import {addPendingOp, confirmMessageInCache, getActiveSessionId, getBusyState, getMemoriesCache, getMessagesCache, getSessionsCache, markRead, mergeSessionMemories, newPendingOpId, reconcileMemoryCacheId, removePendingOp, saveBusyState, saveMemoriesCache, saveMessagesCache, sessionMemoryToItem, upsertMemoryCache, type PendingOp} from '../lib/sessionStore'
import {inferBusyReason, randomBusyDurationMs, serializeBusyContext, type BusyState} from '../lib/aiBusy'
import {busyCycleId, cancelBusyReturn, triggerBusyReturn} from '../lib/busyReturn'
import {busyReturnFallback, classifyAvailability, isGroundedBusyReturn, type AvailabilityDecision} from '../lib/availability'
import {commitPartialReply} from '../lib/partialReply'
import {findRecoverableReply, registerActiveReplyRun, setReplyLifecycle, unregisterActiveReplyRun} from '../lib/replyLifecycle'
import {getSessionPersona} from '../lib/taRuntime'

import {getEffectiveReplyLength} from '../lib/replyLength'
import {allowsBusyState, resolveIdentityMode} from '../lib/companionPolicy'
import {cleanAttributionArtifacts} from '../lib/promptAttribution'
import {ELUVIN_DATA_CHANGE, notifyDataChanged} from '../lib/dataChange'
import {buildCompactSource, COMPACT_KEEP_RECENT, BRIDGE_ACTIVE_TURNS, BRIDGE_INPUT_BUDGET, BRIDGE_TAIL_COUNT} from '../lib/contextComposer'


import {clearPendingMemoryCorrection, correctMemoryText, hasMemoryCorrectionMarker, looksLikeMemoryCorrectionIntent, refreshMemoryCorrectionTarget, stripMemoryCorrectionMarkers} from '../lib/memoryCorrection'
import {formatQuotedMessage, parseQuotedMessage, type MessageQuote, type MessageQuoteSpeaker, messageEvidenceText} from '../lib/messageQuote'
import {activateConversationBranch, branchIdForNewMessage, forkConversation, getActiveConversationBranchCreatedAt, loadConversationState, resolveConversationMessages, saveConversationState, type ConversationState} from '../lib/conversationState'
import {enqueueSessionMessageCommit} from '../lib/sessionMessageQueue'
import {appendMemoryAudit} from '../lib/memoryAudit'

/**
 * 历史时间锚必须稳定：同一条历史消息无论过几分钟再次发送，前缀都完全一致，
 * 让 provider 能复用「核心 system + 历史」这一大段前缀。当前时间另走动态 ContextBlock。
 */
import {type Lang} from '../lib/langDetect'
import {getSessionLang} from '../lib/sessionStore'
import {takeChatMessage} from '../lib/chatInject'
import {decodePersonaText} from '../lib/customPersona'
import {filterSessionMessages} from '../lib/aiSpaceDetail'
import {ensureMilestoneEvent, getMilestoneStatus, latestReachedMilestoneDay, markMilestoneShown} from '../lib/milestone'
import {recordChatTopic} from '../lib/chatTopics'
import MilestoneCard from './MilestoneCard'
import ChatReplyError from './ChatReplyError'
import {buildChatContextBlocks} from '../lib/chatContextBuild'
import ChatComposer from './ChatComposer'
import {hasBridgableHistory} from './ChatComposer'
import ChatMemoryCorrection from './ChatMemoryCorrection'
import ChatNotices from './ChatNotices'

/**
 * PR #99 Session Bridge：只承接“同一 session 刷新前”的历史。
 * sessionStart 是当前角色的上下文分界线，因此天然满足角色隔离；
 * 禁止再用可编辑 title/persona 去猜“是不是同一个 TA”。
 */
function cleanAssistantReplyBody(raw: string, lang: Lang, preserveActions: boolean): string {
  const base = stripEmoji(
    stripThinkBlocks(stripMemoryCorrectionMarkers(stripMemoryMarkers(raw)), lang),
  )
  return preserveActions
    ? cleanAttributionArtifacts(stripTimeLabels(base), lang).replace(/\s{2,}/g, ' ').trim()
    : stripActionMarkers(base, lang)
}

function guardAssistantReplyBody(raw: string, lang: Lang, preserveActions: boolean): string {
  const base = stripEmoji(
    stripThinkBlocks(stripMemoryCorrectionMarkers(stripMemoryMarkers(raw)), lang),
  )
  return preserveActions
    ? flattenActionMarkersForGuard(base, lang)
    : stripActionMarkers(base, lang)
}

interface Props {
  onGoSettings: () => void
  onGoGuide: () => void
  /** 点 TA 的头像 → 打开聊天头像资料卡 */
  onOpenProfile: () => void
  /** UI2-03B-1「看原对话」：Memory 传来的一次性 jump target（transient，不持久化） */
  pendingJump?: ChatJumpTarget | null
  /** 消费完成（成功滚动或失败提示）后由 App 清空 pending */
  onJumpConsumed?: () => void
  /** UI2-03B-1：失败提示由 App 持有（跨 remount / StrictMode 双跑存活并自行收尾），Chat 只渲染 */
  jumpNotice?: string | null
  /** UI2-03B-1：失败时上报提示文本，由 App 统一展示 */
  onJumpNotice?: (text: string) => void
}

export default function Chat({ onGoSettings, onGoGuide, onOpenProfile, pendingJump, onJumpConsumed, jumpNotice, onJumpNotice }: Props) {
  const activeSessionId = getActiveSessionId()

  // —— 第 3 组拆分：消息缓存与对账下沉 useChatMessages（本组只搬不改）——
  const { messages, setMessages, persistMessages, uploadMessage } = useChatMessages({ activeSessionId })
  const [input, setInput] = useState('')
  const [quoteDraft, setQuoteDraft] = useState<MessageQuote | null>(null)
  const [actionNarrationEnabled, setActionNarrationEnabledState] = useState(() => isActionNarrationEnabled())
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failedText, setFailedText] = useState<string | null>(null)
  // 仅内存态：只允许重试当前会话、当前页面生命周期、当前这一轮；绝不进 storage / cloud。
  const [failedReplyRetryAvailable, setFailedReplyRetryAvailable] = useState(false)
  const failedReplyRetryRef = useRef<null | (() => void)>(null)
  const [recoveryDismissedTs, setRecoveryDismissedTs] = useState<number | null>(null)
  const [branchActionNotice, setBranchActionNotice] = useState<{
    branchId: string
    previousBranchId: string
    text: string
  } | null>(null)
  const [hasKey] = useState(() => Boolean(loadSettings().apiKey))
  // 该模型不支持思考链：请求被服务商拒了以后由 modelChat 降级并通知，这里只负责显示一行灰字
  const [thinkingUnsupported, setThinkingUnsupported] = useState(() => isThinkingUnsupported(loadSettings()))
  const [isBusy, setIsBusy] = useState(false)
  const [milestone, setMilestone] = useState<{ day: number; hit: boolean; shown: boolean } | null>(null)
  const [showMilestone, setShowMilestone] = useState(false)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [contextDetailOpen, setContextDetailOpen] = useState(false)
  const contextMeterRef = useRef<HTMLDivElement>(null)

  // 点外部关闭用量浮层：与身份 / 模型胶囊同一套逻辑（原先只有 onBlur，点空白关不掉）
  useEffect(() => {
    if (!contextMenuOpen) return
    const closeOutside = (event: PointerEvent) => {
      if (!contextMeterRef.current?.contains(event.target as Node)) {
        setContextMenuOpen(false)
        setContextDetailOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [contextMenuOpen])
  // 切角色 / 刷新上下文后，Compact 与 Bridge 只能沿用当前 segment 之后生成的状态。
  // 旧 segment 的摘要/bridge 仍可保存在存储与云端，但绝不能重新注入到“重新开始”的上下文。
  useEffect(() => {
    const onThinkingUnsupported = () => setThinkingUnsupported(true)
    window.addEventListener('yiwem:thinking-unsupported', onThinkingUnsupported)
    return () => window.removeEventListener('yiwem:thinking-unsupported', onThinkingUnsupported)
  }, [])

  useEffect(() => {
    const refreshActionNarration = () => setActionNarrationEnabledState(isActionNarrationEnabled())
    window.addEventListener(ELUVIN_DATA_CHANGE, refreshActionNarration)
    return () => window.removeEventListener(ELUVIN_DATA_CHANGE, refreshActionNarration)
  }, [])


  const inputRef = useRef<HTMLTextAreaElement>(null)
  // UI2-03B-1：失败提示状态已上移到 App（Props.jumpNotice / onJumpNotice）——
  // Chat 不再本地持 notice state / timer：dev StrictMode 提前跑 cleanup 曾把 timer 清掉
  // 而 state 还在，导致提示永久驻留。现在提示由 App 持有并自行 2.6s 收尾。
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
  // Space-N1：只有正常完整结束（或同轮显式重试后正常结束）的回复，才可补成 USER+SELF 对话对。
  // Stop / 切模型中断 / 流式失败留下的 partial 仍可按既有规则落聊天历史，但绝不能冒充完整 Space 素材。
  const spacePairEligibleRef = useRef(false)
  const assistantText = useRef('')
  // 第27条：模型独立思考字段 reasoning_content 累积（DeepSeek/Qwen/Kimi/豆包等），finalize 时合并到 thinking
  const reasoningRef = useRef('')
  // 2026-09-14：生成中途关页面/切后台的兜底（七七实测「退出去再进来，回复没过来」）。
  // partialTsRef = 本轮 assistant 占位消息的 ts（null = 当前没有在生成的回复）；streamingRef 镜像 streaming state
  const partialTsRef = useRef<number | null>(null)
  const partialUserTsRef = useRef<number | null>(null)
  // 一轮生成的持久化 owner：页面当前切到哪个 TA 都不能改变这轮消息归属。
  const partialSessionIdRef = useRef<string | null>(null)
  const replyInterruptionReasonRef = useRef<ReplyInterruptionReason | null>(null)
  const streamingRef = useRef(false)
  // 忙碌状态相关 ref
  const busyTimerRef = useRef<number | null>(null)
  const busyTriggeredRef = useRef(false)
  const enterBusyRef = useRef<(sid: string | null, text: string, decision: AvailabilityDecision, contextMessages?: StoredMessage[]) => void>(() => {})
  const sendBusyReturnRef = useRef<(runId: number, sid: string, state: BusyState) => Promise<void>>(async () => {})
  // —— 第 2 组拆分：会话装载与切换下沉 useChatSession（本组只搬不改）——
  // 同一提交内「流中断收口」（runId++ / abort / finalize / timer 清理）仍在下方原 effect
  // 中先执行（流式 / engine 域，后续组处理）；hook 只负责会话域的装载与忙碌恢复。
  const { activeSession, conversationState, activeMessages, visibleMessages, displayMessages, persistChatLang, contextMeter, setContextMeter, compactDone, setCompactDone, compactSummary, setCompactSummary, bridgeInfo, setBridgeInfo, contextBusy, setContextBusy, contextNotice, setContextNotice, pendingMemoryCorrection, setPendingMemoryCorrection, memoryCorrectionBusy, setMemoryCorrectionBusy, memoryCorrectionNotice, setMemoryCorrectionNotice } = useChatSession({
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
  })
  const currentConversationBranchId = branchIdForNewMessage(conversationState)
  const persona = decodePersonaText(activeSession?.persona ?? loadPersona())
  // 刷新对话只推进当前 session 的上下文分界线；历史仍完整保留。
  const sessionStart = getSessionStart(activeSessionId || undefined)
  // 新 branch 创建后，旧 branch 生成的 Compact/Bridge/Meter 都不能继续注入。
  const conversationBranchBoundary = getActiveConversationBranchCreatedAt(conversationState)
  const contextBoundary = Math.max(sessionStart, conversationBranchBoundary)

  const recoverableReply = useMemo(() => findRecoverableReply(visibleMessages), [visibleMessages])
  const showReplyRecovery = Boolean(
    recoverableReply &&
    !failedReplyRetryAvailable &&
    recoveryDismissedTs !== recoverableReply.userMessage.ts,
  )

  // 第一组拆分：滚动与跳转（scrollRef / 跳转锚 refs / auto-scroll / jump 定位）下沉 useChatScroll。
  const { scrollRef, releaseJumpHold } = useChatScroll({
    visibleMessages,
    pendingJump: pendingJump ?? null,
    activeSessionId,
    onJumpConsumed,
    onJumpNotice,
  })

  // ---- 忙碌状态：进入忙碌 ----
  const enterBusy = (sid: string | null, triggerText: string, decision: AvailabilityDecision, contextMessages = visibleMessages) => {
    if (!sid || !allowsBusyState(resolveIdentityMode(sid))) return
    const duration = randomBusyDurationMs()
    const busyUntil = Date.now() + duration
    const reason = inferBusyReason(triggerText)
    const context = serializeBusyContext(contextMessages.slice(-3))
    const state: BusyState = {
      status: 'busy',
      busyUntil,
      busyStartedAt: Date.now(),
      retryCount: 0,
      busyReason: reason,
      busyContext: context,
      returnSent: false,
      activityOwner: 'SELF',
      triggerEvidence: decision.evidence,
    }
    saveBusyState(sid, state)
    setIsBusy(true)
    if (busyTimerRef.current !== null) {
      clearTimeout(busyTimerRef.current)
    }
    const triggerRunId = runIdRef.current
    busyTimerRef.current = window.setTimeout(() => {
      setIsBusy(false)
      void sendBusyReturnRef.current(triggerRunId, sid, state)
    }, duration)
  }
  enterBusyRef.current = enterBusy

  // ---- 忙碌状态：忙完回来自动发消息 ----
  const sendBusyReturn = async (_triggerRunId: number, sid: string, _snapshot: BusyState) => {
    if (!sid) return
    await triggerBusyReturn<string>(sid, {
      now: Date.now,
      getState: getBusyState,
      saveState: saveBusyState,
      isCurrent: (targetSid, cycleId) => {
        if (targetSid !== getActiveSessionId()) return false
        if (!allowsBusyState(resolveIdentityMode(targetSid))) return false
        if (!getSessionsCache().some((item) => String(item.id) === targetSid)) return false
        const latest = getBusyState(targetSid)
        return latest.status === 'busy' && !latest.returnSent && busyCycleId(targetSid, latest) === cycleId
      },
      schedule: (callback, delayMs) => {
        if (busyTimerRef.current !== null) window.clearTimeout(busyTimerRef.current)
        busyTimerRef.current = window.setTimeout(callback, delayMs)
        return busyTimerRef.current
      },
      generate: async (targetSid, state) => {
        const settings = loadSettings()
        if (!settings.apiKey || !settings.baseUrl || !settings.model) throw new Error('Busy Return model settings unavailable')
        const busyLang = getSessionLang(targetSid)
        const cachedSession = getSessionsCache().find((item) => String(item.id) === targetSid)
        if (!cachedSession) throw new Error('Busy Return session no longer exists')
        const sessionPersona = getSessionPersona(targetSid)
        const title = (cachedSession.title || '').trim()
        const nameForPrompt = !title || title === '新会话' || title === '我们的开始'
          ? loadAIProfile(targetSid).nickname
          : title
        const systemPrompt = buildSystemPrompt(sessionPersona, nameForPrompt, undefined, targetSid, busyLang)
        const cache = getMessagesCache(targetSid)
        const activeCache = resolveConversationMessages(loadConversationState(targetSid), cache)
        const tail = activeCache.slice(-3).map((message) => ({
          role: message.role,
          content: stripThinkBlocks(stripMemoryMarkers(message.content), busyLang),
        }))
        const latestContext = serializeBusyContext(tail) || state.busyContext
        const selfActivity = state.triggerEvidence || state.busyReason
        const busyPrompt = buildBusyReturnPrompt(state.busyReason, latestContext, busyLang, selfActivity)
        const content = await chatCompletion(settings, [
          { role: 'system', content: systemPrompt },
          { role: 'system', content: busyPrompt },
        ], { maxTokens: 150, temperature: 0.9 })
        const cleaned = stripActionMarkers(stripEmoji(stripThinkBlocks(stripMemoryMarkers(content), busyLang)), busyLang).trim()
        return isGroundedBusyReturn(cleaned, selfActivity) ? cleaned : busyReturnFallback(busyLang)
      },
      commit: async (targetSid, content) => {
        const latest = getBusyState(targetSid)
        if (targetSid !== getActiveSessionId() || latest.status !== 'busy') return 'cancelled-before-commit'
        const busyBranchId = branchIdForNewMessage(loadConversationState(targetSid))
        const msg: StoredMessage = {
          role: 'assistant',
          content,
          ts: Date.now(),
          ...(busyBranchId ? { conversationBranchId: busyBranchId } : {}),
        }
        const current = getMessagesCache(targetSid)
        const next = [...current, msg]
        saveMessagesCache(targetSid, next)
        const persisted = getMessagesCache(targetSid)
        if (!persisted.some((item) => item.role === 'assistant' && item.ts === msg.ts && item.content === msg.content)) return 'failed'

        const token = getToken()
        if (token) {
          // 最后一次 stale 检查必须发生在不可逆的远端写入之前。
          if (targetSid !== getActiveSessionId() || getBusyState(targetSid).status !== 'busy') {
            saveMessagesCache(targetSid, getMessagesCache(targetSid).filter((item) => !(item.ts === msg.ts && item.role === msg.role && item.content === msg.content)))
            return 'cancelled-before-commit'
          }
          const op: PendingOp = {
            id: newPendingOpId(), type: 'message', sessionId: targetSid,
            ...(msg.conversationBranchId ? { conversationBranchId: msg.conversationBranchId } : {}),
            payload: { role: msg.role, content: msg.content, thinking: '' }, ts: msg.ts,
          }
          addPendingOp(op)
          const response = await enqueueSessionMessageCommit(targetSid, async () => {
            // 等待同 session 前序提交期间状态可能已变化；不可逆 POST 前再做一次 stale check。
            if (targetSid !== getActiveSessionId() || getBusyState(targetSid).status !== 'busy') return null
            return postMessage(token, targetSid, { role: msg.role, content: msg.content })
          })
          if (!response) {
            removePendingOp(op.id)
            saveMessagesCache(targetSid, getMessagesCache(targetSid).filter((item) => !(item.ts === msg.ts && item.role === msg.role && item.content === msg.content)))
            return 'cancelled-before-commit'
          }
          if (!response.ok) {
            saveMessagesCache(targetSid, getMessagesCache(targetSid).filter((item) => !(item.ts === msg.ts && item.role === msg.role && item.content === msg.content)))
            return 'failed'
          }
          // response.ok=true 是不可逆 commit point：保留 A 的确认消息，不再用 active session/cancel 降级结果。
          removePendingOp(op.id)
          confirmMessageInCache(targetSid, op, response.data)
        }
        if (targetSid === getActiveSessionId() && mountedRef.current) {
          markRead(targetSid)
          setMessages(getMessagesCache(targetSid))
        }
        return 'committed'
      },
      onIdle: (targetSid) => {
        if (targetSid !== getActiveSessionId() || !mountedRef.current) return
        setIsBusy(false)
        if (busyTimerRef.current !== null) {
          window.clearTimeout(busyTimerRef.current)
          busyTimerRef.current = null
        }
      },
      onFailure: (_targetSid, error) => {
        console.warn('Busy Return attempt failed', error)
      },
    })
  }
  sendBusyReturnRef.current = sendBusyReturn

  // ---- 真人忙碌：沉浸档里消息照常收下，但 TA 暂时不回复；忙完后主动回来接上。 ----
  const handleBusySend = (text: string) => {
    const userMsg: StoredMessage = {
      role: 'user',
      content: text,
      ts: Date.now(),
      ...(currentConversationBranchId ? { conversationBranchId: currentConversationBranchId } : {}),
    }
    const next = [...messages, userMsg]
    persistMessages(activeSessionId || null, next)
    if (activeSessionId) void uploadMessage(activeSessionId, userMsg)
    setMessages(next)
    setInput('')
  }

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [input])

  useEffect(() => {
    runIdRef.current += 1
    if (partialUserTsRef.current != null && !finishedRef.current) {
      replyInterruptionReasonRef.current = 'session-switch'
      if (displayCleanRef.current) assistantText.current = displayCleanRef.current
      spacePairEligibleRef.current = false
      controllerRef.current?.abort()
      finalizeRef.current()
    } else {
      controllerRef.current?.abort()
    }
    if (thinkTimerRef.current !== null) {
      clearTimeout(thinkTimerRef.current)
      thinkTimerRef.current = null
    }
    if (busyTimerRef.current !== null) {
      clearTimeout(busyTimerRef.current)
      busyTimerRef.current = null
    }
  }, [activeSessionId])

  // 身份模式在聊天页内切换时即时收口 Busy：切到自然 / AI 立刻取消旧 cycle，不补发“忙完回来”。
  useEffect(() => {
    if (!activeSessionId) return
    const syncBusyWithIdentity = () => {
      if (allowsBusyState(resolveIdentityMode(activeSessionId))) return
      const state = getBusyState(activeSessionId)
      if (busyTimerRef.current !== null) {
        window.clearTimeout(busyTimerRef.current)
        busyTimerRef.current = null
      }
      if (state.status === 'busy') {
        cancelBusyReturn(activeSessionId, state, { saveState: saveBusyState, onIdle: () => setIsBusy(false) })
      } else {
        setIsBusy(false)
      }
    }
    window.addEventListener(ELUVIN_DATA_CHANGE, syncBusyWithIdentity)
    return () => window.removeEventListener(ELUVIN_DATA_CHANGE, syncBusyWithIdentity)
  }, [activeSessionId])

  // 记忆沿用原来的“进入当前聊天时拉一次”；P0-A 不扩大 Memory 同步行为。
  useEffect(() => {
    if (!activeSessionId) return
    const token = getToken()
    if (!token) return
    let cancelled = false
    listMemories(token, activeSessionId).then((res) => {
      if (cancelled || !res.ok) return
      const cloudMem = res.data.memories.map(sessionMemoryToItem)
      // 云端列表这次确实拉成功了：不在云端、又没有「还没传成功」标记的条目 = 在别的设备删过 → 本机也清掉（清前留底）
      const mergedMem = mergeSessionMemories(getMemoriesCache(activeSessionId), cloudMem, {
        purgeMissing: true,
        sessionId: activeSessionId,
      })
      saveMemoriesCache(activeSessionId, mergedMem)
    })
    return () => {
      cancelled = true
    }
  }, [activeSessionId])

  /**
   * 2026-09-14（七七实测：生成到一半退出去，回来那条回复凭空消失）：
   * 页面被关掉/切到后台时，把已经生成出来的半截回复先落库，再排进 pendingOps 待上传队列。
   * 关页面时来不及等网络，所以这里不直接发请求——Chat 挂载时的 flushPendingOps 会自动补传。
   * 监听器挂在 window（全局只留一份，后挂覆盖先挂）：离开聊天页之后才关页面也能兜住。
   */
  useEffect(() => {
    const commitPartialOnHide = (leaving: boolean) => {
      const ts = partialTsRef.current
      const userTs = partialUserTsRef.current
      if (ts == null || userTs == null || finishedRef.current) return
      const sid = partialSessionIdRef.current
      const raw = assistantText.current
      if (leaving) {
        // 页面真的要走了：这轮从此只能是 interrupted，不能把半截回复冒充 complete。
        replyInterruptionReasonRef.current = 'pagehide'
        unregisterActiveReplyRun(sid, userTs)
        const base = sid ? getMessagesCache(sid) : loadMessages()
        const interrupted = setReplyLifecycle(base, userTs, ts, 'interrupted', 'pagehide')
        if (sid) saveMessagesCache(sid, interrupted)
        else saveMessages(interrupted)
        // 先锁住本轮 owner，再清 ref 防重入。
        finishedRef.current = true
        streamingRef.current = false
        partialTsRef.current = null
        partialUserTsRef.current = null
        partialSessionIdRef.current = null
      }
      if (!raw || !raw.trim()) return
      const lang = sid ? getSessionLang(sid) : 'zh'
      const preserveActions = isActionNarrationEnabled()
      const guardText = guardAssistantReplyBody(raw, lang, preserveActions)
      const text = cleanAssistantReplyBody(raw, lang, preserveActions)
      const liveIdentityMode = resolveIdentityMode(sid || undefined)
      const partialAvailability = guardText ? classifyAvailability(guardText) : null
      const identityProblem = Boolean(
        guardText && (
          looksEmbodiedSelfClaim(guardText, liveIdentityMode) ||
          (!allowsBusyState(liveIdentityMode) && partialAvailability?.state === 'unavailable' && partialAvailability.owner === 'SELF')
        ),
      )
      // 后台/关页兜底也必须守身份边界：括号里的动作内容同样检查；违规 partial 宁可不落库、不进 pending upload。
      if (identityProblem || !text) return
      const partialReplyLength = sid
        ? getEffectiveReplyLength(getAccount()?.account ?? '', sid)
        : 'natural'
      const partialBranchId = sid ? branchIdForNewMessage(loadConversationState(sid)) : undefined
      const parts = commitPartialReply(
        sid,
        ts,
        text,
        leaving,
        partialReplyLength,
        partialBranchId,
        leaving
          ? { state: 'interrupted', reason: 'pagehide' }
          : { state: 'streaming' },
      )
      if (!parts.length) return
      if (leaving) window.dispatchEvent(new CustomEvent('yiwem:ai-reply-committed', { detail: { sid } }))
    }
    const w = window as unknown as Record<string, unknown>
    const prevPage = w.__yiwemHideCommit
    if (typeof prevPage === 'function') window.removeEventListener('pagehide', prevPage as EventListener)
    const prevVis = w.__yiwemVisCommit
    if (typeof prevVis === 'function') document.removeEventListener('visibilitychange', prevVis as EventListener)
    const onPageHide = (event: PageTransitionEvent) => {
      // BFCache 只是冻结同一个页面实例，返回时不会 remount；不能把仍在运行的回复永久锁成 finished。
      if (event.persisted) return
      commitPartialOnHide(true)
    }
    const onVisible = () => {
      // 只是切到后台：先把已生成的内容落本地兜住（不排队列、不打断正在跑的流）
      if (document.visibilityState === 'hidden') commitPartialOnHide(false)
    }
    w.__yiwemHideCommit = onPageHide
    w.__yiwemVisCommit = onVisible
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisible)
  }, [])


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

  // 第一批①：切模型串流 bug——保存模型设置=显式切换点，abort 旧请求+作废旧回调+半截话落库
  // 红线：只在显式切换点 abort（切模型/换角色/点停止），离开页面/切 tab 不中断（模块二别被拆）
  useEffect(() => {
    const onModelSettingsChanged = () => {
      runIdRef.current += 1
      if (thinkTimerRef.current !== null) {
        clearTimeout(thinkTimerRef.current)
        thinkTimerRef.current = null
      }
      replyInterruptionReasonRef.current = 'model-switch'
      controllerRef.current?.abort()
      if (displayCleanRef.current) assistantText.current = displayCleanRef.current
      spacePairEligibleRef.current = false
      // 已收到的半截话落库不丢
      finalizeRef.current()
    }
    window.addEventListener('model-settings-changed', onModelSettingsChanged)
    return () => window.removeEventListener('model-settings-changed', onModelSettingsChanged)
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

  // 卸载期间 TA 回复完成落库的广播（2026-09-05 夜乔修）：返回主界面再进来时，刷新缓存让那条回复显示出来
  useEffect(() => {
    const onCommitted = (e: Event) => {
      const sid = (e as CustomEvent).detail?.sid
      if (!sid) return
      if (String(getActiveSessionId()) !== String(sid)) return
      setMessages(getMessagesCache(sid))
    }
    window.addEventListener('yiwem:ai-reply-committed', onCommitted)
    return () => window.removeEventListener('yiwem:ai-reply-committed', onCommitted)
  }, [])

  useEffect(() => {
    const now = Date.now()
    const sid = getActiveSessionId() || undefined
    const st = getMilestoneStatus(now, sid)
    const reached = latestReachedMilestoneDay(st.day)
    if (reached) ensureMilestoneEvent(reached, now, sid)
    if (st.hit && !st.shown) {
      setMilestone(st)
      setShowMilestone(true)
    }
  }, [])

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

    const writeMemory = (content: string, opts: { source?: string; topic?: string; explicit?: boolean; taReply?: string } = {}): MemoryWriteResult => {
      const trimmed = cleanMemoryProtocolArtifacts(content)
      if (!trimmed) return { ok: false, created: false }
      // PATCH-01：source 保存完整真实用户原话——不再做 20 字截断，不摘要、不改写。
      // 空/纯空白时保持 undefined（旧数据兼容：无 source 不显示）。
      const snippet = opts.source?.trim() || undefined
      if (activeSessionId) {
        // 命中已有（含相似）→ 链路成功但不算新增：不提示「新记下」
        if (isSimilarMemory(getMemoriesCache(activeSessionId), trimmed)) return { ok: true, created: false }
        const token = getToken()
        const item = upsertMemoryCache(activeSessionId, trimmed, snippet, opts.topic, opts.explicit, opts.taReply)
        // 本地写失败（回读不一致）→ upsertMemoryCache 返回 null：不写云端、也不当作成功
        if (!item) return { ok: false, created: false }
        if (token) {
          postMemory(token, activeSessionId, {
            content: trimmed,
            ...(snippet ? { source: snippet } : {}),
            ...(opts.taReply?.trim() ? { taReply: opts.taReply.trim() } : {}),
          }).then((res) => {
            if (res.ok) reconcileMemoryCacheId(activeSessionId, item.id, res.data.id)
          })
        }
        notifyMemoryUpdated()
        return { ok: true, created: true }
      }
      if (isSimilarMemory(loadMemory(), trimmed)) return { ok: true, created: false }
      const beforeGlobal = loadMemory().length
      const afterGlobal = upsertMemoryItem(trimmed, snippet, opts.topic, opts.explicit, opts.taReply)
      notifyMemoryUpdated()
      // global 侧同样要确认真多了一条，而不是只看函数返回（写失败时返回的是未变更列表）
      return afterGlobal.length > beforeGlobal ? { ok: true, created: true } : { ok: false, created: false }
    }

    // TASK-MEM-DISTILL：本轮候选 + 模型 marker 统一归并写入。
    // 唯一写入出口：send 里不再抢先写；finalize / busy 截断 / 失败路径都从这里落库。
    // 同一轮绝不产生「原话 + 提炼」两条同义记忆（planMemoryWrites 内部归并 + 落库判重双保险）。
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

    if (!replayExistingUser) {
      recordChatTopic(
        text,
        activeSessionId || undefined,
        userMsg.ts,
        roundBranchId ?? conversationState?.activeBranchId ?? 'root',
      )
    }
    // TASK-MEM-DISTILL：本地显式检测先收集候选、不抢先写——等模型回复的【记忆】marker 到达后统一归并
    // （有 marker 对应 → 只写一条提炼版 explicit；无对应 marker → fallback 写本地候选；只有 marker → 保持 inferred）
    // 候选的 explicit 身份来自用户证据（用户明确说过），text 若被 marker 匹配则采用模型提炼 wording。
    const correctionIntent = !replayExistingUser && !pendingMemoryCorrection && looksLikeMemoryCorrectionIntent(text)
    const explicitCandidates: ExplicitCandidate[] = []
    const memInstr = detectMemoryInstruction(text)
    const isRetort = !replayExistingUser && !memInstr.isInstruction && isMemoryRetort(text)
    if (!replayExistingUser && memInstr.isInstruction) {
      const content = (memInstr.fact ?? stripMemoryKeyword(text)).trim()
      if (content.length >= 4) {
        explicitCandidates.push({ text: content, source: text, topic: inferTopic(content) })
      }
    }
    if (!replayExistingUser && explicitCandidates.length === 0) {
      const pref = detectPreferenceFact(text)
      if (pref) {
        explicitCandidates.push({ text: pref, source: text, topic: inferTopic(pref) })
      } else {
        // 作息自动记（2026-09-09 七七拍板）：稳定作息类（上晚班/几点上下班/几点睡）保底提取，补偏好正则的漏网
        const sched = detectScheduleFact(text)
        if (sched) {
          explicitCandidates.push({ text: sched, source: text, topic: '工作' })
        } else if (text.trim().length >= 1 && text.trim().length <= 8) {
        const prevAi = roundVisibleMessages.filter((m) => m.role === 'assistant').slice(-1)[0]
        const askText = prevAi ? stripMemoryMarkers(prevAi.content) : ''
        if (askText) {
          const askAsk = /(爱|喜欢|爱吃|爱喝|口味|喜欢什么|想要什么|想要|想去|想做什么|是什么|叫什么)[，,。.！!？?]|(告诉我|说说|讲讲).{0,10}(喜欢|想要|想去|想)/.test(askText)
          const short = text.trim()
          if (askAsk && short.length >= 1) {
            const fact = short.length <= 4 ? `喜欢${short}` : short
            // source 用户实际回答在前：writeMemory 的 20 字截断优先保住用户原话（TASK-MEM-DISTILL）
            explicitCandidates.push({
              text: fact,
              source: `我答：${text}${askText ? `\nTA问：${askText.slice(0, 30)}` : ''}`,
              topic: inferTopic(fact),
            })
          }
        }
      }
      }
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

    const {
      replyLength, allowActionNarration, apiMessages, correctionTargets, composed,
    } = buildChatContextBlocks({
      activeSession, activeSessionId, base, bridgeInfo, compactDone, compactSummary, contextBoundary,
      persona, lang, text, userMsg, roundVisibleMessages, replayExistingUser, correctionIntent, memInstr, isRetort,
    })
    // 上下文总量 = 刷新之后这一段（sessionStart 起）所有内容的 provider 口径估算；
    // 「本轮输入」仍是本轮 payload 的估算，两者分开显示。
    const estimatedContextState = buildEstimatedContextState({
      roundVisibleMessages,
      userMsg,
      sessionStart,
      hardBudget: composed.hardBudget,
      inputTokens: composed.totalTokens,
      now: Date.now(),
    })
    setContextMeter(estimatedContextState)
    if (activeSessionId) setContextUsage(estimatedContextState, activeSessionId)
    if (composed.overBudget) {
      // 当前用户消息 / 核心 system 本身已经放不进 64k：不静默裁用户原话，也不把超限请求发给 provider。
      // 用户消息已经正常落历史；这里只撤掉空 assistant 占位并结束本轮流式状态。
      replyInterruptionReasonRef.current = 'context-limit'
      const interrupted = setReplyLifecycle(replyBaseMessages, lifecycleUserTs, assistantTs, 'interrupted', 'context-limit')
      persistMessages(roundSessionId, interrupted)
      setMessages(interrupted)
      setStreaming(false)
      streamingRef.current = false
      unregisterActiveReplyRun(roundSessionId, lifecycleUserTs)
      partialTsRef.current = null
      partialUserTsRef.current = null
      partialSessionIdRef.current = null
      setError(lang === 'en' ? 'This message is too long for the current context. Please shorten it and send again.' : '这条消息加上当前上下文超过 64k，请缩短后再发。')
      return
    }
    // bridge 只临时参与：本轮真正纳入 payload 后递减轮次，归零后退出（记录保留，不再注入）。
    if (activeSessionId && bridgeInfo && bridgeInfo.turnsLeft > 0 && composed.includedBlockIds.includes('bridge')) {
      const nextTurns = bridgeInfo.turnsLeft - 1
      setContextBridgeTurns(activeSessionId, nextTurns)
      setBridgeInfo({ ...bridgeInfo, turnsLeft: nextTurns })
    }
    apiMessages.splice(0, apiMessages.length, ...composed.messages)

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
  }, [messages, activeMessages, visibleMessages, streaming, persona, activeSession, activeSessionId, isBusy, persistMessages, uploadMessage, bridgeInfo, compactDone, compactSummary, pendingMemoryCorrection, currentConversationBranchId])

  useEffect(() => {
    const injected = takeChatMessage()
    if (injected) send(injected)
  }, [send])

  // PR #99 Context Compact：用户主动压缩（每会话最多 1 次；已压缩则按钮置灰）。
  // 最多 1 次模型调用：把较老历史（COMPACT_KEEP_RECENT 之前的消息）压成 summary；
  // 之后上下文 = summary + 最近原始消息。原聊天记录（缓存/后端）绝不删除。
  // 普通聊天不自动调模型；失败可重试（不占用"最多 1 次"）。
  const handleCompact = async () => {
    if (!activeSessionId || compactDone || streaming || contextBusy) return
    const uiLang = getSessionLang(activeSessionId)
    const settings = loadSettings()
    if (!settings.apiKey || !settings.baseUrl || !settings.model) {
      setError('还没接上 TA，去「我的」页填一下 API Key 就能聊了')
      return
    }
    const base = visibleMessages
    if (base.length <= COMPACT_KEEP_RECENT) {
      setContextNotice(uiLang === 'en' ? 'The conversation is short enough — no need to compact.' : '对话还短，不需要压缩。')
      return
    }
    const cleanBody = (m: StoredMessage) =>
      m.role === 'assistant'
        ? cleanAttributionArtifacts(stripThinkBlocks(stripMemoryMarkers(m.content), uiLang), uiLang)
        : m.content
    const olderHistory: ApiMessage[] = base.slice(0, -COMPACT_KEEP_RECENT).map((m) => ({
      role: m.role,
      content: cleanBody(m),
    }))
    const compactSource = buildCompactSource(olderHistory)
    const olderLines = compactSource.map((m) => `${m.role === 'user' ? 'USER' : 'TA'}: ${m.content}`)
    if (olderLines.length === 0) {
      setContextNotice(uiLang === 'en' ? 'There is no safe earlier context to compact.' : '没有可安全压缩的更早上下文。')
      return
    }
    const compactBoundary = sessionStart
    const compactBranchId = conversationState?.activeBranchId ?? null
    const prompt =
      uiLang === 'en'
        ? 'Below is the earlier part of a conversation. Summarize ONLY what actually happened — main topics, decisions, the user\'s preferences/state, and anything the assistant (TA) explicitly promised. Do not invent, infer, or add anything not in the text. Keep it concise and neutral.\n\n' +
          olderLines.join('\n')
        : '以下是这段对话较早的部分。只总结真实发生的内容——聊了什么、有什么决定、用户的偏好/状态、TA 明确作出的承诺。不要编造、不要推断、不要添加文本里没有的内容。保持简洁中立。\n\n' +
          olderLines.join('\n')
    setContextBusy('compact')
    try {
      const summary = await chatCompletion(
        settings,
        [
          { role: 'system', content: prompt },
          { role: 'user', content: uiLang === 'en' ? 'Please compact the earlier part into a summary.' : '请把更早的部分压缩成摘要。' },
        ],
        { maxTokens: 700, temperature: 0.3 },
      )
      const trimmed = summary.trim()
      if (!trimmed) throw new Error('empty summary')
      // 请求期间如果刷新边界或 active branch 变化，旧段结果必须作废。
      if (getSessionStart(activeSessionId) !== compactBoundary) return
      if ((loadConversationState(activeSessionId)?.activeBranchId ?? null) !== compactBranchId) return
      setContextCompactSummary(trimmed, activeSessionId)
      setContextCompactAt(Date.now(), activeSessionId)
      notifyDataChanged()
      setCompactDone(true)
      setCompactSummary(trimmed)
      setContextNotice(uiLang === 'en' ? 'Compressed the earlier conversation into a summary.' : '已把更早的对话压缩成摘要。')
    } catch {
      setContextNotice(uiLang === 'en' ? 'Compaction failed. Try again.' : '压缩失败，请再试一次。')
    } finally {
      setContextBusy(null)
    }
  }

  // PR #99 Session Bridge：用户主动承接“同一角色刷新前”的上一段上下文（每次刷新后最多 1 次）。
  // 最多 1 次模型调用：只取 sessionStart 之前的有限聊天尾部（BRIDGE_TAIL_COUNT 条），
  // 生成 evidence-only bridge；绝不跨 session / 跨角色，也不写 Memory / Event。
  const handleBridge = async () => {
    if (!activeSessionId || bridgeInfo || streaming || contextBusy) return
    const uiLang = getSessionLang(activeSessionId)
    if (!hasBridgableHistory(activeMessages, sessionStart)) return
    const settings = loadSettings()
    if (!settings.apiKey || !settings.baseUrl || !settings.model) {
      setError('还没接上 TA，去「我的」页填一下 API Key 就能聊了')
      return
    }
    const tail = activeMessages.filter((message) => message.ts < sessionStart).slice(-BRIDGE_TAIL_COUNT)
    if (tail.length === 0) {
      setContextNotice(uiLang === 'en' ? 'There is no earlier context to bridge.' : '没有可承接的上一段对话。')
      return
    }
    const cleanBody = (m: StoredMessage) =>
      m.role === 'assistant'
        ? cleanAttributionArtifacts(stripThinkBlocks(stripMemoryMarkers(m.content), uiLang), uiLang)
        : m.content
    const bridgeHistory: ApiMessage[] = tail.map((m) => ({ role: m.role, content: cleanBody(m) }))
    const bridgeSource = buildCompactSource(bridgeHistory, BRIDGE_INPUT_BUDGET)
    if (bridgeSource.length === 0) {
      setContextNotice(uiLang === 'en' ? 'There is no safe earlier context to bridge.' : '没有可安全承接的上一段对话。')
      return
    }
    const lines = bridgeSource.map((m) => `${m.role === 'user' ? 'USER' : 'TA'}: ${m.content}`)
    const bridgeBoundary = sessionStart
    const bridgeBranchId = conversationState?.activeBranchId ?? null
    const prompt =
      uiLang === 'en'
        ? 'Below is the recent tail from before this same conversation was refreshed. Write a short evidence-only handover note covering: 1) what you two were talking about, 2) unfinished topics, 3) the user\'s current state, 4) any explicit promises the companion made, 5) necessary referents (who "he/she" means). Only state what is actually in the text. Never invent or infer. Keep it in plain concise notes.\n\n' +
          lines.join('\n')
        : '下面是这个同一会话刷新前最近的一小段对话。请写一份简短、仅基于事实的交接摘要，覆盖：1）你们刚才在聊什么 2）未完成的事项 3）用户当前状态 4）TA 已明确作出的承诺 5）必要指代（“他/她”指谁）。只写文本里确实出现的内容，禁止编造或推断。用简洁的要点书写。\n\n' +
          lines.join('\n')
    setContextBusy('bridge')
    try {
      const content = await chatCompletion(
        settings,
        [
          { role: 'system', content: prompt },
          { role: 'user', content: uiLang === 'en' ? 'Please write the handover note.' : '请写这份交接摘要。' },
        ],
        { maxTokens: 600, temperature: 0.3 },
      )
      const trimmed = content.trim()
      if (!trimmed) throw new Error('empty bridge')
      // Bridge 只属于发起请求时的刷新段 + active branch；任何一边变化都丢弃旧结果。
      if (getSessionStart(activeSessionId) !== bridgeBoundary) return
      if ((loadConversationState(activeSessionId)?.activeBranchId ?? null) !== bridgeBranchId) return
      const bridgedAt = Date.now()
      setContextBridge(activeSessionId, activeSessionId, trimmed, BRIDGE_ACTIVE_TURNS, bridgedAt)
      notifyDataChanged()
      setBridgeInfo({ fromSessionId: activeSessionId, bridgedAt, content: trimmed, turnsLeft: BRIDGE_ACTIVE_TURNS })
      setContextNotice(uiLang === 'en' ? 'Picked up where the conversation left off before refresh.' : '已接上刷新前的上一段对话。')
    } catch {
      setContextNotice(uiLang === 'en' ? 'Bridge failed. Try again.' : '承接失败，请再试一次。')
    } finally {
      setContextBusy(null)
    }
  }

  const invalidateDerivedContextForBranchChange = (sessionId: string) => {
    setContextCompactAt(0, sessionId)
    setContextCompactSummary('', sessionId)
    clearContextBridge(sessionId)
    clearContextUsage(sessionId, false)
    clearPendingMemoryCorrection(sessionId)
    setCompactDone(false)
    setCompactSummary('')
    setBridgeInfo(null)
    setContextMeter(null)
    setContextNotice(null)
    setContextMenuOpen(false)
    setContextDetailOpen(false)
    setPendingMemoryCorrection(null)
    setMemoryCorrectionNotice(null)
    notifyDataChanged()
  }

  const commitConversationBranchAction = (message: StoredMessage, reason: 'delete' | 'rollback') => {
    if (!activeSessionId || streaming || contextBusy || typeof message.id !== 'number') return
    const lastStable = [...activeMessages].reverse().find((item) => typeof item.id === 'number')
    const next = forkConversation(conversationState, activeSessionId, messages, {
      forkAfterMessageId: reason === 'rollback' ? message.id : (lastStable?.id ?? message.id),
      ...(reason === 'delete' ? { hideMessageIds: [message.id] } : {}),
      reason,
    })
    const created = next.branches[next.activeBranchId]
    if (!created?.parentBranchId) return
    saveConversationState(next)
    invalidateDerivedContextForBranchChange(activeSessionId)
    const actionLang = getSessionLang(activeSessionId)
    setBranchActionNotice({
      branchId: next.activeBranchId,
      previousBranchId: created.parentBranchId,
      text: actionLang === 'en'
        ? (reason === 'delete' ? 'Removed from this conversation' : 'Rewound to this message')
        : (reason === 'delete' ? '已从当前对话删除' : '已回溯到这里'),
    })
  }

  const replyFromExistingUserBranch = (
    next: ConversationState,
    sourceUserId: number,
    noticeText: string,
  ): boolean => {
    if (!activeSessionId) return false
    const created = next.branches[next.activeBranchId]
    if (!created?.parentBranchId) return false

    const branchMessages = resolveConversationMessages(next, messages)
    const branchVisibleMessages = filterSessionMessages(branchMessages, sessionStart)
    const branchUser = branchVisibleMessages.find(
      (message) => message.role === 'user' && message.id === sourceUserId,
    )
    if (!branchUser) return false

    const parsed = parseQuotedMessage(branchUser.content)
    const body = messageEvidenceText(branchUser.content)
    if (!body) return false

    saveConversationState(next)
    invalidateDerivedContextForBranchChange(activeSessionId)
    setBranchActionNotice({
      branchId: next.activeBranchId,
      previousBranchId: created.parentBranchId,
      text: noticeText,
    })
    send(body, parsed.quote, {
      userMessage: branchUser,
      visibleHistory: branchVisibleMessages,
      branchId: next.activeBranchId,
    })
    return true
  }

  const regenerationSourceUser = (assistant: StoredMessage): StoredMessage | null => {
    if (assistant.role !== 'assistant' || typeof assistant.id !== 'number') return null
    const index = visibleMessages.findIndex((message) => message.id === assistant.id)
    if (index <= 0) return null
    for (let cursor = index - 1; cursor >= 0; cursor--) {
      const candidate = visibleMessages[cursor]
      if (candidate.role === 'user' && typeof candidate.id === 'number') return candidate
    }
    return null
  }

  const commitConversationRegenerate = (assistant: StoredMessage) => {
    if (!activeSessionId || streaming || contextBusy || isBusy) return
    const sourceUser = regenerationSourceUser(assistant)
    if (!sourceUser || typeof sourceUser.id !== 'number') return

    const next = forkConversation(conversationState, activeSessionId, messages, {
      forkAfterMessageId: sourceUser.id,
      reason: 'regenerate',
    })
    const actionLang = getSessionLang(activeSessionId)
    replyFromExistingUserBranch(
      next,
      sourceUser.id,
      actionLang === 'en' ? 'Regenerating this reply' : '正在重新生成这条回复',
    )
  }

  const commitConversationEdit = (message: StoredMessage, nextBody: string) => {
    if (
      !activeSessionId ||
      streaming ||
      contextBusy ||
      message.role !== 'user' ||
      typeof message.id !== 'number'
    ) return

    const body = nextBody.trim()
    if (!body) return
    const parsed = parseQuotedMessage(message.content)
    const editedContent = parsed.quote ? formatQuotedMessage(parsed.quote, body) : body
    if (editedContent === message.content) return

    const next = forkConversation(conversationState, activeSessionId, messages, {
      forkAfterMessageId: message.id,
      contentOverrides: { [message.id]: editedContent },
      reason: 'edit',
    })
    const actionLang = getSessionLang(activeSessionId)
    replyFromExistingUserBranch(
      next,
      message.id,
      actionLang === 'en'
        ? 'Edited — regenerating the reply'
        : '已编辑，正在重新生成回复',
    )
  }

  const undoConversationBranchAction = () => {
    if (!activeSessionId || !branchActionNotice) return
    const current = loadConversationState(activeSessionId)
    if (!current || current.activeBranchId !== branchActionNotice.branchId) {
      setBranchActionNotice(null)
      return
    }
    if (!current.branches[branchActionNotice.previousBranchId]) {
      setBranchActionNotice(null)
      return
    }
    const restored = activateConversationBranch(current, branchActionNotice.previousBranchId)
    saveConversationState(restored)
    invalidateDerivedContextForBranchChange(activeSessionId)
    setBranchActionNotice(null)
  }

  useEffect(() => {
    if (!branchActionNotice || streaming) return
    const timer = window.setTimeout(() => setBranchActionNotice(null), 6000)
    return () => window.clearTimeout(timer)
  }, [branchActionNotice, streaming])

  const handleQuoteMessage = (text: string, speaker: MessageQuoteSpeaker) => {
    const clean = text.trim()
    if (!clean) return
    setQuoteDraft({ speaker, text: clean })
    window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true })
    })
  }

  const handleSaveMessageAsMemory = async (text: string): Promise<boolean> => {
    const sid = activeSessionId
    const token = getToken()
    // USER 引用块只是上下文，不是本轮新断言；手动存记忆只保存 message body/evidence。
    const clean = messageEvidenceText(String(text ?? '')).trim()
    if (!sid || !token || !clean) return false

    const current = getMemoriesCache(sid)
    if (isSimilarMemory(current, clean)) return true

    const res = await postMemory(token, sid, { content: clean, source: clean })
    if (!res.ok) return false

    const item = {
      ...sessionMemoryToItem(res.data),
      topic: inferTopic(clean),
      explicit: true,
    }
    const next = [item, ...current.filter((memory) => memory.id !== item.id)]
    if (!saveMemoriesCache(sid, next)) return false

    appendMemoryAudit({
      sessionId: sid,
      memoryKind: 'session',
      memoryId: item.id,
      action: 'create',
      after: item,
      source: 'manual-message',
    })
    notifyMemoryUpdated()
    return true
  }

  const insertActionNarration = () => {
    const el = inputRef.current
    const start = el?.selectionStart ?? input.length
    const end = el?.selectionEnd ?? start
    const selected = input.slice(start, end)
    const wrapped = `（${selected}）`
    const next = input.slice(0, start) + wrapped + input.slice(end)
    setInput(next)
    window.requestAnimationFrame(() => {
      const target = inputRef.current
      if (!target) return
      target.focus({ preventScroll: true })
      const cursor = selected ? start + wrapped.length : start + 1
      target.setSelectionRange(cursor, cursor)
    })
  }

  const handleContinueAfterInterruption = () => {
    if (!recoverableReply) return
    setRecoveryDismissedTs(recoverableReply.userMessage.ts)
    window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
  }

  const handleRetryInterruptedReply = () => {
    if (!recoverableReply || streaming || contextBusy || isBusy) return
    const sourceUser = recoverableReply.userMessage
    const sourceIndex = visibleMessages.findIndex((message) =>
      message.role === 'user' &&
      message.ts === sourceUser.ts &&
      message.content === sourceUser.content,
    )
    if (sourceIndex < 0) return
    const parsed = parseQuotedMessage(sourceUser.content)
    const body = messageEvidenceText(sourceUser.content)
    if (!body) return
    setRecoveryDismissedTs(sourceUser.ts)
    send(body, parsed.quote, {
      userMessage: sourceUser,
      visibleHistory: visibleMessages.slice(0, sourceIndex + 1),
      branchId: sourceUser.conversationBranchId ?? currentConversationBranchId ?? 'root',
    })
  }

  const handleSend = () => {    const text = input
    if (!text.trim() || streaming) return
    send(text, quoteDraft)
    // 移动端连续聊天：发送后保持 textarea 焦点，让软键盘像微信一样继续留在屏幕上。
    window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true })
    })
  }

  const handleStop = () => {
    runIdRef.current += 1
    if (thinkTimerRef.current !== null) {
      clearTimeout(thinkTimerRef.current)
      thinkTimerRef.current = null
    }
    replyInterruptionReasonRef.current = 'stop'
    controllerRef.current?.abort()
    if (displayCleanRef.current) assistantText.current = displayCleanRef.current
    spacePairEligibleRef.current = false
    // 注意：不在这里设 finishedRef，让 finalize 自己设防重入守卫
    // runId++ 已经能阻止 playTick 继续跑
    retriedRef.current = true
    finalizeRef.current()
  }

  const closeMilestone = () => {
    if (milestone) markMilestoneShown(milestone.day)
    setShowMilestone(false)
  }

  const confirmPendingMemoryCorrection = async () => {
    if (!pendingMemoryCorrection || memoryCorrectionBusy) return
    const freshTarget = refreshMemoryCorrectionTarget(pendingMemoryCorrection.target)
    if (!freshTarget) {
      setPendingMemoryCorrection(null)
      if (activeSessionId) clearPendingMemoryCorrection(activeSessionId)
      setMemoryCorrectionNotice('这条记忆已经发生变化，没有覆盖它。你可以再告诉 TA 一次。')
      return
    }
    setMemoryCorrectionBusy(true)
    setMemoryCorrectionNotice(null)
    try {
      const result = await correctMemoryText(freshTarget, pendingMemoryCorrection.value)
      if (!result.ok) {
        setMemoryCorrectionNotice(result.message)
        return
      }
      if (result.changed) {
        appendMemoryAudit({
          sessionId: freshTarget.kind === 'session' ? freshTarget.sessionId : '',
          memoryKind: freshTarget.kind,
          memoryId: result.item.id,
          action: 'edit',
          before: freshTarget.item,
          after: result.item,
          source: 'detail',
        })
      }
      notifyMemoryUpdated()
      setPendingMemoryCorrection(null)
      if (activeSessionId) clearPendingMemoryCorrection(activeSessionId)
      setMemoryCorrectionNotice(result.changed ? '已按你的确认纠正这条记忆。' : '这条记忆已经是这个内容了。')
    } finally {
      setMemoryCorrectionBusy(false)
    }
  }

  const rejectPendingMemoryCorrection = () => {
    if (memoryCorrectionBusy) return
    setPendingMemoryCorrection(null)
    if (activeSessionId) clearPendingMemoryCorrection(activeSessionId)
    setMemoryCorrectionNotice('没有修改记忆。')
  }

  const isEmpty = displayMessages.length === 0
  const chatUiLang = getSessionLang(activeSessionId || undefined)
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
            {displayMessages.map((m, i) => (
              <MessageBubble
                key={i}
                message={m}
                typing={streaming && i === displayMessages.length - 1 && m.role === 'assistant' && m.content === ''}
                onAvatarClick={onOpenProfile}
                onQuote={handleQuoteMessage}
                onSaveMemory={!streaming && !contextBusy && m.role === 'user'
                  ? () => handleSaveMessageAsMemory(m.content)
                  : undefined}
                onEdit={!streaming && !contextBusy && !isBusy && m.role === 'user' && typeof m.id === 'number'
                  ? (nextText) => commitConversationEdit(m, nextText)
                  : undefined}
                onRegenerate={!streaming && !contextBusy && !isBusy && regenerationSourceUser(m)
                  ? () => commitConversationRegenerate(m)
                  : undefined}
                onDelete={!streaming && !contextBusy && typeof m.id === 'number'
                  ? () => commitConversationBranchAction(m, 'delete')
                  : undefined}
                onRollback={!streaming && !contextBusy && typeof m.id === 'number' && m.id !== [...activeMessages].reverse().find((item) => typeof item.id === 'number')?.id
                  ? () => commitConversationBranchAction(m, 'rollback')
                  : undefined}
              />
            ))}
          </>
        )}
      </div>

      <ChatNotices
        jumpNotice={jumpNotice}
        branchActionNotice={branchActionNotice}
        onUndoBranchAction={undoConversationBranchAction}
        showReplyRecovery={showReplyRecovery}
        recoverableReply={recoverableReply}
        onContinue={handleContinueAfterInterruption}
        onRetryInterruptedReply={handleRetryInterruptedReply}
        streaming={streaming}
        contextBusy={contextBusy}
        isBusy={isBusy}
        lang={chatUiLang}
      />

      <ChatReplyError
        error={error}
        failedReplyRetryAvailable={failedReplyRetryAvailable}
        onRetryFailedReply={() => failedReplyRetryRef.current?.()}
        streaming={streaming}
        lang={chatUiLang}
        hasDoubao={Boolean(loadSettings().providers.volcengine?.apiKey)}
        onSwitchToDoubao={() => {
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

      <ChatMemoryCorrection
        pending={pendingMemoryCorrection}
        busy={memoryCorrectionBusy}
        notice={memoryCorrectionNotice}
        onReject={rejectPendingMemoryCorrection}
        onConfirm={() => void confirmPendingMemoryCorrection()}
      />

      <ChatComposer
        chatUiLang={chatUiLang}
        input={input}
        setInput={setInput}
        inputRef={inputRef}
        quoteDraft={quoteDraft}
        setQuoteDraft={setQuoteDraft}
        handleSend={handleSend}
        handleStop={handleStop}
        streaming={streaming}
        isBusy={isBusy}
        actionNarrationEnabled={actionNarrationEnabled}
        insertActionNarration={insertActionNarration}
        activeSessionId={activeSessionId}
        contextMeterRef={contextMeterRef}
        contextMeter={contextMeter}
        contextMenuOpen={contextMenuOpen}
        setContextMenuOpen={setContextMenuOpen}
        contextDetailOpen={contextDetailOpen}
        setContextDetailOpen={setContextDetailOpen}
        contextBusy={contextBusy}
        compactDone={compactDone}
        bridgeInfo={bridgeInfo}
        activeMessages={activeMessages}
        sessionStart={sessionStart}
        handleCompact={() => void handleCompact()}
        handleBridge={() => void handleBridge()}
        contextNotice={contextNotice}
        thinkingUnsupported={thinkingUnsupported}
      />

      {showMilestone && milestone && <MilestoneCard day={milestone.day} onClose={closeMilestone} />}
    </div>
  )
}
