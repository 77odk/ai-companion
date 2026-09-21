// #20 · 会话记忆上传失败补传（安全替代 PR #86）
// 不改 sessionStore / sessionApi / MemoryItem 结构：直接复用现有 pendingSync 作为持久待补传标记。
// 补传前两次读取云端确认，避免“请求其实已到服务端但响应丢失”时重复 POST。

import { notifyMemoryUpdated, type MemoryItem } from './memory.ts'
import { deleteMemory, listMemories, postMemory, type SessionMemory } from './sessionApi.ts'
import { getMemoriesCache, saveMemoriesCache } from './sessionStore.ts'
import { recordMemoryIdAlias } from './memoryIdAliases.ts'

const MATCH_TIME_TOLERANCE_MS = 5 * 60 * 1000

export interface MemoryRetryResult {
  uploaded: number
  reconciled: number
  ambiguous: number
  skipped: number
  authExpired: boolean
}

function emptyResult(): MemoryRetryResult {
  return { uploaded: 0, reconciled: 0, ambiguous: 0, skipped: 0, authExpired: false }
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isSamePendingMemory(local: MemoryItem, cloud: SessionMemory): boolean {
  if (clean(local.text) !== clean(cloud.content)) return false

  const cloudTs = Date.parse(cloud.createdAt)
  if (!Number.isFinite(local.createdAt) || !Number.isFinite(cloudTs)) return false
  if (Math.abs(local.createdAt - cloudTs) > MATCH_TIME_TOLERANCE_MS) return false

  const localSource = clean(local.source)
  const localReply = clean(local.taReply)
  if (localSource && localSource !== clean(cloud.source)) return false
  if (localReply && localReply !== clean(cloud.taReply)) return false
  return true
}

function findUniqueCloudMatch(local: MemoryItem, cloud: SessionMemory[]): SessionMemory | null | 'ambiguous' {
  // 一旦本地已经对账成服务端 id，id 是最强证据，不再受 createdAt 时间窗限制。
  // 这覆盖“离线数小时后才补传成功，但 pendingSync 尚未被下一次 hydration 清掉”的情况，
  // 避免下一次 retry 因时间差过大再次 POST。
  const exactIdMatches = cloud.filter((item) => String(item.id) === local.id)
  if (exactIdMatches.length === 1) return exactIdMatches[0]
  if (exactIdMatches.length > 1) return 'ambiguous'

  const matches = cloud.filter((item) => isSamePendingMemory(local, item))
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) return 'ambiguous'
  return null
}

function reconcileKeepingPending(sessionId: string, localId: string, backendId: string | number): boolean {
  const list = getMemoriesCache(sessionId)
  const localIndex = list.findIndex((item) => item.id === localId && item.pendingSync === true)
  if (localIndex < 0) return false

  const local = list[localIndex]
  const serverId = String(backendId)
  const serverIndex = list.findIndex((item, index) => index !== localIndex && item.id === serverId)

  let next: MemoryItem[]
  if (serverIndex >= 0) {
    const server = list[serverIndex]
    const merged: MemoryItem = {
      ...server,
      topic: local.topic ?? server.topic,
      source: local.source ?? server.source,
      taReply: local.taReply ?? server.taReply,
      pinned: local.pinned ?? server.pinned,
      explicit: local.explicit ?? server.explicit,
      lastMentionedAt: local.lastMentionedAt ?? server.lastMentionedAt,
      pendingSync: true,
    }
    next = list.filter((_, index) => index !== localIndex && index !== serverIndex)
    next.splice(Math.min(localIndex, next.length), 0, merged)
  } else {
    next = [...list]
    next[localIndex] = { ...local, id: serverId, pendingSync: true }
  }

  const saved = saveMemoriesCache(sessionId, next)
  if (saved) {
    recordMemoryIdAlias(sessionId, localId, serverId)
    notifyMemoryUpdated()
  }
  return saved
}

function currentPending(sessionId: string, localId: string): MemoryItem | null {
  return getMemoriesCache(sessionId).find((item) => item.id === localId && item.pendingSync === true) ?? null
}

async function runRetryPendingMemoryUploads(token: string, sessionId: string): Promise<MemoryRetryResult> {
  const result = emptyResult()
  const snapshot = getMemoriesCache(sessionId).filter((item) => item.pendingSync === true)
  if (snapshot.length === 0) return result

  const firstList = await listMemories(token, sessionId)
  if (!firstList.ok) {
    if (firstList.status === 401) result.authExpired = true
    result.skipped += snapshot.length
    return result
  }

  for (const snap of snapshot) {
    let local = currentPending(sessionId, snap.id)
    if (!local) {
      result.skipped += 1
      continue
    }

    const firstMatch = findUniqueCloudMatch(local, firstList.data.memories)
    if (firstMatch === 'ambiguous') {
      result.ambiguous += 1
      continue
    }
    if (firstMatch) {
      if (reconcileKeepingPending(sessionId, local.id, firstMatch.id)) result.reconciled += 1
      else result.skipped += 1
      continue
    }

    // POST 前重新确认一次；如果另一台设备刚补上了，这里会只对账、不再重复写。
    const latestList = await listMemories(token, sessionId)
    if (!latestList.ok) {
      if (latestList.status === 401) {
        result.authExpired = true
        return result
      }
      result.skipped += 1
      continue
    }

    local = currentPending(sessionId, local.id)
    if (!local) {
      result.skipped += 1
      continue
    }

    const latestMatch = findUniqueCloudMatch(local, latestList.data.memories)
    if (latestMatch === 'ambiguous') {
      result.ambiguous += 1
      continue
    }
    if (latestMatch) {
      if (reconcileKeepingPending(sessionId, local.id, latestMatch.id)) result.reconciled += 1
      else result.skipped += 1
      continue
    }

    // 二次确认之后、本地仍然存在且仍 pending 才允许 POST；补传开始前已删除的绝不复活。
    local = currentPending(sessionId, local.id)
    if (!local) {
      result.skipped += 1
      continue
    }

    const posted = await postMemory(token, sessionId, {
      content: local.text,
      ...(clean(local.source) ? { source: clean(local.source) } : {}),
      ...(clean(local.taReply) ? { taReply: clean(local.taReply) } : {}),
    })
    if (!posted.ok) {
      if (posted.status === 401) {
        result.authExpired = true
        return result
      }
      result.skipped += 1
      continue
    }

    // 极窄竞态：POST 已发出后用户恰好删掉本地条目。
    // 不把它写回本地，并立即 best-effort 删除刚创建的服务端行，避免下次 hydration 把它复活。
    if (!currentPending(sessionId, local.id)) {
      const cleanup = await deleteMemory(token, posted.data.id)
      if (!cleanup.ok && cleanup.status === 401) result.authExpired = true
      result.skipped += 1
      continue
    }

    // 成功后只换成服务端 ID，暂留 pendingSync；下一次真正看到该 server id 的 hydration 会自然清标记。
    if (reconcileKeepingPending(sessionId, local.id, posted.data.id)) result.uploaded += 1
    else result.skipped += 1
  }

  return result
}

// Chat ref 能挡同一次 mount；这里再挡 StrictMode 重挂载 / 未来其它调用方的并发。
// token 只作为瞬时内存 key 的一部分，任务结束即删除，不持久化、不输出。
const inFlight = new Map<string, Promise<MemoryRetryResult>>()

export function retryPendingMemoryUploads(token: string, sessionId: string): Promise<MemoryRetryResult> {
  if (!token || !sessionId) return Promise.resolve(emptyResult())
  const key = `${sessionId}\u0000${token}`
  const existing = inFlight.get(key)
  if (existing) return existing

  const task = runRetryPendingMemoryUploads(token, sessionId).finally(() => {
    if (inFlight.get(key) === task) inFlight.delete(key)
  })
  inFlight.set(key, task)
  return task
}
