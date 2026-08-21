// 记忆（记住的事实）读写，localStorage 存储

export interface MemoryItem {
  id: string
  text: string
  createdAt: number
}

const MEMORY_KEY = 'ai_companion_memory'

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

export function addMemoryItem(text: string): MemoryItem[] {
  const item: MemoryItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
