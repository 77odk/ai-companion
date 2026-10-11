// 第二轮拆分 · 第 8 组：send 的记忆候选段下沉（只搬不改）
// 本文件装：writeMemory（唯一记忆写入出口）、flushMemoryWrites（TASK-MEM-DISTILL 归并写入）、
// collectMemoryCandidates（本地显式候选收集 + 纠正申请判定）。
// 判重条件、upsertMemoryCache 回读确认、global 侧确认、marker 归并 fallback 语义一律与拆分前一致。
import {getToken} from '../lib/auth'
import {
  cleanMemoryProtocolArtifacts,
  detectMemoryInstruction,
  detectPreferenceFact,
  detectScheduleFact,
  inferTopic,
  isMemoryRetort,
  isSimilarMemory,
  notifyMemoryUpdated,
  stripMemoryKeyword,
  upsertMemoryItem,
  type ExplicitCandidate,
  type MemoryWriteResult,
  loadMemory,
  stripMemoryMarkers,
} from '../lib/memory'
import {getMemoriesCache, upsertMemoryCache, reconcileMemoryCacheId} from '../lib/sessionStore'
import {postMemory} from '../lib/sessionApi'
import {looksLikeMemoryCorrectionIntent} from '../lib/memoryCorrection'
import type {Lang} from '../lib/langDetect'

/** 唯一记忆写入出口：原 Chat.tsx send 内 writeMemory 闭包原样下沉。 */
export function createWriteMemory(activeSessionId: string | null) {
  return (content: string, opts: { source?: string; topic?: string; explicit?: boolean; taReply?: string } = {}): MemoryWriteResult => {
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
}

export interface FlushMemoryWritesDeps {
  replayExistingUser: boolean
  correctionIntent: boolean
  /** 只读 .size（纠正申请存在即禁止 fallback）；类型按原闭包使用面收窄 */
  correctionTargets: { size: number }
  explicitCandidates: ExplicitCandidate[]
  text: string
  lang: Lang
  userMsg: { memorySaved?: boolean }
  writeMemory: ReturnType<typeof createWriteMemory>
  extractMemoriesFn?: (raw: string) => ExplicitCandidate[]
}

/** TASK-MEM-DISTILL：本轮候选 + 模型 marker 统一归并写入。原 Chat.tsx send 内 flushMemoryWrites 闭包原样下沉。 */

export interface CollectMemoryCandidatesInput {
  text: string
  replayExistingUser: boolean
  pendingMemoryCorrection: unknown
  roundVisibleMessages: { role: string; content: string }[]
}

export interface MemoryCandidateState {
  correctionIntent: boolean
  explicitCandidates: ExplicitCandidate[]
  memInstr: ReturnType<typeof detectMemoryInstruction>
  isRetort: boolean
}

/** 本地显式候选收集 + 纠正申请判定（原 Chat.tsx send 内 571-600 行原样下沉，含原缩进）。 */
export function collectMemoryCandidates(input: CollectMemoryCandidatesInput): MemoryCandidateState {
  const { text, replayExistingUser, pendingMemoryCorrection, roundVisibleMessages } = input
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
  return { correctionIntent, explicitCandidates, memInstr, isRetort }
}
