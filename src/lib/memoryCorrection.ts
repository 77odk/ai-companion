import { updateMemoryItemContent, type MemoryItem } from './memory.ts'
import { patchMemory } from './sessionApi.ts'
import { getMemoriesCache, saveMemoriesCache } from './sessionStore.ts'

export type MemoryCorrectionTarget =
  | { kind: 'global'; item: MemoryItem }
  | { kind: 'session'; sessionId: string; item: MemoryItem; token: string }

export type MemoryCorrectionResult =
  | { ok: true; changed: boolean; item: MemoryItem }
  | { ok: false; message: string }

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
  const response = await patchMemory(target.token, target.item.id, { content: text })
  if (!response.ok) return { ok: false, message: response.message || '保存失败，请重试' }

  const item = { ...target.item, text }
  const cached = getMemoriesCache(target.sessionId)
  if (!cached.some((memory) => memory.id === target.item.id)) {
    return { ok: false, message: '没有找到这段记忆，请刷新后重试' }
  }
  saveMemoriesCache(
    target.sessionId,
    cached.map((memory) => (memory.id === target.item.id ? item : memory)),
  )
  return { ok: true, changed: true, item }
}
