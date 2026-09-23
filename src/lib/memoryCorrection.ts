import { loadMemory, removeMemoryItem, updateMemoryItemContent, type MemoryItem } from './memory.ts'
import { deleteMemory, patchMemory } from './sessionApi.ts'
import { getMemoriesCache, saveMemoriesCache } from './sessionStore.ts'

export type MemoryCorrectionTarget =
  | { kind: 'global'; item: MemoryItem }
  | { kind: 'session'; sessionId: string; item: MemoryItem; token: string }

export type MemoryCorrectionResult =
  | { ok: true; changed: boolean; item: MemoryItem }
  | { ok: false; message: string }

export type MemoryRemovalResult = { ok: true } | { ok: false; message: string }

const MEMORY_NOT_SYNCED = '这段记忆还没同步完成，请稍后再试'

export interface MemoryCorrectionProposal {
  ref: string
  value: string
}

/** 低成本粗筛：只决定“这一轮要不要把纠正协议告诉模型”，不直接改任何记忆。 */
export function looksLikeMemoryCorrectionIntent(text: string): boolean {
  const t = String(text ?? '').trim()
  if (!t) return false
  return /(?:说错|讲错|记错|写错)(?:了|啦)?|(?:更正|纠正)(?:一下)?|(?:改成|改为).+|不是.{1,30}(?:而是|应该是|其实是|才是)|其实(?:不是|应该是)|i was wrong|i misspoke|correction|i meant|not .+ but .+/i.test(t)
}

/** 模型只可申请，不可直接落库；一次最多取第一条完整申请。 */
export function extractMemoryCorrectionProposal(text: string): MemoryCorrectionProposal | null {
  const raw = String(text ?? '')
  const zh = /【纠正记忆[·・]\s*([gs]:[A-Za-z0-9._-]+)】\s*([^\n]+)/.exec(raw)
  if (zh?.[1] && zh[2]?.trim()) return { ref: zh[1], value: zh[2].trim() }
  const en = /\[Correct Memory\s+([gs]:[A-Za-z0-9._-]+)\]\s*([^\n]+)/i.exec(raw)
  if (en?.[1] && en[2]?.trim()) return { ref: en[1], value: en[2].trim() }
  return null
}

/** 展示/落聊天记录时物理剥掉申请标记；即使弱模型把标记贴在正文末尾也不泄漏。 */
export function stripMemoryCorrectionMarkers(text: string): string {
  return String(text ?? '')
    .split('\n')
    .map((line) => {
      const zhAt = line.indexOf('【纠正记忆')
      const enMatch = /\[Correct Memory\b/i.exec(line)
      const cutAt = zhAt >= 0 && enMatch ? Math.min(zhAt, enMatch.index) : zhAt >= 0 ? zhAt : enMatch?.index ?? -1
      return cutAt >= 0 ? line.slice(0, cutAt).trimEnd() : line
    })
    .filter((line) => line.trim() !== '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function hasMemoryCorrectionMarker(text: string): boolean {
  return /【纠正记忆|\[Correct Memory\b/i.test(String(text ?? ''))
}

/**
 * 用户点“确认纠正”前再对一次当前值。
 * 如果别的设备/页面已经改过这条，就拒绝用旧提案覆盖新值。
 */
export function refreshMemoryCorrectionTarget(target: MemoryCorrectionTarget): MemoryCorrectionTarget | null {
  if (target.kind === 'global') {
    const current = loadMemory().find((memory) => memory.id === target.item.id)
    if (!current || current.text !== target.item.text) return null
    return { kind: 'global', item: current }
  }
  const current = resolveCurrentSessionMemory(getMemoriesCache(target.sessionId), target.item)
  if (!current || current.text !== target.item.text) return null
  return { ...target, item: current }
}

const PENDING_CORRECTION_KEY = 'ai_companion_pending_memory_correction'

interface StoredPendingMemoryCorrection {
  sessionStart: number
  kind: 'global' | 'session'
  item: MemoryItem
  value: string
}

function pendingCorrectionKey(sessionId: string): string {
  return `${PENDING_CORRECTION_KEY}_sid_${sessionId}`
}

/**
 * 未确认提案只存本机，不进云同步；它不是事实，只是等待用户授权的 UI 状态。
 * 退出聊天 / 刷新页面后仍能继续确认，同一个 sessionStart 内才有效。
 */
export function savePendingMemoryCorrection(
  sessionId: string,
  sessionStart: number,
  proposal: { target: MemoryCorrectionTarget; value: string },
): void {
  if (!sessionId || !proposal.value.trim()) return
  const payload: StoredPendingMemoryCorrection = {
    sessionStart,
    kind: proposal.target.kind,
    item: proposal.target.item,
    value: proposal.value.trim(),
  }
  try {
    localStorage.setItem(pendingCorrectionKey(sessionId), JSON.stringify(payload))
  } catch {
    // 本地暂存失败不影响本轮确认
  }
}

export function clearPendingMemoryCorrection(sessionId: string): void {
  if (!sessionId) return
  try {
    localStorage.removeItem(pendingCorrectionKey(sessionId))
  } catch {
    // ignore
  }
}

export function loadPendingMemoryCorrection(
  sessionId: string,
  sessionStart: number,
  token = '',
): { target: MemoryCorrectionTarget; value: string } | null {
  if (!sessionId) return null
  try {
    const raw = localStorage.getItem(pendingCorrectionKey(sessionId))
    if (!raw) return null
    const stored = JSON.parse(raw) as Partial<StoredPendingMemoryCorrection>
    if (
      Number(stored.sessionStart) !== sessionStart ||
      (stored.kind !== 'global' && stored.kind !== 'session') ||
      !stored.item ||
      typeof stored.item !== 'object' ||
      typeof stored.item.id !== 'string' ||
      typeof stored.item.text !== 'string' ||
      typeof stored.value !== 'string' ||
      !stored.value.trim()
    ) {
      clearPendingMemoryCorrection(sessionId)
      return null
    }

    if (stored.kind === 'global') {
      const matches = loadMemory().filter((item) => item.id === stored.item!.id && item.text === stored.item!.text)
      if (matches.length !== 1) {
        clearPendingMemoryCorrection(sessionId)
        return null
      }
      return { target: { kind: 'global', item: matches[0] }, value: stored.value.trim() }
    }

    const current = resolveCurrentSessionMemory(getMemoriesCache(sessionId), stored.item as MemoryItem)
    if (!current || current.text !== stored.item.text) {
      clearPendingMemoryCorrection(sessionId)
      return null
    }
    return {
      target: { kind: 'session', sessionId, item: current, token },
      value: stored.value.trim(),
    }
  } catch {
    clearPendingMemoryCorrection(sessionId)
    return null
  }
}

function isServerMemoryId(id: string): boolean {
  return /^[1-9]\d*$/.test(id)
}

/** reconcileMemoryCacheId only changes id, so these fields identify its pre/post cache entry. */
function sameReconciledMemory(current: MemoryItem, stale: MemoryItem): boolean {
  return current.text === stale.text
    && current.createdAt === stale.createdAt
    && current.source === stale.source
    && current.topic === stale.topic
    && current.taReply === stale.taReply
}

function resolveCurrentSessionMemory(cache: MemoryItem[], stale: MemoryItem): MemoryItem | null {
  const sameId = cache.filter((memory) => memory.id === stale.id)
  if (sameId.length === 1) return sameId[0]
  if (sameId.length > 1) return null

  const reconciled = cache.filter((memory) => sameReconciledMemory(memory, stale))
  return reconciled.length === 1 ? reconciled[0] : null
}

/**
 * Correct only the distilled memory text. Global explicit memories keep using the
 * existing full-blob sync path; session memories are cached only after PATCH succeeds.
 */
export async function correctMemoryText(
  target: MemoryCorrectionTarget,
  value: string,
): Promise<MemoryCorrectionResult> {
  const text = value.trim()
  if (!text) return { ok: false, message: '记住的内容不能为空' }
  if (text === target.item.text) return { ok: true, changed: false, item: target.item }

  if (target.kind === 'global') {
    const next = updateMemoryItemContent(target.item.id, text)
    const item = next.find((memory) => memory.id === target.item.id)
    return item
      ? { ok: true, changed: true, item }
      : { ok: false, message: '没有找到这段记忆，请刷新后重试' }
  }

  if (!target.token) return { ok: false, message: '登录状态已失效，请重新登录后再试' }
  const cached = getMemoriesCache(target.sessionId)
  const current = resolveCurrentSessionMemory(cached, target.item)
  if (!current || !isServerMemoryId(current.id)) return { ok: false, message: MEMORY_NOT_SYNCED }

  const response = await patchMemory(target.token, current.id, { content: text })
  if (!response.ok) return { ok: false, message: response.message || '保存失败，请重试' }

  const item = { ...current, text }
  saveMemoriesCache(
    target.sessionId,
    cached.map((memory) => (memory.id === current.id ? item : memory)),
  )
  return { ok: true, changed: true, item }
}

/**
 * 删掉一条记忆（2026-09-18 七七拍板：记忆页补「删除」入口）。
 * 全局 explicit：只动本地列表，随 /api/sync 全量 blob 同步；
 * 会话记忆：先 DELETE 服务端（后端校验归属），成功后再从本地缓存移除 —— 失败就保留，
 * 绝不在服务端没删掉的情况下先清本地（否则那条记忆会「假消失」再被同步带回来）。
 */
export async function removeMemory(target: MemoryCorrectionTarget): Promise<MemoryRemovalResult> {
  if (target.kind === 'global') {
    // 先确认这条真在本机列表里：不在了（比如别的设备已删）就说清楚，别假装删成功
    const exists = loadMemory().some((memory) => memory.id === target.item.id)
    if (!exists) return { ok: false, message: '没有找到这段记忆，请刷新后重试' }
    removeMemoryItem(target.item.id)
    return { ok: true }
  }

  if (!target.token) return { ok: false, message: '登录状态已失效，请重新登录后再试' }
  const cached = getMemoriesCache(target.sessionId)
  const current = resolveCurrentSessionMemory(cached, target.item)
  if (!current || !isServerMemoryId(current.id)) return { ok: false, message: MEMORY_NOT_SYNCED }

  const response = await deleteMemory(target.token, current.id)
  if (!response.ok) {
    // 404：这条在云端已经不存在了（多半是在别的设备上删过）。服务端是权威，本机也跟着清掉，
    // 别让它继续挂在本机列表里、点一次报一次「找不到」。
    if (response.status === 404) {
      saveMemoriesCache(
        target.sessionId,
        cached.filter((memory) => memory.id !== current.id),
      )
      return { ok: false, message: '这段记忆已经在别的设备删过了，已从这台设备移除' }
    }
    return { ok: false, message: response.message || '删除失败，请重试' }
  }

  saveMemoriesCache(
    target.sessionId,
    cached.filter((memory) => memory.id !== current.id),
  )
  return { ok: true }
}
