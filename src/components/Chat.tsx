import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import MessageBubble from './MessageBubble'
import { buildBusyReturnPrompt, buildMemoryBlock, buildSystemPrompt, buildTimeContext, chatCompletion, computeThinkDelayMs, looksFabricated, looksRobotic, streamChat, stripActionMarkers, stripEmoji, stripTimeLabels, type ApiMessage, type ChatError } from '../lib/api'
import { detectMemoryInstruction, detectPreferenceFact, detectScheduleFact, extractMemories, extractThinkBlocks, inferTopic, isMemoryRetort, isSimilarMemory, loadMemory, notifyMemoryUpdated, planMemoryWrites, stripMemoryKeyword, stripMemoryMarkers, stripThinkBlocks, touchMemory, upsertMemoryItem, type ExplicitCandidate, type MemoryWriteResult } from '../lib/memory'
import { getSessionStart, loadMessages, loadPersona, loadSettings, loadAIProfile, loadChatBg, saveMessages, saveSettings, type StoredMessage } from '../lib/storage'
import { verifyChatJumpTarget, type ChatJumpTarget } from '../lib/chatJump'
import { getToken } from '../lib/auth'
import { getAccount } from '../lib/sync'
import { getSession, listMemories, postMemory, postMessage, type Session } from '../lib/sessionApi'
import {
  addPendingOp,
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
import { findBusyCutoff, inferBusyReason, pickBusyReply, randomBusyDurationMs, serializeBusyContext, type BusyState } from '../lib/aiBusy'
import { busyCycleId, cancelBusyReturn, triggerBusyReturn } from '../lib/busyReturn'
import { busyReturnFallback, classifyAvailability, isGroundedBusyReturn, type AvailabilityDecision } from '../lib/availability'
import { loadCurrentPosts } from '../lib/aiSpace'
import { buildSpacePostsBlock, personaHasLifeAnchors, LIFE_BASELINE, LIFE_BASELINE_EN } from '../lib/spaceChatInject'
import { commitPartialReply } from '../lib/partialReply'
import { buildFutureAgendaBlock } from '../lib/futureAgenda'
import { buildSelfTimelineBlock } from '../lib/selfTimeline'
import { buildYourMomentBlock, MOMENT_GUIDE_EN, MOMENT_GUIDE_ZH, shouldInjectYourMoment } from '../lib/yourMoment'
import { buildTaRuntimeContext, getOrAdvanceTaRuntime, getSessionPersona, syncTaRuntimeFromAssistantText } from '../lib/taRuntime'
import { buildIdentityContext } from '../lib/identityContext'
import { dropRepeatedReplies } from '../lib/replyDedupe'
import { buildReplyLengthInstruction, getEffectiveReplyLength } from '../lib/replyLength'

/**
 * 时间流逝感知（2026-09-05 夜 乔修，数据层不加设定）：发给模型的每条历史消息标上相对时间，
 * TA 看到「你 3 小时前发的」自然知道隔了多久——解决「对时间流逝无感」。只在间隔明显时标，不刷屏。
 */
function msgTimeMark(ts: number, lang: Lang): string {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const diff = Date.now() - ts
  if (diff < 2 * 60000) return ''
  const m = Math.floor(diff / 60000)
  if (m < 60) return lang === 'en' ? `[${m} min ago] ` : `[${m} 分钟前] `
  const h = Math.floor(m / 60)
  if (h < 24) return lang === 'en' ? `[${h} h ago] ` : `[${h} 小时前] `
  const days = Math.floor(h / 24)
  if (days === 1) return lang === 'en' ? '[yesterday] ' : '[昨天] '
  return lang === 'en' ? `[${days} days ago] ` : `[${days} 天前] `
}
import { detectLang, type Lang } from '../lib/langDetect'
import { getSessionLang, saveSessionLang } from '../lib/sessionStore'
import { filterSessionMessages } from '../lib/aiSpaceDetail'
import { takeChatMessage } from '../lib/chatInject'
import { extractOpeningLine } from '../lib/customPersona'
import { getMilestoneStatus, markMilestoneShown } from '../lib/milestone'
import { getWeeklyReviews } from '../lib/weeklyReview'
import { recordChatTopic, loadChatTopics } from '../lib/chatTopics'
import { estimateToken, truncateByToken } from '../lib/token'
import { getRecentEvents, formatEventDateShort } from '../lib/eventStore'
import { processEventCandidate } from '../lib/eventDetector'
import MilestoneCard from './MilestoneCard'

/** 总输入 token 预算：系统提示词+记忆注入+历史消息合计不超过此值 */
const TOTAL_INPUT_BUDGET = 64000

const SendArrowIcon = () => (
  <svg
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
  const assistantText = useRef('')
  // 第27条：模型独立思考字段 reasoning_content 累积（DeepSeek/Qwen/Kimi/豆包等），finalize 时合并到 thinking
  const reasoningRef = useRef('')
  // 2026-09-14：生成中途关页面/切后台的兜底（七七实测「退出去再进来，回复没过来」）。
  // partialTsRef = 本轮 assistant 占位消息的 ts（null = 当前没有在生成的回复）；streamingRef 镜像 streaming state
  const partialTsRef = useRef<number | null>(null)
  const streamingRef = useRef(false)
  // 忙碌状态相关 ref
  const busyTimerRef = useRef<number | null>(null)
  const busyTriggeredRef = useRef(false)
  const busyRepliedRef = useRef(false)
  const enterBusyRef = useRef<(text: string, decision: AvailabilityDecision) => void>(() => {})
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
  const enterBusy = (triggerText: string, decision: AvailabilityDecision) => {
    const sid = getActiveSessionId()
    const duration = randomBusyDurationMs()
    const busyUntil = Date.now() + duration
    const reason = inferBusyReason(triggerText)
    const context = serializeBusyContext(visibleMessages.slice(-3))
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
    if (sid) saveBusyState(sid, state)
    setIsBusy(true)
    setBusyReplyText(null)
    busyRepliedRef.current = false
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
        const tail = cache.slice(-3).map((message) => ({
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
        const cleaned = stripActionMarkers(stripEmoji(stripThinkBlocks(stripMemoryMarkers(content), busyLang))).trim()
        return isGroundedBusyReturn(cleaned, selfActivity) ? cleaned : busyReturnFallback(busyLang)
      },
      commit: async (targetSid, content) => {
        const latest = getBusyState(targetSid)
        if (targetSid !== getActiveSessionId() || latest.status !== 'busy') return 'cancelled-before-commit'
        const msg: StoredMessage = { role: 'assistant', content, ts: Date.now() }
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
            payload: { role: msg.role, content: msg.content, thinking: '' }, ts: msg.ts,
          }
          addPendingOp(op)
          const response = await postMessage(token, targetSid, { role: msg.role, content: msg.content })
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
        setBusyReplyText(null)
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
    if (!el) return
    // UI2-03B-1：本次 mount 带 pending jump / 跳转保护窗口内，scroll-bottom 让位（由 jump 接管定位）
    if (jumpAtMountRef.current || jumpHoldRef.current || jumpSuppressRef.current || isChatJumpHolding()) return
    el.scrollTop = el.scrollHeight
  }, [visibleMessages, busyReplyText])

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

  useEffect(() => {
    if (!activeSessionId) return
    const token = getToken()
    if (!token) return
    let cancelled = false
    getSession(token, activeSessionId).then((res) => {
      if (cancelled || !res.ok) return
      setActiveSession(res.data.session)
      const cloud: StoredMessage[] = res.data.messages
        .map((m) => ({ role: m.role, content: m.content, ts: Date.parse(m.createdAt), thinking: m.thinking }))
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
      if (ts == null || finishedRef.current) return
      const raw = assistantText.current
      if (!raw || !raw.trim()) return
      if (leaving) {
        // 页面真的要走了（关页面/离开）：立防重入标记，这次之后不再重复落库
        finishedRef.current = true
        streamingRef.current = false
        partialTsRef.current = null
      }
      const sid = getActiveSessionId()
      const lang = sid ? getSessionLang(sid) : 'zh'
      const text = stripActionMarkers(stripEmoji(stripThinkBlocks(stripMemoryMarkers(raw), lang)))
      const parts = commitPartialReply(sid, ts, text, leaving)
      if (!parts.length) return
      if (leaving) window.dispatchEvent(new CustomEvent('yiwem:ai-reply-committed', { detail: { sid } }))
    }
    const w = window as unknown as Record<string, unknown>
    const prevPage = w.__yiwemHideCommit
    if (typeof prevPage === 'function') window.removeEventListener('pagehide', prevPage as EventListener)
    const prevVis = w.__yiwemVisCommit
    if (typeof prevVis === 'function') document.removeEventListener('visibilitychange', prevVis as EventListener)
    const onPageHide = () => commitPartialOnHide(true)
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

  // 第一批①：切模型串流 bug——保存模型设置=显式切换点，abort 旧请求+作废旧回调+半截话落库
  // 红线：只在显式切换点 abort（切模型/换角色/点停止），离开页面/切 tab 不中断（模块二别被拆）
  useEffect(() => {
    const onModelSettingsChanged = () => {
      runIdRef.current += 1
      if (thinkTimerRef.current !== null) {
        clearTimeout(thinkTimerRef.current)
        thinkTimerRef.current = null
      }
      controllerRef.current?.abort()
      if (displayCleanRef.current) assistantText.current = displayCleanRef.current
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
    const st = getMilestoneStatus(Date.now(), getActiveSessionId() || undefined)
    if (st.hit && !st.shown) {
      setMilestone(st)
      setShowMilestone(true)
    }
  }, [])

  const send = useCallback((raw: string) => {
    // UI2-03B-1：用户自己发了消息 → 立刻解除「看原对话」的跳转保护，恢复正常滚到底。
    // 必须在这里显式释放：不能靠 auto-scroll 里猜「最后一条是不是 user」——
    // 历史最后一条本来就常是 user，那样会在挂载瞬间误解除保护，把列表拉到底。
    releaseJumpHold()
    const text = raw.trim()
    if (!text || streaming) return

    // busy 已到期且 Return 尚未落地时，用户主动回来优先：取消旧 cycle，避免紧跟一条自动“回来”。
    if (activeSessionId && !isBusy) {
      const pendingBusy = getBusyState(activeSessionId)
      if (pendingBusy.status === 'busy' && !pendingBusy.returnSent) {
        cancelBusyReturn(activeSessionId, pendingBusy, { saveState: saveBusyState, onIdle: () => setIsBusy(false) })
      }
    }

    // 忙碌中：不调 API，只回一句"在忙"
    if (isBusy) {
      handleBusySend(text)
      return
    }

    const runId = ++runIdRef.current
    retriedRef.current = false
    busyTriggeredRef.current = false

    const userMsg: StoredMessage = { role: 'user', content: text, ts: Date.now() }

    // TASK-ENGLISH-MODE：计算会话语言（人设优先，人设空看包含当前消息的最近5条用户消息），存 sessionStore
    const personaText = persona?.trim() || ''
    let lang: Lang
    if (personaText) {
      lang = detectLang(personaText)
    } else {
      const recentUserMsgs = [
        ...visibleMessages.filter((m) => m.role === 'user').map((m) => m.content),
        userMsg.content,
      ].slice(-5)
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
      if (explicitCandidates.length === 0 && !rawText) return
      const plans = planMemoryWrites(explicitCandidates, rawText ? extractMemories(rawText) : [], userMsg.content.trim())
      // 当轮 TA 回应短快照（仅追溯展示；去记忆标记/思考链后截断，不整段复制聊天历史）
      const replySnapshot = rawText
        ? stripMemoryMarkers(stripThinkBlocks(rawText, lang)).trim().slice(0, 160) || undefined
        : undefined
      let created = false
      for (const p of plans) {
        const res = writeMemory(p.text, { source: p.source || userMsg.content.trim(), topic: p.topic, explicit: p.explicit, taReply: replySnapshot })
        // 只要这一轮真实新增过 ≥1 条就给一次轻量成功反馈（不再要求必须 explicit）；去重命中 / 写失败都不算
        if (res.created) created = true
      }
      if (created) userMsg.memorySaved = true
      return created
    }

    recordChatTopic(text, getActiveSessionId() || undefined)
    // TASK-MEM-DISTILL：本地显式检测先收集候选、不抢先写——等模型回复的【记忆】marker 到达后统一归并
    // （有 marker 对应 → 只写一条提炼版 explicit；无对应 marker → fallback 写本地候选；只有 marker → 保持 inferred）
    // 候选的 explicit 身份来自用户证据（用户明确说过），text 若被 marker 匹配则采用模型提炼 wording。
    const explicitCandidates: ExplicitCandidate[] = []
    const memInstr = detectMemoryInstruction(text)
    const isRetort = !memInstr.isInstruction && isMemoryRetort(text)
    if (memInstr.isInstruction) {
      const content = (memInstr.fact ?? stripMemoryKeyword(text)).trim()
      if (content.length >= 4) {
        explicitCandidates.push({ text: content, source: text, topic: inferTopic(content) })
      }
    }
    if (explicitCandidates.length === 0) {
      const pref = detectPreferenceFact(text)
      if (pref) {
        explicitCandidates.push({ text: pref, source: text, topic: inferTopic(pref) })
      } else {
        // 作息自动记（2026-09-09 七七拍板）：稳定作息类（上晚班/几点上下班/几点睡）保底提取，补偏好正则的漏网
        const sched = detectScheduleFact(text)
        if (sched) {
          explicitCandidates.push({ text: sched, source: text, topic: '工作' })
        } else if (text.trim().length >= 1 && text.trim().length <= 8) {
        const prevAi = visibleMessages.filter((m) => m.role === 'assistant').slice(-1)[0]
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
    const base = [...visibleMessages, userMsg]
    const assistantTs = Date.now()
    assistantText.current = ''
    reasoningRef.current = ''
    setMessages([...messages, userMsg, { role: 'assistant', content: '', ts: assistantTs }])
    setInput('')
    setError(null)
    setStreaming(true)
    partialTsRef.current = assistantTs
    streamingRef.current = true

    if (activeSessionId) {
      persistMessages([...messages, userMsg])
      uploadMessage(userMsg)
    }

    // Event Candidate Window：只带最近 6 条聊天里最多 2 条历史用户原话；TA 文本永不作为 Event 证据。
    // 本地粗筛仍先跑，只有命中才会消耗每天最多 3 次的精判额度。
    const recentEventUserTexts = visibleMessages
      .slice(-6)
      .filter((m) => m.role === 'user')
      .slice(-2)
      .map((m) => m.content)
    void processEventCandidate({
      sessionId: activeSessionId || undefined,
      userText: userMsg.content,
      recentUserTexts: recentEventUserTexts,
      now: userMsg.ts,
    })

    const nameForPrompt = (() => {
      if (!activeSessionId) return loadAIProfile().nickname
      const cached = getSessionsCache().find((s) => String(s.id) === activeSessionId)
      const t = (cached?.title || activeSession?.title || '').trim()
      if (!t || t === '新会话' || t === '我们的开始') return loadAIProfile(activeSessionId).nickname
      return t
    })()
    const apiMessages: ApiMessage[] = [{ role: 'system', content: buildSystemPrompt(persona, nameForPrompt, undefined, getActiveSessionId() || undefined, lang) }]
    if (activeSessionId) {
      const accountId = getAccount()?.account ?? ''
      const replyLength = getEffectiveReplyLength(accountId, activeSessionId)
      apiMessages.push({ role: 'system', content: buildReplyLengthInstruction(replyLength, lang) })
    }

    const contextText = base
      .slice(-6)
      .map((m) => (m.role === 'assistant' ? stripThinkBlocks(stripMemoryMarkers(m.content), lang) : m.content))
      .join('\n')
    const memory = recallSessionMemories(activeSessionId, contextText)
    if (memory.length > 0) {
      const memoryBlock = buildMemoryBlock(memory, lang)
      if (memoryBlock) {
        apiMessages.push({ role: 'system', content: memoryBlock })
      }
      const now = Date.now()
      for (const m of memory) {
        if (m.pinned) continue
        if (activeSessionId) touchMemoryCache(activeSessionId, m.id, now)
        touchMemory(m.id, now)
      }
    }
    // Event（E3 二处）：最近 5 条一起经历过的事注入（记忆注入之后、自我时间线之前）；
    // 只作背景信息，不让 TA 直接复述
    const recentEvents = getRecentEvents(activeSessionId || undefined, 5)
    if (recentEvents.length > 0) {
      const eventsHeader = lang === 'en'
        ? 'Background info — things you two have been through together (do not repeat these lines as-is):\n'
        : '以上是背景信息，不要直接复述这些句子——你们一起经历过的事：\n'
      apiMessages.push({
        role: 'system',
        content:
          eventsHeader +
          recentEvents.map((e) => `- ${formatEventDateShort(e.occurredAt)}：${e.title}${e.description ? `（${e.description}）` : ''}`).join('\n'),
      })
    }
    // 自我时间线：TA 刚说过的话，让它记得自己做过什么，不依附忙碌机制（TASK-SELF-TIMELINE）
    const timelineBlock = buildSelfTimelineBlock(base, Date.now(), lang)
    if (timelineBlock) {
      apiMessages.push({ role: 'system', content: timelineBlock })
    }
    // TA Runtime（TASK-TA-RUNTIME-V1）：Home 与 Chat 读同一份持久状态、同一 lazy getter。
    // 未到期取同一 activity；到期由 getter 推进，之后 Home 再读也是同一新状态。零额外 LLM。
    const runtime = getOrAdvanceTaRuntime(
      activeSessionId || undefined,
      getSessionPersona(activeSessionId || undefined),
      Date.now(),
    )
    const runtimeCtx = buildTaRuntimeContext(runtime, lang)
    if (runtimeCtx) {
      apiMessages.push({ role: 'system', content: runtimeCtx })
    }
    const identityCtx = buildIdentityContext(activeSessionId || undefined, lang)
    if (identityCtx) {
      apiMessages.push({ role: 'system', content: identityCtx })
    }
    const weeklyList = getWeeklyReviews(activeSessionId || undefined)
    if (weeklyList.length > 0) {
      const w = weeklyList[0]
      // TASK-JOURNAL-INJECT：不只带标题，带最近一篇正文前 200 字摘要，被问"周记写的啥"有内容可答
      const excerpt = (w.content ?? '').trim().slice(0, 200)
      if (lang === 'en') {
        const excerptLine = excerpt ? `\nJournal excerpt: ${excerpt}` : ''
        apiMessages.push({
          role: 'system',
          content: `Your most recent journal entry to them is "${w.title}" (${w.weekLabel}).${excerptLine}\nIf they bring up the journal, respond in the tone and content of this entry.`,
        })
      } else {
        const excerptLine = excerpt ? `\n周记内容摘录：${excerpt}` : ''
        apiMessages.push({
          role: 'system',
          content: `你最近写给对方的周记是「${w.title}」（${w.weekLabel}）。${excerptLine}\n对方要是提起周记，就照这篇的语气和内容回应。`,
        })
      }
    }
    // TA 最近发过的动态注入：让 TA 知道自己的空间历史，被问"你发过…"时有真凭据（TASK-SPACE-CHAT）
    const spaceBlock = buildSpacePostsBlock(loadCurrentPosts(activeSessionId || undefined), 5, lang)
    if (spaceBlock) {
      apiMessages.push({ role: 'system', content: spaceBlock })
    }
    // 未来约定注入（因果链第二环 TASK-FUTURE-AGENDA）：TA 记得「约好还没做的事」，
    // 对方问起/到期临近时能自然接，不会一问三不知；没约定返回空串跳过，不占上下文。
    const agendaBlock = buildFutureAgendaBlock(loadChatTopics(activeSessionId || undefined), new Date(), lang)
    if (agendaBlock) {
      apiMessages.push({ role: 'system', content: agendaBlock })
    }
    // 生活基线：人设没写生活信息时补中性事实锚，让 TA 说"在洗碗/翻书"有根（TASK-SPACE-CHAT）
    if (!personaHasLifeAnchors(persona)) {
      apiMessages.push({ role: 'system', content: lang === 'en' ? LIFE_BASELINE_EN : LIFE_BASELINE })
    }
    // 【你的时刻】分享钩子（TASK-YOUR-MOMENT）：低频给 TA 此刻的生活画面，让"自己有日子在过"落地成画面，
    // 不每次回复都带——只在 对方最近消息冷淡/很短、或连续几条都不长、或对方主动问 TA 近况 时触发；
    // 人设没生活锚时 buildYourMomentBlock 返回空串 → 跳过，不占上下文。不动聊天记录存储/上传/去重/忙碌逻辑。
    const recentUserTexts = base
      .filter((m) => m.role === 'user')
      .slice(-3)
      .map((m) => m.content)
    if (shouldInjectYourMoment(recentUserTexts, lang)) {
      const momentBlock = buildYourMomentBlock(persona, new Date(), lang)
      if (momentBlock) {
        apiMessages.push({
          role: 'system',
          content: `${lang === 'en' ? MOMENT_GUIDE_EN : MOMENT_GUIDE_ZH}\n${momentBlock}`,
        })
      }
    }
    if (memInstr.isInstruction) {
      if (lang === 'en') {
        apiMessages.push({
          role: 'system',
          content: `They just asked you to remember: ${memInstr.fact ?? text}. Write ONLY the fact they explicitly stated — no added subject (don't write "they/you/their name"), no explanation, no inference, no extra conclusions. Keep it short and stable for long-term memory. At the end of your reply, output a separate line with [Memory: Topic] marker (topic word summarizes the category), write this fact as the content, and briefly confirm in your reply that you've noted it.`,
        })
      } else {
        apiMessages.push({
          role: 'system',
          content: `用户刚要求你记住：${memInstr.fact ?? text}。只写用户明确说出的这句事实本身：不加主语（不要写"用户/对方/TA/名字"）、不解释、不推断、不补充他没说的结论，保持简洁、稳定，适合长期记忆。请在回复末尾单独一行输出【记忆·主题】标记（主题词概括类别），内容写这条事实，并在回复里简短确认已经记下。`,
        })
      }
    } else if (isRetort) {
      if (lang === 'en') {
        apiMessages.push({
          role: 'system',
          content:
            'They just reminded you to note down something mentioned earlier. Extract facts worth long-term remembering from the recent conversation (schedule, preferences, health conditions, important experiences, etc.). Write only the facts they actually stated — no added subjects, no explanation, no inference, no extra conclusions. Keep them short and stable. Output a separate [Memory: Topic] line at the end of your reply, and confirm you\'ve noted it.',
        })
      } else {
        apiMessages.push({
          role: 'system',
          content:
            '用户刚才在提醒你记下之前提到的信息。从最近的对话里提取值得长期记住的事实（作息、喜好、身体情况、重要经历等）。每条只写用户实际说过的那些事实本身：不加主语、不解释、不推断、不补充，保持简洁稳定。在回复末尾单独一行输出【记忆·主题】标记，并确认已经记下。',
        })
      }
    }

    // 按总 token 预算动态截断：系统消息占多少，剩下的全给历史消息
    const systemTokens = apiMessages.reduce((sum, m) => sum + estimateToken(m.content), 0)
    const historyBudget = Math.max(0, TOTAL_INPUT_BUDGET - systemTokens)
    const history: ApiMessage[] = truncateByToken(
      base.map((m) => {
        const body =
          m.role === 'assistant' ? stripThinkBlocks(stripMemoryMarkers(m.content), lang) : m.content
        // 时间流逝标记（只注入不改存储）：让 TA 感知每条消息隔了多久
        const mark = msgTimeMark(m.ts, lang)
        return { role: m.role, content: mark ? mark + body : body }
      }),
      historyBudget,
    )
    apiMessages.push(...history)

    // 时间感知（2026-09-05 夜 乔修）：系统提示词开头的时间会被长历史冲淡，部分模型（官方 deepseek 正文/doi 套壳）
    // 生成回复时不看开头。在历史末尾（紧贴要回应的上文）再注入一条此刻时间——数据注入不是设定，所有模型统一可见。
    // 追加防学样说明：历史消息里的 [x分钟前/x小时前/昨天] 标签是系统标注，模型回复严禁输出同类标签（2026-09-05 夜二修：TA 把标签学走了）
    apiMessages.push({
      role: 'system',
      content:
        buildTimeContext(Date.now(), lang) +
        (lang === 'en'
          ? '\nNote: time tags like [3 min ago] in the conversation history are system annotations, not part of any message. Never output such tags in your replies.'
          : '\n注：对话历史里 [3 分钟前]/[昨天] 这类标签是系统自动标注的，不是消息内容。你的回复里绝对不要出现这类时间标签。'),
    })

    const commitFinal = (final: StoredMessage[]) => {
      persistMessages(final)
      // 模块二：组件卸载后跳过 UI 更新，落库/云同步继续执行
      if (mountedRef.current) setMessages(final)
      const sid = getActiveSessionId()
      // v7 #7：只在最终可见回复已经落库后，把 TA 明确说出的“自己正在/马上做什么”写回同一 Runtime。
      // 不读用户文本、不改聊天记录；失败/无可信动作时函数返回 null，保持原 Runtime。
      const committedAssistantText = final
        .filter((m) => m.role === 'assistant' && m.ts === assistantTs)
        .map((m) => m.content)
        .join('\n')
        .trim()
      if (committedAssistantText) {
        syncTaRuntimeFromAssistantText(activeSessionId || undefined, committedAssistantText, Date.now())
      }
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
      // 卸载期间回复完成落库（2026-09-05 夜乔修：返回主界面后 TA 的回复"消失"，发下一条才一起冒出）
      // ——广播事件，重新进入的聊天页实例收到后刷新缓存，让这条回复立即显示
      if (!mountedRef.current) {
        window.dispatchEvent(new CustomEvent('yiwem:ai-reply-committed', { detail: { sid: getActiveSessionId() } }))
      }
      partialTsRef.current = null
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
      if (!busyTriggeredRef.current && raw && availability.state === 'unavailable' && availability.owner === 'SELF') {
        busyTriggeredRef.current = true
        const cut = findBusyCutoff(raw)
        const busyText = cut > 0 && cut < raw.length ? raw.slice(0, cut) : raw
        // TASK-MEM-DISTILL：忙碌截断前先把本轮候选/已到 marker 归并落库（模型给完整回复前 = 无对应 marker → fallback）
        flushMemoryWrites(raw)
        enterBusyRef.current(busyText, availability)
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
      const cleaned = stripActionMarkers(stripEmoji(stripThinkBlocks(stripMemoryMarkers(raw), lang)))
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
      // 回复卫生（2026-09-19）：
      // ① 时间标签兜底——模型可能把历史里的 [3 分钟前] 抄进第二条气泡开头，逐条再剥一次；
      // ② 去复读——丢掉与最近两条 TA 自己消息整条重复的气泡（弱模型实测会连发三条一样的生活状态）。
      const splitParts = cleaned ? splitAssistantReplies(cleaned, assistantTs) : []
      const hygienicParts = splitParts
        .map((m) => ({ ...m, content: stripTimeLabels(m.content).trim() }))
        .filter((m) => m.content !== '')
      const assistantMsgs = dropRepeatedReplies(hygienicParts, messages)
      // 思考链存到第一条 assistant 消息的 thinking 字段（内心戏展示用）
      if (assistantMsgs.length > 0 && thinking) {
        assistantMsgs[0].thinking = thinking
      }
      // 「已记住」徽标必须绑真实写入结果：只有本轮记忆真的落地，才标到 TA 消息上
      if (memoryWroteThisTurn && assistantMsgs.length > 0) {
        assistantMsgs[0].memorySaved = true
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
      const clean = stripThinkBlocks(stripMemoryMarkers(assistantText.current), lang)
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
      const err = streamErrorRef.current
      finalize()  // finalize 自己设置 finishedRef 防重入
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
          const availability = classifyAvailability(assistantText.current)
          if (!busyTriggeredRef.current && availability.state === 'unavailable' && availability.owner === 'SELF') {
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
            // 进入忙碌状态（用 ref 避免闭包）
            enterBusyRef.current(assistantText.current, availability)
          }
        },
        onDone: (reasoning) => {
          if (runId !== runIdRef.current) return
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
    const thinkMs = computeThinkDelayMs(text.length)
    thinkTimerRef.current = window.setTimeout(startStream, thinkMs)
  }, [messages, visibleMessages, streaming, persona, activeSession, activeSessionId, isBusy, persistMessages, uploadMessage])

  useEffect(() => {
    const injected = takeChatMessage()
    if (injected) send(injected)
  }, [send])

  const handleSend = () => {
    const text = input
    if (!text.trim() || streaming) return
    send(text)
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
    controllerRef.current?.abort()
    if (displayCleanRef.current) assistantText.current = displayCleanRef.current
    // 注意：不在这里设 finishedRef，让 finalize 自己设防重入守卫
    // runId++ 已经能阻止 playTick 继续跑
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

      {jumpNotice && (
        <div className="chat-jump-notice" role="status">{jumpNotice}</div>
      )}

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
