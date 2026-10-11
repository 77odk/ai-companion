// 第二轮拆分 · 第 8 组：send 的 payload 组装段下沉（只搬不改）
// 本文件装：cleanAssistantReplyBody / guardAssistantReplyBody（原 Chat.tsx 顶层函数）、
// assembleChatPayload（buildChatContextBlocks 调用 + 上下文估算 + bridge 轮次递减 + apiMessages 拼装）、
// applyContextOverBudget（64k 超限收尾分支）。
// 超限保护逻辑、compact 摘要注入、bridge 尾部注入语义一律与拆分前一致。
import {stripEmoji, stripActionMarkers, flattenActionMarkersForGuard, stripTimeLabels, type ApiMessage} from '../lib/api'
import {stripMemoryMarkers, stripThinkBlocks, detectMemoryInstruction} from '../lib/memory'
import {stripMemoryCorrectionMarkers} from '../lib/memoryCorrection'
import {cleanAttributionArtifacts} from '../lib/promptAttribution'
import type {Lang} from '../lib/langDetect'
import {buildChatContextBlocks, type ChatContextResult} from '../lib/chatContextBuild'
import {buildEstimatedContextState} from '../lib/contextMeterState'
import {setContextBridgeTurns, getContextBridge, type StoredMessage} from '../lib/storage'
import {setReplyLifecycle} from '../lib/replyLifecycle'
import type {Session} from '../lib/sessionApi'

/**
 * PR #99 Session Bridge：只承接“同一 session 刷新前”的历史。
 * sessionStart 是当前角色的上下文分界线，因此天然满足角色隔离；
 * 禁止再用可编辑 title/persona 去猜“是不是同一个 TA”。
 */
export function cleanAssistantReplyBody(raw: string, lang: Lang, preserveActions: boolean): string {
  const base = stripEmoji(
    stripThinkBlocks(stripMemoryCorrectionMarkers(stripMemoryMarkers(raw)), lang),
  )
  return preserveActions
    ? cleanAttributionArtifacts(stripTimeLabels(base), lang).replace(/\s{2,}/g, ' ').trim()
    : stripActionMarkers(base, lang)
}

export function guardAssistantReplyBody(raw: string, lang: Lang, preserveActions: boolean): string {
  const base = stripEmoji(
    stripThinkBlocks(stripMemoryCorrectionMarkers(stripMemoryMarkers(raw)), lang),
  )
  return preserveActions
    ? flattenActionMarkersForGuard(base, lang)
    : stripActionMarkers(base, lang)
}

export interface AssemblePayloadDeps {
  activeSession: Session | null
  activeSessionId: string
  base: StoredMessage[]
  bridgeInfo: ReturnType<typeof getContextBridge>
  compactDone: boolean
  compactSummary: string
  contextBoundary: number
  persona: string
  lang: Lang
  text: string
  userMsg: StoredMessage
  roundVisibleMessages: StoredMessage[]
  replayExistingUser: boolean
  correctionIntent: boolean
  memInstr: ReturnType<typeof detectMemoryInstruction>
  isRetort: boolean
  sessionStart: number
  setContextMeter: (state: ReturnType<typeof buildEstimatedContextState>) => void
  setContextUsage: (state: ReturnType<typeof buildEstimatedContextState>, sessionId: string) => void
  setBridgeInfo: (info: ReturnType<typeof getContextBridge>) => void
}

export interface AssembledPayload {
  composed: ChatContextResult['composed']
  apiMessages: ApiMessage[]
  replyLength: ChatContextResult['replyLength']
  allowActionNarration: boolean
  correctionTargets: ChatContextResult['correctionTargets']
  overBudget: boolean
  bridgeTurnsNext: number | null
}

/** 本轮 payload 组装：buildChatContextBlocks → 上下文估算落盘 → bridge 轮次递减 → apiMessages 拼装。 */
export function assembleChatPayload(deps: AssemblePayloadDeps): AssembledPayload {
  const {
    activeSession, activeSessionId, base, bridgeInfo, compactDone, compactSummary, contextBoundary,
    persona, lang, text, userMsg, roundVisibleMessages, replayExistingUser, correctionIntent, memInstr, isRetort,
    sessionStart, setContextMeter, setContextUsage, setBridgeInfo,
  } = deps

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

  // bridge 只临时参与：本轮真正纳入 payload 后递减轮次，归零后退出（记录保留，不再注入）。
  let bridgeTurnsNext: number | null = null
  if (activeSessionId && bridgeInfo && bridgeInfo.turnsLeft > 0 && composed.includedBlockIds.includes('bridge')) {
    bridgeTurnsNext = bridgeInfo.turnsLeft - 1
    setContextBridgeTurns(activeSessionId, bridgeTurnsNext)
    setBridgeInfo({ ...bridgeInfo, turnsLeft: bridgeTurnsNext })
  }
  apiMessages.splice(0, apiMessages.length, ...composed.messages)

  return {
    composed,
    apiMessages,
    replyLength,
    allowActionNarration,
    correctionTargets,
    overBudget: composed.overBudget,
    bridgeTurnsNext,
  }
}

export interface ApplyOverBudgetDeps {
  replyInterruptionReasonRef: { current: string | null }
  replyBaseMessages: StoredMessage[]
  lifecycleUserTs: number
  assistantTs: number
  persistMessages: (sessionId: string | null, messages: StoredMessage[]) => void
  setMessages: (messages: StoredMessage[]) => void
  setStreaming: (value: boolean) => void
  streamingRef: { current: boolean }
  unregisterActiveReplyRunFn: (sessionId: string | null, userTs: number) => void
  roundSessionId: string | null
  partialTsRef: { current: number | null }
  partialUserTsRef: { current: number | null }
  partialSessionIdRef: { current: string | null }
  setError: (value: string | null) => void
  lang: Lang
}

/** 64k 超限收尾（原 Chat.tsx send 内 overBudget 分支原样下沉）：不静默裁用户原话，撤空占位并结束本轮。 */
export function applyContextOverBudget(deps: ApplyOverBudgetDeps): void {
  const {
    replyInterruptionReasonRef, replyBaseMessages, lifecycleUserTs, assistantTs, persistMessages,
    setMessages, setStreaming, streamingRef, unregisterActiveReplyRunFn, roundSessionId,
    partialTsRef, partialUserTsRef, partialSessionIdRef, setError, lang,
  } = deps
  // 当前用户消息 / 核心 system 本身已经放不进 64k：不静默裁用户原话，也不把超限请求发给 provider。
  // 用户消息已经正常落历史；这里只撤掉空 assistant 占位并结束本轮流式状态。
  replyInterruptionReasonRef.current = 'context-limit'
  const interrupted = setReplyLifecycle(replyBaseMessages, lifecycleUserTs, assistantTs, 'interrupted', 'context-limit')
  persistMessages(roundSessionId, interrupted)
  setMessages(interrupted)
  setStreaming(false)
  streamingRef.current = false
  unregisterActiveReplyRunFn(roundSessionId, lifecycleUserTs)
  partialTsRef.current = null
  partialUserTsRef.current = null
  partialSessionIdRef.current = null
  setError(lang === 'en' ? 'This message is too long for the current context. Please shorten it and send again.' : '这条消息加上当前上下文超过 64k，请缩短后再发。')
}
