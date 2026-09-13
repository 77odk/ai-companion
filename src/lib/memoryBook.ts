// Memory Book 阅读序列纯函数（UI2-03，展示层）：Cover → Year Chapter → Month Chapter → Memory Page → ...
// 章节是独立 page，与 Memory 页同处一个序列；从 createdAt 在展示层动态构造，不改任何数据。
import type { MemoryItem } from './memory.ts'

export interface DatedMemory {
  item: MemoryItem
  timestamp: number | null
}

export type BookPage =
  | { type: 'year'; year: number }
  | { type: 'month'; year: number; month: number; count: number }
  | { type: 'memory'; index: number }

export function buildBookPages(chronological: DatedMemory[]): BookPage[] {
  const list = Array.isArray(chronological) ? chronological : []
  const monthCount = new Map<string, number>()
  for (const m of list) {
    if (m.timestamp == null) continue
    const d = new Date(m.timestamp)
    const k = `${d.getFullYear()}-${d.getMonth()}`
    monthCount.set(k, (monthCount.get(k) ?? 0) + 1)
  }
  const pages: BookPage[] = []
  for (let i = 0; i < list.length; i++) {
    const ts = list[i].timestamp
    if (ts == null) {
      pages.push({ type: 'memory', index: i })
      continue
    }
    const d = new Date(ts)
    const prevD = i > 0 && list[i - 1].timestamp != null ? new Date(list[i - 1].timestamp as number) : null
    if (i === 0 || prevD == null || prevD.getFullYear() !== d.getFullYear()) {
      pages.push({ type: 'year', year: d.getFullYear() })
    }
    if (prevD == null || prevD.getFullYear() !== d.getFullYear() || prevD.getMonth() !== d.getMonth()) {
      pages.push({ type: 'month', year: d.getFullYear(), month: d.getMonth(), count: monthCount.get(`${d.getFullYear()}-${d.getMonth()}`) ?? 0 })
    }
    pages.push({ type: 'memory', index: i })
  }
  return pages
}
