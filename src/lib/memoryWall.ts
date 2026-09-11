// 记忆墙（TA 记得的）· 展示层只读分组（批 2-2 改版）
// 2026-09-11：从「四组关键词猜（习惯/喜欢/约定/印象）」改为「两大区 + 一张汇总卡」——
//   ①关于你：按记忆 topic 字段分组（饮食/宠物/家人/健康/工作/日子/其他 → 人话组名），有数据才显示，没数据的组不占位；
//   ②我们之间：关系类长期事实（约定/称呼/共同习惯）按关键词挑，挑不出来空态。
// 汇总卡「TA 眼中的你」的指纹/节流策略也在这里（省用户 key：记忆没变绝不调模型）。
// 纯展示层只读映射：不写回 MemoryItem 的 topic，不动记忆注入逻辑，不加字段。
import type { MemoryItem } from './memory.ts'
import { inferTopic } from './memory.ts'

// ── 关于你 · topic → 人话组名（有数据才显示，无数据不占位） ──

export const TOPIC_GROUP_LABELS: Record<string, string> = {
  饮食: '吃喝口味',
  宠物: '你家的毛孩子',
  家人: '你的家人',
  健康: '身体与健康',
  工作: '工作与日常',
  日子: '重要的日子',
  其他: '其他小事',
}

/** topic 组固定展示顺序（内容型 topic；旧数据无 topic 时按 inferTopic 兜底） */
export const TOPIC_ORDER = ['饮食', '宠物', '家人', '健康', '工作', '日子', '其他'] as const

export interface TopicGroup {
  topic: string
  label: string
  list: MemoryItem[]
}

/** 全量记忆 → 「关于你」topic 组（组内按 createdAt 倒序；只读；只返回有数据的组） */
export function groupMemoriesByTopic(memories: MemoryItem[]): TopicGroup[] {
  const map = new Map<string, MemoryItem[]>()
  for (const m of memories) {
    if (!m || typeof m.text !== 'string') continue
    const topic = (m.topic?.trim() || inferTopic(m.text)) || '其他'
    const list = map.get(topic)
    if (list) list.push(m)
    else map.set(topic, [m])
  }
  const out: TopicGroup[] = []
  for (const topic of TOPIC_ORDER) {
    const list = map.get(topic)
    if (list && list.length > 0) {
      list.sort((a, b) => b.createdAt - a.createdAt)
      out.push({ topic, label: TOPIC_GROUP_LABELS[topic] ?? topic, list })
    }
  }
  return out
}

// ── 我们之间 · 关系类长期事实（关键词挑；优先级约定 > 称呼 > 共同习惯） ──

// 约定：直接是约定/承诺（「下次一起」在旧四组里归约定，保留）
const REL_PROMISE_RE = /约定|说好|约好|答应|承诺|约了|下次一起/
// 称呼：TA 怎么叫对方 / 对方让 TA 怎么叫
const REL_NICKNAME_RE = /叫我|管你叫|称呼|昵称|给我起名|叫我叫|叫我喊/
// 共同习惯：你们俩一起做的、规律性的事
const REL_HABIT_RE = /(?:一起|我们俩|我们两个).{0,12}(?:习惯|一起|每周|每天|每晚|每次|经常)/

/** 单条记忆是否「我们之间」（关系类长期事实） */
export function isRelationMemory(m: MemoryItem): boolean {
  const t = typeof m.text === 'string' ? m.text : ''
  return REL_PROMISE_RE.test(t) || REL_NICKNAME_RE.test(t) || REL_HABIT_RE.test(t)
}

/** 全量记忆 → 我们之间（命中即收、去重；按 createdAt 倒序；只读） */
export function pickRelationMemories(memories: MemoryItem[]): MemoryItem[] {
  const out = memories.filter((m) => m && typeof m.text === 'string' && isRelationMemory(m))
  out.sort((a, b) => b.createdAt - a.createdAt)
  return out
}

/** 组摘要：最近一条记忆文本截断（无则空串） */
export function groupSummary(list: MemoryItem[], max = 18): string {
  const first = list[0]
  if (!first) return ''
  const t = first.text.trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

// ── TA 眼中的你 · 指纹（省用户 key：记忆没变绝不调模型） ──

export interface ImpressionCache {
  text: string
  /** 生成时的记忆条数 */
  memCount: number
  /** 生成时最后一条记忆的更新时间（updatedAt ?? createdAt 的最大值） */
  lastMemTs: number
  /** 上次生成时间戳（24h 节流依据） */
  genAt: number
}

export interface ImpressionFingerprint {
  memCount: number
  lastMemTs: number
}

/** 指纹 = 记忆条数 + 最后一条记忆的更新时间；两个都跟缓存一致 → 直接用缓存，绝不调模型 */
export function fingerprintOf(memories: MemoryItem[]): ImpressionFingerprint {
  let memCount = 0
  let lastMemTs = 0
  for (const m of memories) {
    if (!m || typeof m.text !== 'string') continue
    memCount++
    const ts =
      typeof m.updatedAt === 'number' && m.updatedAt > 0
        ? m.updatedAt
        : typeof m.createdAt === 'number' && Number.isFinite(m.createdAt)
          ? m.createdAt
          : 0
    if (ts > lastMemTs) lastMemTs = ts
  }
  return { memCount, lastMemTs }
}

/** 自动生成硬指标：每 24 小时最多 1 次（手动「更新」不受此限） */
export const IMPRESSION_AUTO_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000

export type ImpressionDecision = 'fresh' | 'stale' | 'missing'

/**
 * 打开记忆墙时判断：
 * - fresh：指纹没变 → 直接用缓存，绝不调模型
 * - stale：记忆变了 → 还需满足「距上次生成 >24h」+「用户在页面（或手动点更新）」才真调
 * - missing：没有缓存（或缓存坏了）→ 首次生成
 */
export function decideImpression(
  cache: ImpressionCache | null,
  fp: ImpressionFingerprint,
): ImpressionDecision {
  if (!cache || typeof cache.text !== 'string') return 'missing'
  if (cache.memCount === fp.memCount && cache.lastMemTs === fp.lastMemTs) return 'fresh'
  return 'stale'
}

/** stale/missing 时是否允许自动重生成：距上次生成超过 24 小时（用户手动更新不走这个判断） */
export function shouldAutoRegenerate(cache: ImpressionCache | null, now: number): boolean {
  if (!cache) return true
  return now - cache.genAt >= IMPRESSION_AUTO_MIN_INTERVAL_MS
}
