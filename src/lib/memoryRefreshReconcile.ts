import type { MemoryItem } from './memory'

const MATCH_TIME_TOLERANCE_MS = 5 * 60 * 1000

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function hasSameExactPayload(local: MemoryItem, cloud: MemoryItem): boolean {
  return local.pendingSync === true
    && local.id !== cloud.id
    && clean(local.text) === clean(cloud.text)
    && clean(local.source) === clean(cloud.source)
    && clean(local.taReply) === clean(cloud.taReply)
}

function samePendingPayloadWithinWindow(local: MemoryItem, cloud: MemoryItem): boolean {
  if (!hasSameExactPayload(local, cloud)) return false

  const localTs = local.createdAt
  const cloudTs = cloud.createdAt
  if (!Number.isFinite(localTs) || !Number.isFinite(cloudTs)) return false
  return Math.abs(localTs - cloudTs) <= MATCH_TIME_TOLERANCE_MS
}

function candidateIds(local: MemoryItem, cloud: MemoryItem[]): string[] {
  const timed = cloud.filter((server) => samePendingPayloadWithinWindow(local, server))
  if (timed.length > 0) return timed.map((server) => server.id)

  // 手机时间可能与服务端偏差很大。时间窗没有候选时，只接受完整 payload
  // 完全一致的候选；后续双向唯一检查会拒绝任何历史重复记录。
  return cloud.filter((server) => hasSameExactPayload(local, server)).map((server) => server.id)
}

/**
 * Memory 页面刷新专用：把“POST 已落云端、promise 尚未回调”的 pending 本地条目
 * 先对齐到这次 GET 已确认存在的 server id。
 *
 * 只有一对一唯一匹配才对账；任何歧义都保持原样，绝不猜。
 * 这里只换 id，pendingSync 仍保留，随后现有 mergeSessionMemories 看到同 id 的
 * cloud 权威条目后会自然收敛成一条并清掉 pending 标记。
 */
export function alignPendingMemoriesForRefresh(
  cache: MemoryItem[],
  cloud: MemoryItem[],
): MemoryItem[] {
  const pending = cache.filter((item) => item?.pendingSync === true)
  if (pending.length === 0 || cloud.length === 0) return cache

  const candidates = new Map<string, string[]>()
  const reverseCount = new Map<string, number>()

  for (const local of pending) {
    const ids = candidateIds(local, cloud)
    candidates.set(local.id, ids)
    for (const id of ids) reverseCount.set(id, (reverseCount.get(id) ?? 0) + 1)
  }

  let changed = false
  const next = cache.map((item) => {
    if (item.pendingSync !== true) return item
    const ids = candidates.get(item.id) ?? []
    if (ids.length !== 1) return item
    const serverId = ids[0]
    if ((reverseCount.get(serverId) ?? 0) !== 1) return item
    changed = true
    return { ...item, id: serverId }
  })

  return changed ? next : cache
}
