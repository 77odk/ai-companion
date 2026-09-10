// 记忆墙（TA 记得的）· 展示层只读分组
// 2026-09-10 UI 改版第 6 批：现有记忆按内容主题（饮食/宠物/健康…）存储，
// 记忆墙四组（习惯/喜欢/约定/印象）是另一套视角——这里只做一层只读映射，
// 不写回 MemoryItem 的 topic，也不动记忆注入逻辑。
import type { MemoryItem } from './memory.ts'

export type MemoryWallGroup = 'habit' | 'likes' | 'promises' | 'impressions'

export interface MemoryWallGroupMeta {
  key: MemoryWallGroup
  title: string
  empty: string
}

/** 四组固定顺序（定稿第三屏） */
export const MEMORY_WALL_GROUPS: MemoryWallGroupMeta[] = [
  { key: 'habit', title: '关于你的习惯', empty: 'TA 还没记住你的习惯' },
  { key: 'likes', title: '你喜欢的东西', empty: 'TA 还没记住你喜欢什么' },
  { key: 'promises', title: '我们之间的约定', empty: 'TA 还没记住你们的约定' },
  { key: 'impressions', title: 'TA 对你的印象', empty: 'TA 还在慢慢认识你' },
]

// 约定优先判断（"答应你周五一起看电影"既是约定也可能带喜欢，归约定）
const PROMISE_RE = /约定|答应过|答应了|说好|约好|承诺|约了|答应你|下次一起/
const LIKE_RE = /喜欢|最爱|爱吃|爱喝|中意|偏爱|偏好|想要|向往|种草/
const HABIT_RE = /习惯|作息|晚班|早班|夜班|白班|中班|轮班|倒班|值班|睡前|起床|早起|熬夜|失眠|午休|通勤/

/** 单条记忆 → 记忆墙分组；映射不上归「TA 对你的印象」 */
export function classifyMemoryToWall(m: MemoryItem): MemoryWallGroup {
  const t = typeof m.text === 'string' ? m.text : ''
  if (PROMISE_RE.test(t)) return 'promises'
  if (LIKE_RE.test(t)) return 'likes'
  if (HABIT_RE.test(t)) return 'habit'
  return 'impressions'
}

/** 全量记忆 → 四组（组内按 createdAt 倒序；只读，不改原数组） */
export function groupMemoriesByWall(memories: MemoryItem[]): Record<MemoryWallGroup, MemoryItem[]> {
  const out: Record<MemoryWallGroup, MemoryItem[]> = {
    habit: [],
    likes: [],
    promises: [],
    impressions: [],
  }
  for (const m of memories) {
    if (!m || typeof m.text !== 'string') continue
    out[classifyMemoryToWall(m)].push(m)
  }
  for (const key of Object.keys(out) as MemoryWallGroup[]) {
    out[key].sort((a, b) => b.createdAt - a.createdAt)
  }
  return out
}

/** 组摘要：最近一条记忆文本截断（无则空串） */
export function groupSummary(list: MemoryItem[], max = 18): string {
  const first = list[0]
  if (!first) return ''
  const t = first.text.trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}
