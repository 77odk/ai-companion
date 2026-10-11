import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { StoredMessage } from './storage'
import { loadSettings, loadAIProfile } from './storage'
import {
  addPendingOp,
  confirmMessageInCache,
  getActiveSessionId,
  getBusyState,
  getMessagesCache,
  getSessionsCache,
  getSessionLang,
  markRead,
  newPendingOpId,
  removePendingOp,
  saveBusyState,
  saveMessagesCache,
  type PendingOp,
} from './sessionStore'
import { inferBusyReason, randomBusyDurationMs, serializeBusyContext, type BusyState } from './aiBusy'
import { busyCycleId, cancelBusyReturn, triggerBusyReturn } from './busyReturn'
import { busyReturnFallback, isGroundedBusyReturn, type AvailabilityDecision } from './availability'
import { buildBusyReturnPrompt, buildSystemPrompt, chatCompletion, stripActionMarkers, stripEmoji } from './api'
import { stripMemoryMarkers, stripThinkBlocks } from './memory'
import { getSessionPersona } from './taRuntime'
import { branchIdForNewMessage, loadConversationState, resolveConversationMessages } from './conversationState'
import { enqueueSessionMessageCommit } from './sessionMessageQueue'
import { postMessage } from './sessionApi'
import { getToken } from './auth'
import { allowsBusyState, resolveIdentityMode } from './companionPolicy'
import { ELUVIN_DATA_CHANGE } from './dataChange'

/**
 * 第四组拆分：忙碌生命周期（第二轮拆分第 4 组）。
 * 只搬结构，不改逻辑：isBusy、busyTimerRef、busyTriggeredRef、enterBusyRef、sendBusyReturnRef，
 * 以及进入忙碌、恢复、补发 return 的相关 effect 与判定。
 * 敏感规则一个字不动：真人 Busy 只属于 immersive 档；natural / ai 不许进入、恢复或补发
 * Busy Return；用户主动 Stop 时不许为修复额外发模型请求。
 */
export function useChatBusy(options: {
  activeSessionId: string | null
  visibleMessages: StoredMessage[]
  runIdRef: { current: number }
  mountedRef: { current: boolean }
  setMessages: Dispatch<SetStateAction<StoredMessage[]>>
}) {
  const { activeSessionId, visibleMessages, runIdRef, mountedRef, setMessages } = options

  const [isBusy, setIsBusy] = useState(false)

  // 忙碌状态相关 ref
  const busyTimerRef = useRef<number | null>(null)
  const busyTriggeredRef = useRef(false)
  const enterBusyRef = useRef<(sid: string | null, text: string, decision: AvailabilityDecision, contextMessages?: StoredMessage[]) => void>(() => {})
  const sendBusyReturnRef = useRef<(runId: number, sid: string, state: BusyState) => Promise<void>>(async () => {})

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

  // 切会话 / 刷新上下文：恢复忙碌状态（只有沉浸档允许恢复；自然 / AI 遇到旧 busy 立即取消，
  // 避免模式切换后继续“闭嘴”）。原代码位于 useChatSession 的会话装载 effect 末尾，语义与
  // 时机保持一致：会话装载完成后才执行忙碌恢复。
  useEffect(() => {
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

  return { isBusy, setIsBusy, busyTimerRef, busyTriggeredRef, enterBusyRef }
}
