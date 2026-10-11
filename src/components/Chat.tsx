import {getToken} from '../lib/auth'
import {getAccount} from '../lib/sync'
import {useEffect, useMemo, useRef, useState} from 'react'
import MessageBubble from './MessageBubble'
import {looksEmbodiedSelfClaim, isThinkingUnsupported, type ChatError} from '../lib/api'
import {inferTopic, isSimilarMemory, notifyMemoryUpdated} from '../lib/memory'
import {getSessionStart, loadMessages, loadPersona, loadSettings, loadChatBg, saveMessages, saveSettings, type ReplyInterruptionReason, type StoredMessage, isActionNarrationEnabled} from '../lib/storage'
import {type ChatJumpTarget} from '../lib/chatJump'
import {useChatScroll} from '../lib/useChatScroll'
import {useChatSession} from '../lib/useChatSession'
import {useChatMessages} from '../lib/useChatMessages'
import {useChatBusy} from '../lib/useChatBusy'
import {listMemories, postMemory} from '../lib/sessionApi'
import {getActiveSessionId, getMemoriesCache, getMessagesCache, mergeSessionMemories, saveMemoriesCache, saveMessagesCache, sessionMemoryToItem} from '../lib/sessionStore'
import {classifyAvailability} from '../lib/availability'
import {commitPartialReply} from '../lib/partialReply'
import {findRecoverableReply, setReplyLifecycle, unregisterActiveReplyRun} from '../lib/replyLifecycle'

import {getEffectiveReplyLength} from '../lib/replyLength'
import {allowsBusyState, resolveIdentityMode} from '../lib/companionPolicy'


import {clearPendingMemoryCorrection, correctMemoryText, refreshMemoryCorrectionTarget} from '../lib/memoryCorrection'
import {formatQuotedMessage, parseQuotedMessage, type MessageQuoteSpeaker, messageEvidenceText} from '../lib/messageQuote'
import {activateConversationBranch, branchIdForNewMessage, forkConversation, getActiveConversationBranchCreatedAt, loadConversationState, resolveConversationMessages, saveConversationState, type ConversationState} from '../lib/conversationState'
import {appendMemoryAudit} from '../lib/memoryAudit'

/**
 * 历史时间锚必须稳定：同一条历史消息无论过几分钟再次发送，前缀都完全一致，
 * 让 provider 能复用「核心 system + 历史」这一大段前缀。当前时间另走动态 ContextBlock。
 */
import {getSessionLang} from '../lib/sessionStore'
import {takeChatMessage} from '../lib/chatInject'
import {decodePersonaText} from '../lib/customPersona'
import {filterSessionMessages} from '../lib/aiSpaceDetail'
import MilestoneCard from './MilestoneCard'
import ChatReplyError from './ChatReplyError'
import ChatComposer from './ChatComposer'
import {useChatContextBlocks} from '../lib/useChatContextBlocks'
import {useChatSendFlow} from '../lib/useChatSendFlow'
import {cleanAssistantReplyBody, guardAssistantReplyBody} from '../lib/chatPayload'
import {useChatEvents} from '../lib/useChatEvents'
import {useChatComposer} from '../lib/useChatComposer'
import ChatMemoryCorrection from './ChatMemoryCorrection'
import ChatNotices from './ChatNotices'

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
  // —— 第 7 组拆分：输入区状态与设置读取下沉 useChatComposer（本组只搬不改）——
  const { input, setInput, quoteDraft, setQuoteDraft, actionNarrationEnabled, inputRef } = useChatComposer()
  // —— 第 2 组拆分：会话装载与切换下沉 useChatSession（本组只搬不改）——
  // 同一提交内「流中断收口」（runId++ / abort / finalize / timer 清理）仍在下方原 effect
  // 中先执行（流式 / engine 域，后续组处理）；hook 只负责会话域的装载。
  const { activeSession, conversationState, activeMessages, visibleMessages, displayMessages, persistChatLang, contextMeter, setContextMeter, compactDone, setCompactDone, compactSummary, setCompactSummary, bridgeInfo, setBridgeInfo, contextBusy, setContextBusy, contextNotice, setContextNotice, pendingMemoryCorrection, setPendingMemoryCorrection, memoryCorrectionBusy, setMemoryCorrectionBusy, memoryCorrectionNotice, setMemoryCorrectionNotice } = useChatSession({
    activeSessionId,
    messages,
    setMessages,
    mountedRef,
    streamingRef,
    failedReplyRetryRef,
    setFailedReplyRetryAvailable,
    setRecoveryDismissedTs,
    setError,
    setFailedText,
    setQuoteDraft,
  })
  // —— 第 6 组拆分：里程碑（Milestone）状态与挂载下沉 useChatEvents（本组只搬不改）——
  const { milestone, showMilestone, closeMilestone } = useChatEvents()
  // —— 第 4 组拆分：忙碌生命周期下沉 useChatBusy（进入 / 恢复 / 补发 return）——
  // 依赖 visibleMessages（enterBusy 默认上下文）、runIdRef（恢复补发 return 的 runId）、
  // mountedRef（commit / onIdle 的挂载判定）、setMessages（commit 落库后刷新消息状态）。
  // 身份切换收口 Busy 也随本组下沉。
  const { isBusy, setIsBusy, busyTimerRef, busyTriggeredRef, enterBusyRef } = useChatBusy({
    activeSessionId,
    visibleMessages,
    runIdRef,
    mountedRef,
    setMessages,
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



  const { send } = useChatSendFlow({
    messages,
    setMessages,
    visibleMessages,
    streaming,
    persona,
    activeSession,
    activeSessionId,
    isBusy,
    setIsBusy,
    bridgeInfo,
    setBridgeInfo,
    compactDone,
    compactSummary,
    pendingMemoryCorrection,
    currentConversationBranchId,
    conversationState,
    sessionStart,
    contextBoundary,
    setInput,
    setQuoteDraft,
    setError,
    setStreaming,
    setFailedReplyRetryAvailable,
    setFailedText,
    setContextMeter,
    setRecoveryDismissedTs,
    setPendingMemoryCorrection,
    setMemoryCorrectionNotice,
    failedReplyRetryRef,
    runIdRef,
    retriedRef,
    spacePairEligibleRef,
    busyTriggeredRef,
    assistantText,
    reasoningRef,
    partialTsRef,
    partialUserTsRef,
    partialSessionIdRef,
    replyInterruptionReasonRef,
    streamingRef,
    enterBusyRef,
    displayCleanRef,
    finalizeRef,
    finishedRef,
    showLenRef,
    tickPlayRef,
    thinkTimerRef,
    controllerRef,
    streamEndedRef,
    streamErrorRef,
    pauseLeftRef,
    mountedRef,
    releaseJumpHold,
    persistChatLang,
    persistMessages,
    uploadMessage,
    handleBusySend,
  })

  useEffect(() => {
    const injected = takeChatMessage()
    if (injected) send(injected)
  }, [send])

  const { handleCompact, handleBridge, invalidateDerivedContextForBranchChange } = useChatContextBlocks({
    activeSessionId,
    streaming,
    visibleMessages,
    activeMessages,
    sessionStart,
    conversationState,
    compactDone,
    bridgeInfo,
    contextBusy,
    setContextBusy,
    setContextNotice,
    setCompactDone,
    setCompactSummary,
    setBridgeInfo,
    setContextMeter,
    setPendingMemoryCorrection,
    setMemoryCorrectionNotice,
    setContextMenuOpen,
    setContextDetailOpen,
    setError,
  })

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
