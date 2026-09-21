// Memory 的本地乐观 id 会在上传成功后换成服务端 id。
// 这里保存页面生命周期内的瞬时别名，供详情选择、异步跳转和刷新统一解析；不持久化、不参与同步。

export interface MemoryIdAlias {
  sessionId: string
  oldId: string
  newId: string
}

type MemoryIdAliasListener = (alias: MemoryIdAlias) => void

const aliases = new Map<string, string>()
const listeners = new Set<MemoryIdAliasListener>()
const MAX_ALIASES = 256

function aliasKey(sessionId: string, memoryId: string): string {
  return `${sessionId}\u0000${memoryId}`
}

/** 解析 local → server，支持 A → B → C 连续迁移；异常环路时安全停下。 */
export function resolveMemoryIdAlias(sessionId: string, memoryId: string): string {
  if (!sessionId || !memoryId) return memoryId
  let current = String(memoryId)
  const seen = new Set<string>()
  while (!seen.has(current)) {
    seen.add(current)
    const next = aliases.get(aliasKey(sessionId, current))
    if (!next || next === current) break
    current = next
  }
  return current
}

/** 只在 id 对账真正成功后登记；监听方据此迁移手里仍持有的旧 identity。 */
export function recordMemoryIdAlias(sessionId: string, oldId: string, newId: string): void {
  const scope = String(sessionId ?? '')
  const from = String(oldId ?? '')
  const to = resolveMemoryIdAlias(scope, String(newId ?? ''))
  if (!scope || !from || !to || from === to) return

  const key = aliasKey(scope, from)
  aliases.delete(key)
  aliases.set(key, to)
  while (aliases.size > MAX_ALIASES) {
    const oldest = aliases.keys().next().value
    if (typeof oldest !== 'string') break
    aliases.delete(oldest)
  }

  const alias = { sessionId: scope, oldId: from, newId: to }
  for (const listener of [...listeners]) listener(alias)
}

export function subscribeMemoryIdAliases(listener: MemoryIdAliasListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
