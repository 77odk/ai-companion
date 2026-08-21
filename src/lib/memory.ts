// 记忆（记住的事实）读写，localStorage 存储
// 既有字段保持兼容：id / text / createdAt；新加的 source / updatedAt 都是可选字段

export interface MemoryItem {
  id: string
  text: string
  createdAt: number
  /** 来源：哪次对话的摘要（TA 记住时记下，手动添加的没有此项） */
  source?: string
  /** 最近一次更新时间：同一条被去重更新时刷新 */
  updatedAt?: number
}

const MEMORY_KEY = 'ai_companion_memory'

/** 记忆数据变更事件名：保存后广播，记忆页等监听到就重新读取 */
export const MEMORY_UPDATED_EVENT = 'memory-updated'

/** 广播"记忆有变化"：同页签内跨组件通知（storage 事件同页签不触发，所以用自定义事件） */
export function notifyMemoryUpdated(): void {
  window.dispatchEvent(new Event(MEMORY_UPDATED_EVENT))
}

export function loadMemory(): MemoryItem[] {
  try {
    const raw = localStorage.getItem(MEMORY_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (m): m is MemoryItem =>
        m != null && typeof m.id === 'string' && typeof m.text === 'string',
    )
  } catch {
    return []
  }
}

export function saveMemory(items: MemoryItem[]): void {
  localStorage.setItem(MEMORY_KEY, JSON.stringify(items))
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 手动添加一条记忆 */
export function addMemoryItem(text: string): MemoryItem[] {
  const item: MemoryItem = {
    id: newId(),
    text: text.trim(),
    createdAt: Date.now(),
  }
  const next = [item, ...loadMemory()]
  saveMemory(next)
  return next
}

export function removeMemoryItem(id: string): MemoryItem[] {
  const next = loadMemory().filter((m) => m.id !== id)
  saveMemory(next)
  return next
}

// ---- TA 自主记住：去重写入 ----

/** 归一化：去空白和常见标点，统一小写，用来比"像不像" */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s　，。！？、,.!?;；：:""''（）()~～—\-·]/g, '')
}

/** 取字符二元组集合，用来算中文短句的相似度 */
function bigrams(s: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  return out
}

/** 两条记忆是否高度相似：完全相同、互相包含，或字符重合度很高 */
function isSimilar(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  if (a.includes(b) || b.includes(a)) return true
  const A = bigrams(a)
  const B = bigrams(b)
  let same = 0
  for (const g of A) if (B.has(g)) same++
  const union = A.size + B.size - same
  if (union === 0) return false
  return same / union > 0.6
}

/**
 * TA 记住一条内容：先去重——和已有记忆高度相似的，就更新那条（补来源、刷新时间），
 * 否则新增一条。返回更新后的全部记忆。
 */
export function upsertMemoryItem(text: string, source?: string): MemoryItem[] {
  const trimmed = text.trim()
  if (!trimmed) return loadMemory()
  const items = loadMemory()
  const norm = normalize(trimmed)
  const idx = items.findIndex((m) => isSimilar(normalize(m.text), norm))
  const now = Date.now()

  if (idx >= 0) {
    const old = items[idx]
    const next = [...items]
    next[idx] = {
      ...old,
      text: trimmed,
      source: source || old.source,
      updatedAt: now,
    }
    saveMemory(next)
    return next
  }

  const item: MemoryItem = {
    id: newId(),
    text: trimmed,
    createdAt: now,
    updatedAt: now,
    source,
  }
  const next = [item, ...items]
  saveMemory(next)
  return next
}

// ---- 聊天消息里的记忆标记 ----

/** TA 自主记住时用的输出标记：一整行「【记忆】要记住的内容」 */
export const MEMORY_MARKER = '【记忆】'

/** 从一条回复里提取记忆内容（每个「【记忆】xxx」一行算一条） */
export function extractMemories(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const m = /^\s*【记忆】\s*(.+?)\s*$/.exec(line)
    if (m && m[1]) out.push(m[1].trim())
  }
  return out
}

/** 去掉回复里的记忆标记行（仅展示用；存储里保留原文） */
export function stripMemoryMarkers(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*【记忆】/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
