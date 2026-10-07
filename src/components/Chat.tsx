import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import MessageBubble from './MessageBubble'
import { buildActionNarrationInstruction, buildBusyReturnPrompt, buildMemoryBlock, buildSystemPrompt, buildTimeContext, chatCompletion, computeThinkDelayMs, flattenActionMarkersForGuard, looksEmbodiedSelfClaim, looksFabricated, looksIdentityDisclosure, looksRobotic, looksRecoverableServiceStyle, streamChat, isThinkingUnsupported, stripActionMarkers, stripEmoji, stripTimeLabels, type ApiMessage, type ChatError } from '../lib/api'
import { deriveMemoryTriggerWords, detectMemoryInstruction, detectPreferenceFact, detectScheduleFact, extractMemories, extractThinkBlocks, inferTopic, isMemoryRetort, isSimilarMemory, loadMemory, notifyMemoryUpdated, planMemoryWrites, stripMemoryKeyword, stripMemoryMarkers, stripThinkBlocks, touchMemory, upsertMemoryItem, type ExplicitCandidate, type MemoryWriteResult } from '../lib/memory'
import { selectMemoryWorkingSet, shouldTouchMemoryFromUser } from '../lib/memoryRecallPolicy'
import { getSessionStart, isActionNarrationEnabled, loadMessages, loadPersona, loadSettings, loadAIProfile, loadUserProfile, loadChatBg, saveMessages, saveSettings, getContextCompactAt, setContextCompactAt, getContextCompactSummary, setContextCompactSummary, getContextBridge, setContextBridge, setContextBridgeTurns, clearContextBridge, getContextUsage, setContextUsage, clearContextUsage, type ContextUsageState, type ReplyInterruptionReason, type StoredMessage } from '../lib/storage'
import { verifyChatJumpTarget, type ChatJumpTarget } from '../lib/chatJump'
import { getToken } from '../lib/auth'
import { getAccount } from '../lib/sync'
import { getSession, listMemories, postMemory, postMessage, type Session } from '../lib/sessionApi'
import {
  addPendingOp,
  confirmMessageInCache,
  getActiveSessionId,
  getBusyState,
  getMemoriesCache,
  getMessagesCache,
  getPendingOps,
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
import { findBusyCutoff, inferBusyReason, randomBusyDurationMs, serializeBusyContext, type BusyState } from '../lib/aiBusy'
import { busyCycleId, cancelBusyReturn, triggerBusyReturn } from '../lib/busyReturn'
import { busyReturnFallback, classifyAvailability, isGroundedBusyReturn, type AvailabilityDecision } from '../lib/availability'
import { loadCurrentPosts } from '../lib/aiSpace'
import { buildSpacePostsBlock, personaHasLifeAnchors, LIFE_BASELINE, LIFE_BASELINE_EN } from '../lib/spaceChatInject'
import { commitPartialReply } from '../lib/partialReply'
import { findRecoverableReply, interruptionReasonFromError, normalizeStaleReplyLifecycle, preserveReplyLifecycle, registerActiveReplyRun, setReplyLifecycle, unregisterActiveReplyRun } from '../lib/replyLifecycle'
import { buildFutureAgendaBlock } from '../lib/futureAgenda'
import { buildYourMomentBlock, MOMENT_GUIDE_EN, MOMENT_GUIDE_ZH, shouldInjectYourMoment } from '../lib/yourMoment'
import { buildTaRuntimeContext, getOrAdvanceTaRuntime, getSessionPersona, shouldInjectTaRuntimeContext, syncTaRuntimeFromAssistantText } from '../lib/taRuntime'
import { buildIdentityContext } from '../lib/identityContext'
import { dropRepeatedReplies } from '../lib/replyDedupe'
import { collapseAdjacentDuplicateAssistantReplies } from '../lib/chatDisplay'
import { buildReplyLengthInstruction, getEffectiveReplyLength, splitDetailedAssistantReply } from '../lib/replyLength'
import { allowsBusyState, allowsEmbodiedLifeContext, buildIdentityBoundaryRepair, resolveIdentityMode } from '../lib/companionPolicy'
import { cleanAttributionArtifacts, cleanStreamingAttributionArtifacts, formatAttributedLine, hasAttributionLeak } from '../lib/promptAttribution'
import { retryPendingMemoryUploads } from '../lib/memoryUploadRetry'
import { ELUVIN_DATA_CHANGE, notifyDataChanged } from '../lib/dataChange'
import { composeContext, buildCompactedHistory, buildCompactSource, COMPACT_KEEP_RECENT, BRIDGE_ACTIVE_TURNS, BRIDGE_INPUT_BUDGET, BRIDGE_TAIL_COUNT, type ContextBlock } from '../lib/contextComposer'
import { estimateToken } from '../lib/token'
import { calibrateContextFactor, contentTokensOf, loadContextFactor, saveContextFactor, usageMessages } from '../lib/contextUsage'
import { buildUserWeatherContext, readUserWeatherContext } from '../lib/homeWeather'
import { clearPendingMemoryCorrection, correctMemoryText, extractMemoryCorrectionProposal, hasMemoryCorrectionMarker, loadPendingMemoryCorrection, looksLikeMemoryCorrectionIntent, refreshMemoryCorrectionTarget, savePendingMemoryCorrection, stripMemoryCorrectionMarkers, type MemoryCorrectionTarget } from '../lib/memoryCorrection'
import { formatQuotedMessage, messageEvidenceText, parseQuotedMessage, type MessageQuote, type MessageQuoteSpeaker } from '../lib/messageQuote'
import { CONVERSATION_STATE_CHANGE_EVENT, activateConversationBranch, branchIdForNewMessage, forkConversation, getActiveConversationBranchCreatedAt, loadConversationState, resolveConversationMessages, saveConversationState, type ConversationState } from '../lib/conversationState'
import { enqueueSessionMessageCommit, enqueueSessionMessageCommits } from '../lib/sessionMessageQueue'
import { flushPendingOpsSnapshot } from '../lib/pendingReplay'
import { appendMemoryAudit } from '../lib/memoryAudit'

/**
 * 历史时间锚必须稳定：同一条历史消息无论过几分钟再次发送，前缀都完全一致，
 * 让 provider 能复用「核心 system + 历史」这一大段前缀。当前时间另走动态 ContextBlock。
 */
function msgTimeMark(ts: number, _lang: Lang): string {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `[${yyyy}-${mm}-${dd} ${hh}:${min}] `
}
import { detectLang, type Lang } from '../lib/langDetect'
import { getSessionLang, saveSessionLang } from '../lib/sessionStore'
import { filterSessionMessages } from '../lib/aiSpaceDetail'
import { takeChatMessage } from '../lib/chatInject'
import { decodePersonaText, extractOpeningLine } from '../lib/customPersona'
import { ensureMilestoneEvent, getMilestoneStatus, latestReachedMilestoneDay, markMilestoneShown } from '../lib/milestone'
import { getWeeklyReviews } from '../lib/weeklyReview'
import { completeChatTopicPair, futureTopicsFromMessages, recordChatTopic } from '../lib/chatTopics'
import { getRecentEvents, formatEventDateShort } from '../lib/eventStore'
import { processEventCandidate } from '../lib/eventDetector'
import MilestoneCard from './MilestoneCard'
import ChatCompanionControls from './ChatCompanionControls'


/**
 * PR #99 Session Bridge：只承接“同一 session 刷新前”的历史。
 * sessionStart 是当前角色的上下文分界线，因此天然满足角色隔离；
 * 禁止再用可编辑 title/persona 去猜“是不是同一个 TA”。
 */
function hasBridgableHistory(messages: StoredMessage[], sessionStart: number): boolean {
  return sessionStart > 0 && messages.some((message) => message.ts < sessionStart)
}

function formatTokenCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—'
  if (value < 1000) return String(Math.round(value))
  const compact = value >= 10000 ? (value / 1000).toFixed(0) : (value / 1000).toFixed(1)
  return `${compact.replace(/\.0$/, '')}k`
}

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

const SendArrowIcon = () => (  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.1"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4.5 16.2c3.2 2.4 6.8 1.9 9.3-.6 2.5-2.5 3.6-5.8 5.7-9.7" />
    <path d="M13.1 7.1l6.4-1.2-1.3 6.2" />
  </svg>
)

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

// UI2-03B-1：「看原对话」跳转保护窗口（模块级时间戳）——
// dev StrictMode 会模拟卸载/重挂载，组件内 ref 快照会被重置成 false，
// 于是 auto-scroll 立刻把列表拉回底部、覆盖 jump 的第一帧定位。
// 模块级时间戳不受 remount 影响；用户发消息时由 releaseJumpHold 立刻清掉。
let chatJumpHoldUntil = 0
const markChatJumpHold = (ms: number) => {
  chatJumpHoldUntil = Date.now() + ms
}
const isChatJumpHolding = () => Date.now() < chatJumpHoldUntil
const clearChatJumpHold = () => {
  chatJumpHoldUntil = 0
}

export default function Chat({ onGoSettings, onGoGuide, onOpenProfile, pendingJump, onJumpConsumed, jumpNotice, onJumpNotice }: Props) {
  const activeSessionId = getActiveSessionId()

  const [messages, setMessages] = useState<StoredMessage[]>(() =>
    activeSessionId ? getMessagesCache(activeSessionId) : loadMessages(),
  )
  const [conversationState, setConversationState] = useState<ConversationState | null>(() =>
    activeSessionId ? loadConversationState(activeSessionId) : null,
  )
  const currentConversationBranchId = branchIdForNewMessage(conversationState)
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
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const persona = decodePersonaText(activeSession?.persona ?? loadPersona())
  const [milestone, setMilestone] = useState<{ day: number; hit: boolean; shown: boolean } | null>(null)
  const [showMilestone, setShowMilestone] = useState(false)
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
  const recoverableReply = useMemo(() => findRecoverableReply(visibleMessages), [visibleMessages])
  const showReplyRecovery = Boolean(
    recoverableReply &&
    !failedReplyRetryAvailable &&
    recoveryDismissedTs !== recoverableReply.userMessage.ts,
  )
  // 只在展示层合并“同一生成批次内、相邻、内容完全相同”的 TA 气泡；底层历史/上传/上下文一律不改。
  const displayMessages = useMemo(
    () => collapseAdjacentDuplicateAssistantReplies(visibleMessages),
    [visibleMessages],
  )

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
  // UI2-03B-1：jump effect 只依赖 pendingJump/session，消息列表通过 ref 读取最新值 ——
  // 这样消息每次更新都不会重跑 jump effect（否则 cleanup 会把跳转保护窗口的定时器提前清掉）
  const visibleMessagesRef = useRef(visibleMessages)
  visibleMessagesRef.current = visibleMessages

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // UI2-03B-1：pending jump 时让 scroll-bottom 让位一次（不能先滚到底再跳，也不能跳完被拉回）
  const jumpSuppressRef = useRef(false)
  // UI2-03B-1：本次 mount 是否带 pending jump —— 挂载时快照，保证「第一次 scroll-bottom」就让位
  // （auto-scroll effect 声明在 jump effect 之前，靠 jumpSuppressRef 来不及）
  const jumpAtMountRef = useRef(Boolean(pendingJump))
  // UI2-03B-1：跳转保护窗口。跳完立即放开会被同帧/随后的异步更新（busy 状态、云端消息合并）再次拉到底，
  // 所以跳转成功后保持保护，直到用户自己发了消息或窗口超时（2.5s）自动解除。
  const jumpHoldRef = useRef(Boolean(pendingJump))
  const jumpHoldTimerRef = useRef<number | null>(null)
  const releaseJumpHold = () => {
    jumpHoldRef.current = false
    clearChatJumpHold()
    if (jumpHoldTimerRef.current !== null) {
      window.clearTimeout(jumpHoldTimerRef.current)
      jumpHoldTimerRef.current = null
    }
  }
  // 防重复消费同一 pending target（StrictMode 双跑 / deps 抖动时只处理一次）
  const jumpHandledRef = useRef(false)
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

  const persistMessages = useCallback((sid: string | null, msgs: StoredMessage[]) => {
    if (sid) {
      saveMessagesCache(sid, msgs)
      // 数据 owner 由 sid 决定；“已读”只属于此刻仍在看的会话。
      if (sid === getActiveSessionId()) markRead(sid)
    } else {
      saveMessages(msgs)
    }
  }, [])

  const uploadMessage = useCallback((
    sid: string | null,
    msg: StoredMessage,
    onConfirmed?: (confirmed: { id: number; ts: number }) => void,
  ): Promise<void> => {
    const token = getToken()
    if (!sid || !token) return Promise.resolve()
    const op: PendingOp = {
      id: newPendingOpId(),
      type: 'message',
      sessionId: sid,
      ...(msg.conversationBranchId ? { conversationBranchId: msg.conversationBranchId } : {}),
      payload: { role: msg.role, content: msg.content, thinking: msg.thinking ?? '' },
      ts: msg.ts,
    }
    addPendingOp(op)
    return enqueueSessionMessageCommit(sid, () =>
      postMessage(token, sid, { role: msg.role, content: msg.content, thinking: msg.thinking }),
    ).then((res) => {
      if (!res.ok) return
      removePendingOp(op.id)
      confirmMessageInCache(sid, op, res.data)
      const confirmedTs = Date.parse(res.data.createdAt)
      if (Number.isFinite(confirmedTs)) onConfirmed?.({ id: res.data.id, ts: confirmedTs })
    })
  }, [])

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
    const el = scrollRef.current
    if (!el) return
    // UI2-03B-1：本次 mount 带 pending jump / 跳转保护窗口内，scroll-bottom 让位（由 jump 接管定位）
    if (jumpAtMountRef.current || jumpHoldRef.current || jumpSuppressRef.current || isChatJumpHolding()) return
    el.scrollTop = el.scrollHeight
  }, [visibleMessages])

  // UI2-03B-1「看原对话」：消费 App 传来的一次性 jump target。
  // 用 useLayoutEffect：DOM commit 后、paint 前直接定位 —— 第一可见帧就在目标附近，
  // 不再出现「先看到底部，再 smooth 滑回来」。首次定位必须 instant（behavior: 'auto'）。
  // 二次校验（session 未变 + visibleMessages 中 ts/content 完全一致的唯一 user 消息）通过才滚动；
  // 失败 → 清 pending + 上报提示（由 App 展示），绝不滚到别的消息。
  useLayoutEffect(() => {
    if (!pendingJump) return
    if (jumpHandledRef.current) return
    // 失败路径统一：释放保护 → 消费 pending → 上报提示（App 展示），绝不滚动
    const fail = () => {
      releaseJumpHold()
      jumpAtMountRef.current = false
      jumpSuppressRef.current = false
      onJumpConsumed?.()
      onJumpNotice?.('暂时无法定位原对话')
    }
    if (!activeSessionId) {
      // 无会话：跳不了，同样消费 pending + 提示，避免 pending 残留 / 死状态
      fail()
      return
    }
    jumpHandledRef.current = true
    if (!verifyChatJumpTarget(pendingJump, activeSessionId, visibleMessagesRef.current)) {
      fail()
      return
    }
    // 让 auto-scroll 让位：本轮滚动由 jump 接管
    jumpSuppressRef.current = true
    const ts = pendingJump.ts
    // DOM 定位必须同时锁 role=user + ts：同 ts 下可能存在 assistant 行，不能只靠 ts
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-msg-role="user"][data-msg-ts="${ts}"]`,
    )
    if (el) {
      // paint 前 instant 落位：第一眼就在原文附近（不再用 smooth 二次滚动）
      el.scrollIntoView({ block: 'center', behavior: 'auto' })
      el.classList.add('msg-jump-highlight')
      window.setTimeout(() => el.classList.remove('msg-jump-highlight'), 1800)
    } else {
      // 目标节点不存在（数据/渲染异常）：仍要消费 pending 并提示，不滚错位置
      onJumpNotice?.('暂时无法定位原对话')
    }
    jumpAtMountRef.current = false
    jumpSuppressRef.current = false
    // 跳转保护窗口：挡住跳完之后同帧/随后的异步更新（busy 状态、云端消息合并）再次把列表拉到底
    if (jumpHoldTimerRef.current !== null) window.clearTimeout(jumpHoldTimerRef.current)
    markChatJumpHold(2500)
    jumpHoldTimerRef.current = window.setTimeout(() => {
      jumpHoldRef.current = false
      chatJumpHoldUntil = 0
      jumpHoldTimerRef.current = null
    }, 2500)
    onJumpConsumed?.()
    // 注意：这里故意不写 cleanup —— 失败路径会当场消费 pending（pendingJump → null）触发 cleanup；
    // 提示状态由 App 持有，不受本 effect 生命周期影响。
  }, [pendingJump, activeSessionId])

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
    const personaText = persona?.trim() || ''
    let lang: Lang
    if (personaText) {
      lang = detectLang(personaText)
    } else {
      const recentUserMsgs = (replayExistingUser
        ? roundVisibleMessages.filter((m) => m.role === 'user').map((m) => messageEvidenceText(m.content))
        : [
            ...roundVisibleMessages.filter((m) => m.role === 'user').map((m) => messageEvidenceText(m.content)),
            text,
          ]
      ).slice(-5)
      const zhCount = recentUserMsgs.filter((m) => detectLang(m) === 'zh').length
      lang = zhCount > recentUserMsgs.length / 2 ? 'zh' : 'en'
    }
    if (activeSessionId) saveSessionLang(activeSessionId, lang)

    const settings = loadSettings()
    if (!settings.apiKey || !settings.baseUrl || !settings.model) {
      setError('还没接上 TA，去「我的」页填一下 API Key 就能聊了')
      return
    }

    const writeMemory = (content: string, opts: { source?: string; topic?: string; explicit?: boolean; taReply?: string } = {}): MemoryWriteResult => {
      const trimmed = content.trim()
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
        ? stripMemoryCorrectionMarkers(stripMemoryMarkers(stripThinkBlocks(rawText, lang))).trim().slice(0, 160) || undefined
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

    // Event Candidate Window：只带最近 6 条聊天里最多 2 条历史 user 原话 + 真实 ts；TA 文本永不作为 Event 证据。
    // 这让软 Event 在第一次“收口句”命中时就有多轮 evidence；最终仍由 Event V2 原五维硬闸门决定是否落库。
    if (!replayExistingUser) {
      const recentEventUserEvidence = roundVisibleMessages
        .slice(-6)
        .filter((m) => m.role === 'user')
        .slice(-2)
        .map((m) => ({ text: messageEvidenceText(m.content), ts: m.ts }))
        .filter((m) => m.text.length > 0)
      void processEventCandidate({
        sessionId: activeSessionId || undefined,
        userText: text,
        recentUserEvidence: recentEventUserEvidence,
        now: userMsg.ts,
      })
    }

    const nameForPrompt = (() => {
      if (!activeSessionId) return loadAIProfile().nickname
      const cached = getSessionsCache().find((s) => String(s.id) === activeSessionId)
      const t = (cached?.title || activeSession?.title || '').trim()
      if (!t || t === '新会话' || t === '我们的开始') return loadAIProfile(activeSessionId).nickname
      return t
    })()
    const accountId = activeSessionId ? (getAccount()?.account ?? '') : ''
    const replyLength = activeSessionId
      ? getEffectiveReplyLength(accountId, activeSessionId)
      : 'natural'
    const replyPreference = buildReplyLengthInstruction(replyLength, lang).trim()
    const allowActionNarration = isActionNarrationEnabled()
    const actionNarrationPreference = buildActionNarrationInstruction(allowActionNarration, lang).trim()
    // 回复偏好与旁白约定都并进现有主 system 文本末尾，不增加第二条 system。
    const apiMessages: ApiMessage[] = [
      {
        role: 'system',
        content:
          buildSystemPrompt(persona, nameForPrompt, undefined, getActiveSessionId() || undefined, lang, false) +
          (replyPreference ? '\n\n' + replyPreference : '') +
          (actionNarrationPreference ? '\n\n' + actionNarrationPreference : ''),
      },
    ]
    // 核心 system 只留稳定身份/规则；Memory/Event/Runtime/Space 等都走现有 ContextBlock，
    // 避免所有功能永久挤进不可裁剪的 core。
    const contextBlocks: ContextBlock[] = [
      { id: 'current-time', content: buildTimeContext(Date.now(), lang), priority: 'core' },
    ]
    const correctionTargets = new Map<string, MemoryCorrectionTarget>()

    const contextText = base
      .slice(-6)
      .map((m) => (m.role === 'assistant'
        ? cleanAttributionArtifacts(stripThinkBlocks(stripMemoryCorrectionMarkers(stripMemoryMarkers(m.content)), lang), lang)
        : m.content))
      .join('\n')
    const recalledMemory = recallSessionMemories(activeSessionId, contextText)
    const memory = selectMemoryWorkingSet(recalledMemory, {
      userText: text,
      // correction ref 只会让最终字符串更长；用同长度的 s:<id> 做预算上界，避免真实渲染后超出 working-set budget。
      renderBlock: (items) => buildMemoryBlock(
        items,
        lang,
        correctionIntent ? (item) => `s:${item.id}` : undefined,
      ),
    }).items
    if (memory.length > 0) {
      const refByItem = new Map<object, string>()
      if (correctionIntent) {
        const globalItems = loadMemory()
        const sessionItems = activeSessionId ? getMemoriesCache(activeSessionId) : []
        const token = getToken() ?? ''
        for (const m of memory) {
          const globalMatch = globalItems.filter((item) => item.id === m.id && item.text === m.text)
          const sessionMatch = sessionItems.filter((item) => item.id === m.id && item.text === m.text)
          if (globalMatch.length + sessionMatch.length !== 1) continue
          if (globalMatch.length === 1) {
            const ref = `g:${m.id}`
            refByItem.set(m, ref)
            correctionTargets.set(ref, { kind: 'global', item: globalMatch[0] })
          } else if (activeSessionId && sessionMatch.length === 1) {
            const ref = `s:${m.id}`
            refByItem.set(m, ref)
            correctionTargets.set(ref, { kind: 'session', sessionId: activeSessionId, item: sessionMatch[0], token })
          }
        }
      }
      const memoryBlock = buildMemoryBlock(memory, lang, correctionIntent ? (item) => refByItem.get(item) : undefined)
      if (memoryBlock) {
        contextBlocks.push({ id: 'memory', content: memoryBlock, priority: 'memory' })
      }
      if (correctionTargets.size > 0) {
        contextBlocks.push({
          id: 'memory-correction-consent',
          priority: 'core',
          content: lang === 'en'
            ? 'USER may be correcting a stored fact. Only if they clearly replace/deny one numbered [M:...] memory, ask naturally for confirmation and end with exactly one line: [Correct Memory <g:id or s:id>] <the complete corrected fact>. This is only a proposal; do not claim it is already changed. Do not emit a normal [Memory] marker for the same fact.'
            : '用户这句话可能在纠正旧记忆。只有在他明确否定/替换上面某条带 [M:...] 编号的记忆时，先自然询问是否要改，并在回复末尾单独输出一行【纠正记忆·g:id或s:id】纠正后的完整事实。这个标记只是申请，不能说已经改好；同一事实不要再输出普通【记忆】标记。一次最多一条。',
        })
      }
      const now = Date.now()
      for (const m of memory) {
        if (m.pinned || !shouldTouchMemoryFromUser(m, text)) continue
        if (activeSessionId) touchMemoryCache(activeSessionId, m.id, now)
        touchMemory(m.id, now)
      }
    }
    // Event（E3 二处）：最近 5 条一起经历过的事注入（记忆注入之后、自我时间线之前）；
    // 只作背景信息，不让 TA 直接复述
    const recentEvents = getRecentEvents(activeSessionId || undefined, 3)
    if (recentEvents.length > 0) {
      const eventsHeader = lang === 'en'
        ? 'Background info — things you two have been through together (do not repeat these lines as-is):\n'
        : '以上是背景信息，不要直接复述这些句子——你们一起经历过的事：\n'
      contextBlocks.push({
        id: 'events',
        priority: 'event',
        content:
          eventsHeader +
          recentEvents.map((e) => {
            const eventText = `${e.title}${e.description ? `（${e.description}）` : ''}`
            return `- ${formatEventDateShort(e.occurredAt)}：${formatAttributedLine(eventText, 'SHARED', lang, 'USER')}`
          }).join('\n'),
      })
    }
    // 最近 TA 原话已经完整存在 history + 相对时间标记里，不再重复塞一份 SelfTimeline system。
    // TA Runtime：只在用户这一轮明确询问 TA 的当前状态时注入。
    // 平时不把 TA 上轮自述再喂回去，避免“自述 → Runtime → 再自述”越滚越具体；Home 展示仍独立读取同一 Runtime。
    if (shouldInjectTaRuntimeContext(text, lang)) {
      const runtime = getOrAdvanceTaRuntime(
        activeSessionId || undefined,
        getSessionPersona(activeSessionId || undefined),
        Date.now(),
      )
      const runtimeCtx = buildTaRuntimeContext(runtime, lang)
      if (runtimeCtx) {
        contextBlocks.push({ id: 'runtime', content: runtimeCtx, priority: 'runtime' })
      }
    }
    const userWeather = readUserWeatherContext(loadUserProfile().city ?? '')
    if (userWeather) {
      contextBlocks.push({
        id: 'user-weather',
        content: buildUserWeatherContext(userWeather, lang),
        priority: 'ambient',
      })
    }
    const identityCtx = buildIdentityContext(activeSessionId || undefined, lang)
    if (identityCtx) {
      contextBlocks.push({ id: 'identity', content: identityCtx, priority: 'core' })
    }
    const journalRelevant = /周记|周报|周总结|这周|上周|本周|journal|weekly/i.test(text)
    const weeklyList = journalRelevant ? getWeeklyReviews(activeSessionId || undefined) : []
    if (weeklyList.length > 0) {
      const w = weeklyList[0]
      // TASK-JOURNAL-INJECT：不只带标题，带最近一篇正文前 200 字摘要，被问"周记写的啥"有内容可答
      const excerpt = (w.content ?? '').trim().slice(0, 200)
      if (lang === 'en') {
        contextBlocks.push({
          id: 'weekly-review',
          priority: 'ambient',
          content: `Your most recent journal entry to them is "${w.title}" (${w.weekLabel}).${excerpt ? `\n${formatAttributedLine(excerpt, 'SELF', 'en')}` : ''}\nIf they bring it up, respond in the tone and content of this entry.`,
        })
      } else {
        contextBlocks.push({
          id: 'weekly-review',
          priority: 'ambient',
          content: `你最近写给对方的周记是「${w.title}」（${w.weekLabel}）。${excerpt ? `\n${formatAttributedLine(excerpt, 'SELF', 'zh')}` : ''}\n对方要是提起周记，就照这篇的语气和内容回应。`,
        })
      }
    }
    const identityMode = resolveIdentityMode(activeSessionId || undefined)
    const allowEmbodiedLife = allowsEmbodiedLifeContext(identityMode)
    // Space 旧动态没有 identityMode stamp。为避免从沉浸切到自然 / AI 后把旧吃饭、出门、地点继续当成 SELF 事实，
    // v1 仅在沉浸档把 Space 历史注入 Chat；Space 页面本身仍照当前 identity policy 正常生成与展示。
    if (allowEmbodiedLife) {
      const spaceBlock = buildSpacePostsBlock(loadCurrentPosts(activeSessionId || undefined), 2, lang)
      if (spaceBlock) {
        contextBlocks.push({ id: 'space-posts', content: spaceBlock, priority: 'ambient' })
      }
    }
    // 未来约定注入（因果链第二环 TASK-FUTURE-AGENDA）：TA 记得「约好还没做的事」，
    // 对方问起/到期临近时能自然接，不会一问三不知；没约定返回空串跳过，不占上下文。
    const agendaBlock = buildFutureAgendaBlock(futureTopicsFromMessages(base), new Date(), lang)
    if (agendaBlock) {
      contextBlocks.push({ id: 'future-agenda', content: agendaBlock, priority: 'event' })
    }
    // 生活基线 / 你的时刻只在这一轮真的需要 TA 分享自己近况时才进上下文，不再每轮常驻。
    const recentUserTexts = base
      .filter((m) => m.role === 'user')
      .slice(-3)
      .map((m) => m.content)
    const shouldShareMoment = allowEmbodiedLife && shouldInjectYourMoment(recentUserTexts, lang)
    if (shouldShareMoment && !personaHasLifeAnchors(persona)) {
      contextBlocks.push({
        id: 'life-baseline',
        content: lang === 'en' ? LIFE_BASELINE_EN : LIFE_BASELINE,
        priority: 'ambient',
      })
    }
    if (shouldShareMoment) {
      const momentBlock = buildYourMomentBlock(persona, new Date(), lang)
      if (momentBlock) {
        contextBlocks.push({
          id: 'your-moment',
          priority: 'ambient',
          content: `${lang === 'en' ? MOMENT_GUIDE_EN : MOMENT_GUIDE_ZH}\n${formatAttributedLine(momentBlock, 'SELF', lang)}`,
        })
      }
    }
    if (!replayExistingUser && memInstr.isInstruction && !(correctionIntent && correctionTargets.size > 0)) {
      if (lang === 'en') {
        contextBlocks.push({
          id: 'memory-explicit',
          priority: 'core',
          content: `USER just asked you to remember: ${formatAttributedLine(memInstr.fact ?? text, 'USER', 'en')}. Write only that stated fact, with no inference or added conclusion. End with one [Memory: Topic] line and briefly confirm it was noted.`,
        })
      } else {
        contextBlocks.push({
          id: 'memory-explicit',
          priority: 'core',
          content: `USER 刚要求你记住：${formatAttributedLine(memInstr.fact ?? text, 'USER', 'zh')}。只写这条明确事实，不推断、不补充；回复末尾单独一行输出【记忆·主题】内容，并简短确认已记下。`,
        })
      }
    } else if (isRetort && !(correctionIntent && correctionTargets.size > 0)) {
      if (lang === 'en') {
        contextBlocks.push({
          id: 'memory-retort',
          priority: 'core',
          content:
            'They reminded you to save something from the recent conversation. Extract only stable facts they actually stated; do not infer. End with one [Memory: Topic] line and confirm it was noted.',
        })
      } else {
        contextBlocks.push({
          id: 'memory-retort',
          priority: 'core',
          content:
            '用户在提醒你记下最近提过的信息。只提取用户实际说过、适合长期保留的稳定事实，不推断不补充；回复末尾输出一行【记忆·主题】内容，并确认已记下。',
        })
      }
    }

    const history: ApiMessage[] = base.map((m) => {
      const body =
        m.role === 'assistant'
          ? cleanAttributionArtifacts(stripThinkBlocks(stripMemoryMarkers(m.content), lang), lang)
          : m.content
      const mark = msgTimeMark(m.ts, lang)
      return { role: m.role, content: mark ? mark + body : body }
    })

    // PR #99 Session Bridge：已承接时，注入 evidence-only bridge 摘要（memory 优先级块，不新增 LLM 调用）。
    // 只临时参与后续约 BRIDGE_ACTIVE_TURNS 轮（turnsLeft 递减，归零后退出注入）；不写 Memory / Event。
    const bridgeBlocks: ContextBlock[] = []
    if (activeSessionId && bridgeInfo && bridgeInfo.bridgedAt >= contextBoundary && bridgeInfo.turnsLeft > 0 && bridgeInfo.content.trim()) {
      bridgeBlocks.push({ id: 'bridge', content: bridgeInfo.content, priority: 'memory' })
    }
    // PR #99 Context Compact：已压缩时，注入 = [较老历史摘要(system)] + [最近原始消息]。
    // 当前时间已经在 buildSystemPrompt 中注入一次；这里不再追加第二条时间 system。
    const historyForModel =
      activeSessionId && compactDone && compactSummary.trim()
        ? buildCompactedHistory(compactSummary, history, COMPACT_KEEP_RECENT)
        : history
    const composed = composeContext(apiMessages, historyForModel, [...contextBlocks, ...bridgeBlocks])
    // 上下文总量 = 刷新之后这一段（sessionStart 起）所有内容的 provider 口径估算；
    // 「本轮输入」仍是本轮 payload 的估算，两者分开显示。
    const sessionContentTokens = contentTokensOf(usageMessages(roundVisibleMessages, userMsg), loadContextFactor())
    const estimatedContextState: ContextUsageState = {
      sessionStart,
      used: sessionContentTokens,
      budget: composed.hardBudget,
      source: 'estimate',
      inputTokens: composed.totalTokens,
      updatedAt: Date.now(),
    }
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

    const commitFinal = (final: StoredMessage[]) => {
      const interruptionReason = replyInterruptionReasonRef.current
      let finalWithConcurrent = final
      if (roundSessionId) {
        const finalIds = new Set(
          final
            .filter((message) => message.role === 'assistant' && typeof message.id === 'number')
            .map((message) => message.id as number),
        )
        const concurrentConfirmed = getMessagesCache(roundSessionId).filter((message) => {
          if (message.role !== 'assistant' || typeof message.id !== 'number') return false
          if (initialConfirmedAssistantIds.has(message.id) || finalIds.has(message.id)) return false
          if (roundBranchId && message.conversationBranchId && message.conversationBranchId !== roundBranchId) return false
          return true
        })
        if (concurrentConfirmed.length > 0) {
          const currentReply = final.filter((message) => message.role === 'assistant' && message.ts === assistantTs)
          const prior = final.filter((message) => !(message.role === 'assistant' && message.ts === assistantTs))
          finalWithConcurrent = [
            ...prior,
            ...concurrentConfirmed,
          ].sort((a, b) => a.ts - b.ts).concat(currentReply)
        }
      }
      const lifecycleFinal = setReplyLifecycle(
        finalWithConcurrent,
        lifecycleUserTs,
        assistantTs,
        interruptionReason ? 'interrupted' : 'complete',
        interruptionReason ?? undefined,
      )
      const branchFinal = roundBranchId
        ? lifecycleFinal.map((m) => (m.role === 'assistant' && m.ts === assistantTs ? tagCurrentBranch(m) : m))
        : lifecycleFinal
      persistMessages(roundSessionId, branchFinal)
      // 模块二：组件卸载后跳过 UI 更新，落库/云同步继续执行。
      // 若同一实例的 active session 已变化，只落 owner 会话，不把旧轮次画进新会话。
      if (mountedRef.current && (!roundSessionId || roundSessionId === getActiveSessionId())) setMessages(branchFinal)
      const sid = roundSessionId
      // v7 #7：只在最终可见回复已经落库后，把 TA 明确说出的“自己正在/马上做什么”写回同一 Runtime。
      // 不读用户文本、不改聊天记录；失败/无可信动作时函数返回 null，保持原 Runtime。
      const committedAssistantText = branchFinal
        .filter((m) => m.role === 'assistant' && m.ts === assistantTs)
        .map((m) => m.content)
        .join('\n')
        .trim()
      if (committedAssistantText && !interruptionReason) {
        syncTaRuntimeFromAssistantText(roundSessionId || undefined, committedAssistantText, Date.now())
        // Space-N1 唯一 Chat 例外（产品已冻结“完整 USER+TA 对话对”为硬要求）：
        // 只在正常最终可见回复真实落库后补 pair；Stop / 切模型 / stream error 已把 eligible 置 false。
        // 不改消息、不改上传/合并/去重，也不新增模型调用。taTs 必须是真正 commit 时刻，不能用请求开始的 assistantTs。
        if (spacePairEligibleRef.current) {
          const pairCommittedAt = Date.now()
          completeChatTopicPair(
            text,
            committedAssistantText,
            roundSessionId || undefined,
            userMsg.ts,
            pairCommittedAt,
          )
          spacePairEligibleRef.current = false
        }
      }
      const token = getToken()
      if (sid && token) {
        let chain: Promise<void> = Promise.resolve()
        for (const m of branchFinal) {
          if (m.role !== 'assistant' || m.ts !== assistantTs) continue
          chain = chain.then(() => uploadMessage(roundSessionId, m))
        }
      }
      if (mountedRef.current) setStreaming(false)
      controllerRef.current = null
      // 卸载期间回复完成落库（2026-09-05 夜乔修：返回主界面后 TA 的回复"消失"，发下一条才一起冒出）
      // ——广播事件，重新进入的聊天页实例收到后刷新缓存，让这条回复立即显示
      if (!mountedRef.current) {
        window.dispatchEvent(new CustomEvent('yiwem:ai-reply-committed', { detail: { sid: roundSessionId } }))
      }
      unregisterActiveReplyRun(roundSessionId, lifecycleUserTs)
      partialTsRef.current = null
      partialUserTsRef.current = null
      partialSessionIdRef.current = null
      replyInterruptionReasonRef.current = null
      streamingRef.current = false
    }

    const finalize = () => {
      // 防重入守卫：onDone 直接 finalize + playTick finishStreaming 可能二次调用
      if (finishedRef.current) return
      finishedRef.current = true
      const raw = assistantText.current
      // 非流式/流式漏网兜底（2026-09-05 晚）：部分中转站（doi 等）不给标准 SSE 逐字流，onToken 忙碌检测跑不到——
      // 完整文本到 finalize 时再查一次，命中照样截断进忙碌（忙语句之后的尾巴不落库）
      const availability = classifyAvailability(raw)
      // 身份模式可以在同一轮生成过程中切换；finalize 必须以“此刻”的模式判定，不能沿用请求开始时的闭包值。
      const liveIdentityMode = resolveIdentityMode(activeSessionId || undefined)
      const liveAllowBusy = allowsBusyState(liveIdentityMode)
      // Busy 是沉浸档专属能力；自然 / AI 的“等我/稍后回来”只作为身份违规继续走 finalization repair。
      if (liveAllowBusy && !busyTriggeredRef.current && raw && availability.state === 'unavailable' && availability.owner === 'SELF') {
        busyTriggeredRef.current = true
        const cut = findBusyCutoff(raw)
        const busyText = cut > 0 && cut < raw.length ? raw.slice(0, cut) : raw
        // TASK-MEM-DISTILL：忙碌截断前先把本轮候选/已到 marker 归并落库（模型给完整回复前 = 无对应 marker → fallback）
        flushMemoryWrites(raw)
        unregisterActiveReplyRun(roundSessionId, lifecycleUserTs)
        enterBusyRef.current(roundSessionId, busyText, availability, roundVisibleMessages)
        return
      }
      // TASK-MEM-DISTILL：唯一归并写入出口——candidate + marker 只写一条；无 marker 的候选 fallback 落库
      const memoryWroteThisTurn = flushMemoryWrites(raw)
      // 模块三·内心戏：提取思考链原文（存到 thinking 字段），正文剥离思考链
      // 第27条：合并两个来源——①正文里 `` 泄漏的思考 ②模型独立字段 reasoning_content
      const thinkFromContent = extractThinkBlocks(raw)
      const thinkFromReasoning = reasoningRef.current?.trim() || ''
      let thinking = ''
      if (thinkFromContent && thinkFromReasoning) {
        // 两个来源都有：合并去重（reasoning 在前，因为是标准字段；内容相同不重复）
        thinking = thinkFromReasoning.includes(thinkFromContent.slice(0, 50))
          ? thinkFromReasoning
          : `${thinkFromReasoning}\n---\n${thinkFromContent}`
      } else {
        thinking = thinkFromReasoning || thinkFromContent
      }
      thinking = cleanAttributionArtifacts(thinking, lang)
      const explicitCorrectionProposal = replayExistingUser ? null : extractMemoryCorrectionProposal(raw)
      const markerMemories = extractMemories(raw)
      const fallbackCorrectionProposal =
        !explicitCorrectionProposal && correctionIntent && correctionTargets.size === 1 && markerMemories.length === 1
          ? { ref: [...correctionTargets.keys()][0], value: markerMemories[0].text }
          : null
      const correctionProposal = explicitCorrectionProposal ?? fallbackCorrectionProposal
      const correctionTarget = correctionProposal ? correctionTargets.get(correctionProposal.ref) : undefined
      const proposedCorrection = correctionTarget && correctionProposal && correctionProposal.value !== correctionTarget.item.text
        ? { target: correctionTarget, value: correctionProposal.value }
        : null
      // 护栏文本与最终可见文本分开：旁白开启时保留括号展示，但把括号内文字展开给事实/身份护栏检查。
      const guardCleaned = guardAssistantReplyBody(raw, lang, allowActionNarration)
      const visibleCleaned = cleanAssistantReplyBody(raw, lang, allowActionNarration)
      const attributionProblem = guardCleaned ? hasAttributionLeak(guardCleaned) : false
      const roboticProblem = guardCleaned ? looksRobotic(guardCleaned, liveIdentityMode) : false
      const fabricatedProblem = guardCleaned ? looksFabricated(guardCleaned) : false
      const embodiedProblem = guardCleaned ? looksEmbodiedSelfClaim(guardCleaned, liveIdentityMode) : false
      const cleanedAvailability = guardCleaned ? classifyAvailability(guardCleaned) : null
      const unavailableIdentityProblem = Boolean(
        guardCleaned && !liveAllowBusy && cleanedAvailability?.state === 'unavailable' && cleanedAvailability.owner === 'SELF',
      )
      const identityProblem = embodiedProblem || unavailableIdentityProblem
      // 首版如果只是“客服腔”，repair 自己失败时优先保住已经清洗过的首版；
      // 只要首版涉及归因泄漏 / 编造 / 身份越界，就绝不能因为 repair 失败而复活原文。
      const canReuseFirstReplyOnRepairFailure = Boolean(
        guardCleaned && looksRecoverableServiceStyle(guardCleaned) && !attributionProblem && !fabricatedProblem && !identityProblem,
      )
      // 用户主动 Stop 不再发第二次模型请求；若截停片段已经越过身份边界，直接不落这段 assistant 文本。
      if (guardCleaned && identityProblem && retriedRef.current) {
        commitFinal([...replyBaseMessages])
        return
      }
      if (guardCleaned && (attributionProblem || roboticProblem || fabricatedProblem || identityProblem) && !retriedRef.current) {
        retriedRef.current = true
        setError(null)
        setMessages([...replyBaseMessages, { role: 'assistant', content: '…', ts: assistantTs }])
        const genericRepair = liveIdentityMode === 'ai'
          ? (lang === 'en'
              ? 'Your previous reply had a grounding or reality-boundary problem. Answer again using only supported context, without inventing shared history or human physical experiences. Do not rewrite merely because the wording sounds like an AI or assistant.'
              : '你刚才的回复有依据或现实边界问题。重新回答：只用现有上下文里有依据的内容，不编共同经历、不编人的现实经历；不要因为表达像 AI 或助手就改写。')
          : (lang === 'en'
              ? 'Your previous reply had a grounding or style problem. Forget that sentence and answer again: stay grounded in the available context, do not invent shared history, do not sound like customer service, and keep the reply natural and concise.'
              : '你刚才的回复有依据或表达问题。忘掉那句，重新回答：只用现有上下文里有依据的内容，不编共同经历，不要客服腔，保持自然简短。')
        const identityRepair = identityProblem ? buildIdentityBoundaryRepair(liveIdentityMode, lang) : ''
        const safeFallback = lang === 'en'
          ? "That answer didn't come out reliably, so I won't pretend it did."
          : '刚才那句没答稳，我不拿不确定的话糊弄你。'
        const resolveRepairFailureText = () => {
          if (!canReuseFirstReplyOnRepairFailure) return safeFallback
          // repair 等待期间身份模式可能切换；真正提交首版前按“此刻”模式重新验身份边界。
          const fallbackIdentityMode = resolveIdentityMode(activeSessionId || undefined)
          const fallbackAllowBusy = allowsBusyState(fallbackIdentityMode)
          const fallbackAvailability = classifyAvailability(guardCleaned)
          const fallbackIdentityProblem =
            (fallbackIdentityMode === 'immersive' && looksIdentityDisclosure(guardCleaned)) ||
            looksEmbodiedSelfClaim(guardCleaned, fallbackIdentityMode) ||
            (!fallbackAllowBusy && fallbackAvailability?.state === 'unavailable' && fallbackAvailability.owner === 'SELF')
          return fallbackIdentityProblem ? safeFallback : visibleCleaned
        }
        void chatCompletion(settings, [
          ...apiMessages,
          { role: 'assistant', content: guardCleaned },
          {
            role: 'user',
            content: identityRepair ? `${genericRepair}\n${identityRepair}` : genericRepair,
          },
        ])
          .then((retry) => {
            const retryGuard = guardAssistantReplyBody(retry, lang, allowActionNarration)
            const retryVisible = cleanAssistantReplyBody(retry, lang, allowActionNarration)
            const retryAvailability = retryGuard ? classifyAvailability(retryGuard) : null
            const retryIdentityMode = resolveIdentityMode(activeSessionId || undefined)
            const retryAllowBusy = allowsBusyState(retryIdentityMode)
            if (
              !retryGuard ||
              looksRobotic(retryGuard, retryIdentityMode) ||
              looksFabricated(retryGuard) ||
              looksEmbodiedSelfClaim(retryGuard, retryIdentityMode) ||
              (!retryAllowBusy && retryAvailability?.state === 'unavailable' && retryAvailability.owner === 'SELF')
            ) {
              const final: StoredMessage[] = [...replyBaseMessages, { role: 'assistant', content: resolveRepairFailureText(), ts: assistantTs }]
              commitFinal(final)
            } else if (retryAllowBusy && retryAvailability?.state === 'unavailable' && retryAvailability.owner === 'SELF') {
              busyTriggeredRef.current = true
              const cut = findBusyCutoff(retryGuard)
              const busyText = cut > 0 && cut < retryGuard.length ? retryGuard.slice(0, cut) : retryGuard
              enterBusyRef.current(roundSessionId, busyText, retryAvailability, roundVisibleMessages)
            } else {
              const final: StoredMessage[] = [...replyBaseMessages, { role: 'assistant', content: retryVisible, ts: assistantTs }]
              commitFinal(final)
            }
          })
          .catch(() => {
            // repair 失败/超时：只有“纯客服腔”首版可以退回；编造/身份/归因问题仍绝不放回。
            const final: StoredMessage[] = [...replyBaseMessages, { role: 'assistant', content: resolveRepairFailureText(), ts: assistantTs }]
            commitFinal(final)
          })
        return
      }
      // 回复卫生（2026-09-19）：
      // ① 时间标签兜底——模型可能把历史里的 [3 分钟前] 抄进第二条气泡开头，逐条再剥一次；
      // ② 去复读——丢掉与最近两条 TA 自己消息整条重复的气泡（弱模型实测会连发三条一样的生活状态）。
      const splitParts = visibleCleaned
        ? (replyLength === 'long' ? splitDetailedAssistantReply(visibleCleaned, assistantTs) : splitAssistantReplies(visibleCleaned, assistantTs))
        : []
      const hygienicParts = splitParts
        .map((m) => ({ ...m, content: stripTimeLabels(m.content).trim() }))
        .filter((m) => m.content !== '')
      const assistantMsgs = dropRepeatedReplies(hygienicParts, roundVisibleMessages)
      // 思考链存到第一条 assistant 消息的 thinking 字段（内心戏展示用）
      if (assistantMsgs.length > 0 && thinking) {
        assistantMsgs[0].thinking = thinking
      }
      // 「已记住」徽标必须绑真实写入结果：只有本轮记忆真的落地，才标到 TA 消息上
      if (memoryWroteThisTurn && assistantMsgs.length > 0) {
        assistantMsgs[0].memorySaved = true
      }
      const final: StoredMessage[] = [...replyBaseMessages, ...assistantMsgs]
      if (proposedCorrection) {
        if (activeSessionId) savePendingMemoryCorrection(activeSessionId, sessionStart, proposedCorrection)
        if (mountedRef.current) {
          setPendingMemoryCorrection(proposedCorrection)
          setMemoryCorrectionNotice(null)
        }
      }
      commitFinal(final)
    }
    finalizeRef.current = finalize

    let retrySameRound: (() => void) | null = null

    const playTick = () => {
      if (runId !== runIdRef.current) return
      if (finishedRef.current) return
      if (pauseLeftRef.current > 0) {
        pauseLeftRef.current -= 1
        return
      }
      // 流式游标必须基于单调增长的清洗结果；动作是否最终保留只在 finalization 决定。
      // 关闭旁白时保持改造前的流式行为，避免完成括号后字符串突然变短卡住游标。
      const clean = cleanStreamingAttributionArtifacts(
        stripThinkBlocks(stripMemoryCorrectionMarkers(stripMemoryMarkers(assistantText.current)), lang),
        lang,
      )
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
      const splits = replyLength === 'long'
        ? splitDetailedAssistantReply(displayCleanRef.current, assistantTs)
        : splitAssistantReplies(displayCleanRef.current, assistantTs)
      setMessages([...replyBaseMessages, ...splits.map(tagCurrentBranch)])
      if (showLenRef.current >= total && streamEndedRef.current) finishStreaming()
    }
    const finishStreaming = () => {
      if (finishedRef.current) return
      const err = streamErrorRef.current
      // “一个字都没回来”看最终可见正文，不看 raw：只有 think / Memory / correction / action marker 也算 0 正文。
      const visibleReplyBody = cleanAssistantReplyBody(assistantText.current, lang, allowActionNarration)
      const hadNoReply = visibleReplyBody === ''
      finalize()  // finalize 自己设置 finishedRef 防重入
      if (mountedRef.current && hadNoReply) {
        setError(err?.message ?? 'TA 没有返回正文')
        if (!replayExistingUser) {
          setFailedText(text)
          if (quote) setQuoteDraft(quote)
        }
        if (retrySameRound) {
          // 0 正文只开放显式手动重试；不自动烧 Key，也不重新走 send/user upload/Event/Memory 前置链路。
          failedReplyRetryRef.current = retrySameRound
          setFailedReplyRetryAvailable(true)
        }
      } else if (err && mountedRef.current) {
        setError(err.message)
        if (!replayExistingUser) {
          setFailedText(text)
          if (quote) setQuoteDraft(quote)
        }
        if (retrySameRound) {
          failedReplyRetryRef.current = retrySameRound
          setFailedReplyRetryAvailable(true)
        }
      }
    }
    tickPlayRef.current = playTick

    const startStream = () => {
      if (runId !== runIdRef.current) return
      const currentStored = roundSessionId ? getMessagesCache(roundSessionId) : loadMessages()
      const streamingStored = setReplyLifecycle(currentStored, lifecycleUserTs, assistantTs, 'streaming')
      persistMessages(roundSessionId, streamingStored)
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
          // Busy 只在沉浸档拦截流；自然 / AI 即使说"等我回来"也让流完成，再由 finalize repair。
          const availability = classifyAvailability(assistantText.current)
          const liveAllowBusy = allowsBusyState(resolveIdentityMode(activeSessionId || undefined))
          if (liveAllowBusy && !busyTriggeredRef.current && availability.state === 'unavailable' && availability.owner === 'SELF') {
            busyTriggeredRef.current = true
            const cutoff = findBusyCutoff(assistantText.current)
            if (cutoff > 0 && cutoff < assistantText.current.length) {
              assistantText.current = assistantText.current.slice(0, cutoff)
            }
            // TASK-MEM-DISTILL：流式 busy 命中后 abort 会直接 return（不进 finalize），
            // 先在 abort 前把本轮候选/已到 marker 归并落库，否则记忆候选会丢
            flushMemoryWrites(assistantText.current)
            // 停流：abort 后 catch 里会直接 return，不会触发 onError
            controllerRef.current?.abort()
            streamEndedRef.current = true
            // 进入忙碌状态（用 ref 避免闭包）；这一轮已经由 Busy 接管，不再保持“正在生成”注册。
            unregisterActiveReplyRun(roundSessionId, lifecycleUserTs)
            enterBusyRef.current(roundSessionId, assistantText.current, availability, roundVisibleMessages)
          }
        },
        onDone: (reasoning, usage) => {
          if (runId !== runIdRef.current) return
          // 会话总量始终来自本轮 composeContext 的累计上下文；provider usage 只描述这一轮请求。
          // 请求在 Chat 卸载后仍可能正常完成并产生费用：本机用量必须继续落到本轮 owner session；
          // 只有 React meter 更新受 mountedRef 限制，避免卸载后 setState。
          const estimatedOutput = estimateToken(assistantText.current)
          let completedContextState: ContextUsageState
          if (usage && Number.isFinite(usage.promptTokens)) {
            const reportedCompletion = typeof usage.completionTokens === 'number' && Number.isFinite(usage.completionTokens)
              ? usage.completionTokens
              : undefined
            const reportedTotal = typeof usage.totalTokens === 'number' && Number.isFinite(usage.totalTokens)
              ? usage.totalTokens
              : undefined
            const cachedTokens = typeof usage.cachedPromptTokens === 'number' && Number.isFinite(usage.cachedPromptTokens)
              ? usage.cachedPromptTokens
              : undefined
            const outputTokens = reportedCompletion ?? (
              reportedTotal == null ? undefined : Math.max(0, reportedTotal - usage.promptTokens)
            )
            // 用本轮真实 prompt 与同段本地估算反推校准系数，供会话总量换算使用（只在本机保存）。
            const nextFactor = calibrateContextFactor(loadContextFactor(), composed.totalTokens, usage.promptTokens)
            saveContextFactor(nextFactor)
            completedContextState = {
              sessionStart,
              // 上下文总量 = 刷新之后这一段（sessionStart 起）所有内容的 provider 口径估算；只随这一段增长。
              used: contentTokensOf(usageMessages(roundVisibleMessages, userMsg), nextFactor),
              budget: composed.hardBudget,
              source: 'actual',
              inputTokens: usage.promptTokens,
              ...(outputTokens == null ? {} : { outputTokens }),
              ...(cachedTokens == null ? {} : { cachedTokens }),
              updatedAt: Date.now(),
            }
          } else {
            completedContextState = {
              sessionStart,
              used: composed.totalTokens + estimatedOutput,
              budget: composed.hardBudget,
              source: 'estimate',
              inputTokens: composed.totalTokens,
              outputTokens: estimatedOutput,
              updatedAt: Date.now(),
            }
          }
          if (mountedRef.current) setContextMeter(completedContextState)
          if (roundSessionId) setContextUsage(completedContextState, roundSessionId, settings)
          // 第27条：收集模型独立思考字段 reasoning_content，finalize 时合并到 thinking
          if (reasoning) reasoningRef.current = reasoning
          streamEndedRef.current = true
          // 模块二：组件挂载时走原流程（playTick 播完打字机节奏再 finishStreaming→finalize），
          // 只有卸载时才直接 finalize（保证落库不丢，不打断打字机）
          if (!mountedRef.current) {
            finalizeRef.current?.()
          }
        },
        onError: (err) => {
          if (runId !== runIdRef.current) return
          // 请求失败时即使已有半截可见文本，也不把它当作完整 Space 对话对。
          spacePairEligibleRef.current = false
          replyInterruptionReasonRef.current = interruptionReasonFromError(err)
          streamErrorRef.current = err
          streamEndedRef.current = true
          // onError 同样：挂载时走 playTick 流程，卸载时直接 finalize
          if (!mountedRef.current) {
            finalizeRef.current?.()
          }
        },
      })
      controllerRef.current = controller
    }

    retrySameRound = () => {
      // 失败重试只属于发起它的会话与当前 segment；切会话/刷新对话后即使旧闭包还在也不能再跑。
      const sameSession = (getActiveSessionId() || null) === (activeSessionId || null)
      const sameSegment = !activeSessionId || getSessionStart(activeSessionId) === sessionStart
      const sameBranch =
        !roundBranchId ||
        !activeSessionId ||
        loadConversationState(activeSessionId)?.activeBranchId === roundBranchId
      if (!sameSession || !sameSegment || !sameBranch || streamingRef.current) {
        failedReplyRetryRef.current = null
        if (mountedRef.current) setFailedReplyRetryAvailable(false)
        return
      }
      failedReplyRetryRef.current = null
      replyInterruptionReasonRef.current = null
      // 每次 TA-only retry 使用新的 assistant ts：保留上一段 interrupted partial，同时绝不把它再次上传。
      assistantTs = Math.max(Date.now(), assistantTs + 1)
      replyBaseMessages = roundSessionId ? getMessagesCache(roundSessionId) : loadMessages()
      replyBaseMessages = setReplyLifecycle(replyBaseMessages, lifecycleUserTs, assistantTs, 'pending')
      persistMessages(roundSessionId, replyBaseMessages)
      registerActiveReplyRun(roundSessionId, lifecycleUserTs)
      partialTsRef.current = assistantTs
      partialUserTsRef.current = lifecycleUserTs
      partialSessionIdRef.current = roundSessionId
      if (mountedRef.current) {
        setFailedReplyRetryAvailable(false)
        setRecoveryDismissedTs(null)
        setError(null)
        setFailedText(null)
        setMessages([...replyBaseMessages, tagCurrentBranch({ role: 'assistant', content: '', ts: assistantTs })])
        setStreaming(true)
      }
      runId = ++runIdRef.current
      retriedRef.current = false
      spacePairEligibleRef.current = !replayExistingUser
      busyTriggeredRef.current = false
      assistantText.current = ''
      reasoningRef.current = ''
      streamErrorRef.current = null
      streamEndedRef.current = false
      showLenRef.current = 0
      pauseLeftRef.current = 0
      displayCleanRef.current = ''
      finishedRef.current = false
      partialTsRef.current = assistantTs
      partialUserTsRef.current = userMsg.ts
      partialSessionIdRef.current = roundSessionId
      streamingRef.current = true
      // 保留正常聊天的思考节奏，但这仍是同一轮请求：不追加 user、不重复上传 user、不重跑 Event candidate。
      thinkTimerRef.current = window.setTimeout(startStream, computeThinkDelayMs(text.length))
    }

    const thinkMs = computeThinkDelayMs(text.length)
    thinkTimerRef.current = window.setTimeout(startStream, thinkMs)
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


  const handleSaveMessageAsMemory = async (role: StoredMessage['role'], text: string): Promise<boolean> => {
    const sid = activeSessionId
    const token = getToken()
    const clean = String(text ?? '').trim()
    if (!sid || !token || !clean) return false

    const current = getMemoriesCache(sid)
    if (isSimilarMemory(current, clean)) return true

    const res = await postMemory(token, sid, {
      content: clean,
      ...(role === 'user' ? { source: clean } : { taReply: clean }),
    })
    if (!res.ok) return false

    const item = {
      ...sessionMemoryToItem(res.data),
      topic: inferTopic(clean),
      ...(role === 'user' ? { explicit: true } : {}),
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
                onSaveMemory={!streaming && !contextBusy
                  ? (text) => handleSaveMessageAsMemory(m.role, text)
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

      {jumpNotice && (
        <div className="chat-jump-notice" role="status">{jumpNotice}</div>
      )}

      {branchActionNotice && (
        <div className="chat-branch-action-notice" role="status">
          <span>{branchActionNotice.text}</span>
          <button type="button" onClick={undoConversationBranchAction} disabled={streaming}>{chatUiLang === 'en' ? 'Undo' : '撤销'}</button>
        </div>
      )}

      {showReplyRecovery && recoverableReply && (
        <div className="chat-reply-recovery" role="status">
          <span>
            {chatUiLang === 'en'
              ? 'That reply was interrupted. Any part already received is kept.'
              : '刚才的回复中断了，已经收到的部分会保留。'}
          </span>
          <div className="chat-reply-recovery-actions">
            <button type="button" onClick={handleContinueAfterInterruption}>
              {chatUiLang === 'en' ? 'Continue' : '继续'}
            </button>
            <button type="button" onClick={handleRetryInterruptedReply} disabled={streaming || Boolean(contextBusy) || isBusy}>
              {chatUiLang === 'en' ? 'Retry TA only' : '只重试 TA'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="chat-error-wrap">
          <div className="chat-error">
            {failedReplyRetryAvailable
              ? (chatUiLang === 'en' ? 'That reply was interrupted. You can retry TA only.' : 'TA 刚才的回复中断了，可以只重试 TA。')
              : error}
          </div>
          {failedReplyRetryAvailable && (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={streaming}
              onClick={() => failedReplyRetryRef.current?.()}
            >
              {chatUiLang === 'en' ? 'Retry TA only' : '只重试 TA'}
            </button>
          )}
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

      {pendingMemoryCorrection && (
        <div className="memory-correction-consent" role="group" aria-label="确认纠正记忆">
          <div className="memory-correction-consent-title">TA 想纠正一条记忆</div>
          <div className="memory-correction-consent-row">
            <span>原来记的是</span>
            <strong>{pendingMemoryCorrection.target.item.text}</strong>
          </div>
          <div className="memory-correction-consent-row">
            <span>准备改成</span>
            <strong>{pendingMemoryCorrection.value}</strong>
          </div>
          <div className="memory-correction-consent-actions">
            <button type="button" onClick={rejectPendingMemoryCorrection} disabled={memoryCorrectionBusy}>先不改</button>
            <button type="button" onClick={() => void confirmPendingMemoryCorrection()} disabled={memoryCorrectionBusy}>
              {memoryCorrectionBusy ? '正在纠正…' : '确认纠正'}
            </button>
          </div>
        </div>
      )}

      {memoryCorrectionNotice && (
        <div className="memory-correction-notice" role="status">{memoryCorrectionNotice}</div>
      )}

      <div className="chat-composer-panel">
        {quoteDraft && (
          <div className="chat-quote-draft">
            <div className="chat-quote-draft-text">
              <strong>
                {chatUiLang === 'en'
                  ? `Quoting ${quoteDraft.speaker === 'assistant' ? 'TA' : 'me'}`
                  : `引用${quoteDraft.speaker === 'assistant' ? ' TA' : '我'}`}
              </strong>
              <span>{quoteDraft.text.replace(/\s+/g, ' ').slice(0, 120)}</span>
            </div>
            <button
              type="button"
              onClick={() => setQuoteDraft(null)}
              aria-label={chatUiLang === 'en' ? 'Remove quote' : '取消引用'}
              title={chatUiLang === 'en' ? 'Remove quote' : '取消引用'}
            >
              ×
            </button>
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
          {actionNarrationEnabled && (
            <button
              type="button"
              className="btn-action-narration"
              onPointerDown={(event) => event.preventDefault()}
              onClick={insertActionNarration}
              disabled={streaming}
              aria-label="插入动作或旁白括号"
              title="动作与旁白"
            >
              （）
            </button>
          )}
          {streaming ? (
            <button className="btn btn-stop" onClick={handleStop}>
              停止
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-send"
              onPointerDown={(e) => e.preventDefault()}
              onClick={handleSend}
              disabled={!input.trim()}
              aria-label="发送"
              title="发送"
            >
              <SendArrowIcon />
            </button>
          )}
        </div>

        {thinkingUnsupported && <p className="chat-thinking-hint">该模型不支持思考链</p>}

        {activeSessionId && (
          <div className="chat-inline-controls">
            <ChatCompanionControls sessionId={activeSessionId} />
            <div
              className="context-meter-slot"
              ref={contextMeterRef}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setContextMenuOpen(false)
              }}
            >
              <button
                type="button"
                className="context-meter-circle"
                aria-label={contextMeter
                  ? `上下文占用 ${Math.round((contextMeter.used / contextMeter.budget) * 100)}%`
                  : '查看上下文用量'}
                aria-expanded={contextMenuOpen}
                onClick={() => setContextMenuOpen((value) => !value)}
              >
                <span
                  className="context-meter-ring"
                  data-level={contextMeter
                    ? contextMeter.used >= contextMeter.budget
                      ? 'over'
                      : contextMeter.used >= contextMeter.budget * 0.85
                        ? 'high'
                        : contextMeter.used >= contextMeter.budget * 0.7
                          ? 'warn'
                          : 'normal'
                    : 'idle'}
                  style={{
                    background: contextMeter
                      ? `conic-gradient(var(--context-meter-accent) ${Math.min(100, Math.max(0, Math.round((contextMeter.used / contextMeter.budget) * 100)))}%, var(--ui2-hairline, rgba(51, 43, 40, 0.1)) 0)`
                      : undefined,
                  }}
                >
                  <span className="context-meter-value">
                    {contextMeter ? `${Math.min(100, Math.max(0, Math.round((contextMeter.used / contextMeter.budget) * 100)))}%` : '—'}
                  </span>
                </span>
              </button>

              {contextMenuOpen && (
                <div className="context-meter-popover">
                  <div className="context-meter-summary">
                    <strong>{contextMeter ? `上下文 ${Math.round((contextMeter.used / contextMeter.budget) * 100)}%` : '还没有数据'}</strong>
                    {contextMeter && (
                      <span className="context-meter-source">
                        {contextMeter.source === 'actual' ? '本轮真实' : '本轮估算'}
                      </span>
                    )}
                  </div>
                  {contextMeter ? (
                    <div className="context-meter-stats">
                      <span>上下文总量</span><strong>{formatTokenCount(contextMeter.used)} / {formatTokenCount(contextMeter.budget)}</strong>
                      <span>本轮输入</span><strong>{formatTokenCount(contextMeter.inputTokens)}</strong>
                      <span>本轮输出</span><strong>{contextMeter.outputTokens == null ? '—' : formatTokenCount(contextMeter.outputTokens)}</strong>
                      <span>Cache 命中</span><strong>{contextMeter.cachedTokens == null ? '—' : formatTokenCount(contextMeter.cachedTokens)}</strong>
                    </div>
                  ) : (
                    <p>发送一条消息后显示。</p>
                  )}
                  {contextMeter && (
                    <p>{contextMeter.source === 'actual'
                      ? '上下文总量 = 刷新之后这一段的内容量（已用服务商 usage 校准）；本轮输入 / 输出 / Cache 来自最近一轮的服务商 usage。'
                      : '上下文总量 = 刷新之后这一段的内容量（本地估算）；服务商没返回 usage，本轮明细按本地估算。'}</p>
                  )}
                  <div className="context-meter-actions">
                    {!compactDone && (
                      <button
                        type="button"
                        onClick={() => {
                          setContextMenuOpen(false)
                          void handleCompact()
                        }}
                        disabled={contextBusy !== null}
                      >
                        {contextBusy === 'compact' ? '整理中…' : '整理'}
                      </button>
                    )}
                    {!bridgeInfo && hasBridgableHistory(activeMessages, sessionStart) && (
                      <button
                        type="button"
                        onClick={() => {
                          setContextMenuOpen(false)
                          void handleBridge()
                        }}
                        disabled={contextBusy !== null}
                      >
                        {contextBusy === 'bridge' ? '承接中…' : '承接'}
                      </button>
                    )}
                  </div>
                  <div className="context-meter-footer">
                    <button
                      type="button"
                      className="context-meter-detail-toggle"
                      aria-expanded={contextDetailOpen}
                      onClick={() => setContextDetailOpen((value) => !value)}
                    >
                      详情
                    </button>
                  </div>
                  {contextDetailOpen && (
                    <div className="context-meter-detail">
                      <p>
                        <strong>上下文总量</strong>
                        ：刷新对话之后这一段的内容量，聊一句涨一点，只增不减；刷新或整理之后重新起算。本轮输入 / 输出 / Cache 是服务商返回的这一次用量。
                      </p>
                      <p>
                        <strong>承接</strong>
                        ：刷新之后想让 TA 还记得上一段，就点它。TA 会读一遍上一段最后约 30 条里的重点，临时挂在对话里，大约 8 轮后自动退场；上一段的记录不会被搬进来，也不会被删。
                      </p>
                      <p>
                        <strong>整理</strong>
                        ：这一段聊得太长时点它，较早的对话会被压成一段话，最近 12 条保留原文。聊天记录一条不少，只是发给 TA 的形式变了。
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {contextNotice && (
          <div className="context-notice" role="status">{contextNotice}</div>
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
