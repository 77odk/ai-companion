// 第 5 组拆分：上下文块的行为与调用下沉。
// 只搬 handleCompact / handleBridge / invalidateDerivedContextForBranchChange 三个函数（含注释），
// 函数体一字未改（「只搬不改」）。
// 9 组 context 状态（contextMeter / compactDone / compactSummary / bridgeInfo / contextBusy /
// contextNotice / pendingMemoryCorrection / memoryCorrectionBusy / memoryCorrectionNotice）仍在
// useChatSession.ts 里，本 hook 只以入参/返回值接过去用，不重复搬状态（避免两份真源）。
// contextMenuOpen / contextDetailOpen 是 Chat.tsx 本地状态，也以入参传入（invalidate 需要）。
// 复用 src/lib/chatContextBuild.ts、src/lib/contextMeterState.ts 的既有逻辑，不重复实现。
import { chatCompletion, type ApiMessage } from './api'
import { stripMemoryMarkers, stripThinkBlocks } from './memory'
import { cleanAttributionArtifacts } from './promptAttribution'
import { notifyDataChanged } from './dataChange'
import { getSessionLang } from './sessionStore'
import {
  clearContextBridge,
  clearContextUsage,
  getSessionStart,
  loadSettings,
  setContextBridge,
  setContextCompactAt,
  setContextCompactSummary,
  type ContextBridgeState,
  type ContextUsageState,
  type StoredMessage,
} from './storage'
import { clearPendingMemoryCorrection, type MemoryCorrectionTarget } from './memoryCorrection'
import { buildCompactSource, COMPACT_KEEP_RECENT, BRIDGE_ACTIVE_TURNS, BRIDGE_INPUT_BUDGET, BRIDGE_TAIL_COUNT } from './contextComposer'
import { hasBridgableHistory } from '../components/ChatComposer'
import { loadConversationState, type ConversationState } from './conversationState'

export interface UseChatContextBlocksOptions {
  activeSessionId: string | null
  streaming: boolean
  visibleMessages: StoredMessage[]
  activeMessages: StoredMessage[]
  sessionStart: number
  conversationState: ConversationState | null
  // —— 9 组 context 状态来自 useChatSession（跨组共享，只以入参接，不重复搬）——
  compactDone: boolean
  bridgeInfo: ContextBridgeState | null
  contextBusy: 'compact' | 'bridge' | null
  setContextBusy: (value: 'compact' | 'bridge' | null) => void
  setContextNotice: (value: string | null) => void
  setCompactDone: (value: boolean) => void
  setCompactSummary: (value: string) => void
  setBridgeInfo: (value: ContextBridgeState | null) => void
  setContextMeter: (value: ContextUsageState | null) => void
  setPendingMemoryCorrection: (value: { target: MemoryCorrectionTarget; value: string } | null) => void
  setMemoryCorrectionNotice: (value: string | null) => void
  // —— Chat.tsx 本地状态（invalidate 需要）——
  setContextMenuOpen: (value: boolean) => void
  setContextDetailOpen: (value: boolean) => void
  // —— Chat.tsx 本地错误提示（compact/bridge 缺 Key 时使用）——
  setError: (value: string | null) => void
}

/** 上下文块的行为与调用：Compact / Bridge / 分支变化时派生上下文失效清理。 */
export function useChatContextBlocks(options: UseChatContextBlocksOptions) {
  const {
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
  } = options

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

  return { handleCompact, handleBridge, invalidateDerivedContextForBranchChange }
}
