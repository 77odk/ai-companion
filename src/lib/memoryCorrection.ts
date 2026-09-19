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
