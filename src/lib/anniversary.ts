// 纪念日（重要的日子）读写，localStorage 存储
// date 支持两种格式：
//   'MM-DD'        每年循环（如生日、认识纪念日）
//   'YYYY-MM-DD'   一次性（如某次约定的日子）
// 纯逻辑（buildDefaultAnniversary / formatCountdown / daysUntil / formatAnniversaryDate / isValidAnniversaryDate）
// 不碰 localStorage，可被 Node 脚本直接跑单测；读写与广播才依赖浏览器。

import { MEMORY_UPDATED_EVENT } from './memory.ts'
import { getFirstSeen } from './storage.ts'

/** 计时模式：正计时（已经 X 天）| 倒计时（还剩 X 天） */
export type CountMode = 'forward' | 'countdown'

export interface Anniversary {
  id: string
  /** 名称：认识纪念日 / 生日 / 在一起纪念日… */
  label: string
  /** 'MM-DD'（每年循环）或 'YYYY-MM-DD'（一次性） */
  date: string
  /** 创建时间戳 */
  createdAt: number
  /** 计时模式：缺省 = 'forward'（默认正计时，兼容旧数据） */
  countMode?: CountMode
  /** 主题色（可选，管理页可设；缺省用默认暖橘） */
  color?: string
}

const ANNIVERSARIES_KEY = 'ai_companion_anniversaries'
/** 主展示纪念日 id（记忆页小卡片显示哪个；null = 默认取列表第一条） */
const MAIN_ANNIVERSARY_KEY = 'ai_companion_main_anniversary'

/** 可选主题色：4-6 个柔和色块（暖橘/暖黄/暖粉/暖蓝/暖绿），跟记忆页 topic-soft 同色系 */
export const ANNIVERSARY_COLORS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'warm-orange', label: '暖橘' },
  { key: 'warm-yellow', label: '暖黄' },
  { key: 'warm-pink', label: '暖粉' },
  { key: 'warm-blue', label: '暖蓝' },
  { key: 'warm-green', label: '暖绿' },
]

const ANNIVERSARY_COLOR_INDEX: Record<string, number> = {
  'warm-orange': 0,
  'warm-yellow': 1,
  'warm-pink': 2,
  'warm-blue': 3,
  'warm-green': 4,
}

/** 主题色 key → 色块索引（缺省暖橘 = 0），组件据此映射到 CSS 类 .ann-color-N */
export function anniversaryColorIndex(color?: string): number {
  const i = ANNIVERSARY_COLOR_INDEX[color ?? '']
  return typeof i === 'number' ? i : 0
}

function newId(): string {
  return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 广播"纪念日有变化"：与记忆共用同一个事件名，记忆页/聊天页监听到就同步刷新 */
function broadcastAnniversariesUpdated(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(new Event(MEMORY_UPDATED_EVENT))
}

/** 读取全部纪念日；数据损坏/格式不对就返回空数组 */
export function loadAnniversaries(): Anniversary[] {
  try {
    const raw = localStorage.getItem(ANNIVERSARIES_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (a): a is Anniversary =>
        a != null && typeof a.id === 'string' && typeof a.label === 'string' && isValidAnniversaryDate(a.date),
    )
  } catch {
    return []
  }
}

/** 保存全部纪念日（调用方负责广播） */
export function saveAnniversaries(list: Anniversary[]): void {
  localStorage.setItem(ANNIVERSARIES_KEY, JSON.stringify(list))
}

/** 新增一条纪念日：新条目放最前，保存并广播，返回更新后的全部纪念日 */
export function addAnniversary(
  label: string,
  date: string,
  fields?: { countMode?: CountMode; color?: string },
): Anniversary[] {
  const l = label.trim()
  const d = date.trim()
  if (!l || !isValidAnniversaryDate(d)) return loadAnniversaries()
  const item: Anniversary = {
    id: newId(),
    label: l,
    date: d,
    createdAt: Date.now(),
    ...(fields?.countMode === 'countdown' ? { countMode: 'countdown' as CountMode } : {}),
    ...(fields?.color?.trim() ? { color: fields.color.trim() } : {}),
  }
  const next = [item, ...loadAnniversaries()]
  saveAnniversaries(next)
  broadcastAnniversariesUpdated()
  return next
}

/** 更新一条纪念日的名称/日期/计时模式/主题色；找不到 id 就原样返回。保存并广播，返回更新后的全部纪念日 */
export function updateAnniversary(
  id: string,
  label: string,
  date: string,
  fields?: { countMode?: CountMode; color?: string },
): Anniversary[] {
  const l = label.trim()
  const d = date.trim()
  if (!l || !isValidAnniversaryDate(d)) return loadAnniversaries()
  const next = loadAnniversaries().map((a) => {
    if (a.id !== id) return a
    if (fields == null) return { ...a, label: l, date: d }
    const out: Anniversary = { ...a, label: l, date: d }
    if (fields.countMode === 'countdown') out.countMode = 'countdown'
    else delete out.countMode
    if (fields.color?.trim()) out.color = fields.color.trim()
    else delete out.color
    return out
  })
  saveAnniversaries(next)
  broadcastAnniversariesUpdated()
  return next
}

/** 删除一条纪念日；找不到 id 就原样返回。保存并广播，返回更新后的全部纪念日 */
export function removeAnniversary(id: string): Anniversary[] {
  const next = loadAnniversaries().filter((a) => a.id !== id)
  saveAnniversaries(next)
  broadcastAnniversariesUpdated()
  return next
}

// ---- 主展示（记忆页小卡片上显示哪个纪念日） ----

/**
 * 读取主展示纪念日 id：null = 未设置（默认取列表第一条）。
 * 读不到 / 存坏返回 null，不影响缺省行为。
 */
export function getMainAnniversaryId(): string | null {
  try {
    return localStorage.getItem(MAIN_ANNIVERSARY_KEY) || null
  } catch {
    return null
  }
}

/** 设置主展示纪念日 id；传 null/空串清除（回到默认取列表第一条）。保存并广播，让记忆页小卡片跟着刷新。 */
export function setMainAnniversaryId(id: string | null): void {
  try {
    if (id == null || id === '') localStorage.removeItem(MAIN_ANNIVERSARY_KEY)
    else localStorage.setItem(MAIN_ANNIVERSARY_KEY, id)
  } catch {
    // 存不下不影响功能：主展示缺省取第一条
  }
  broadcastAnniversariesUpdated()
}

/** 解析主展示纪念日：有主展示 id 且还在列表里 → 用那条；否则（含 id 指向已删除条目）取列表第一条；空列表 → null */
export function resolveMainAnniversary(list: Anniversary[]): Anniversary | null {
  if (!Array.isArray(list) || list.length === 0) return null
  const mainId = getMainAnniversaryId()
  if (mainId) {
    const found = list.find((a) => a.id === mainId)
    if (found) return found
  }
  return list[0]
}

// ---- 日期解析与格式化 ----

/** 解析纪念日日期字符串 → { year?, month, day }；非法返回 null */
function parseAnniversaryDate(date: string): { year?: number; month: number; day: number } | null {
  if (typeof date !== 'string') return null
  const t = date.trim()
  const mm = /^(\d{1,2})-(\d{1,2})$/.exec(t)
  if (mm) {
    const month = Number(mm[1])
    const day = Number(mm[2])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { month, day }
    return null
  }
  const full = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (full) {
    const year = Number(full[1])
    const month = Number(full[2])
    const day = Number(full[3])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { year, month, day }
    return null
  }
  return null
}

/** 日期是否合法：'MM-DD'（每年循环）或 'YYYY-MM-DD'（一次性） */
export function isValidAnniversaryDate(date: string): boolean {
  return parseAnniversaryDate(date) != null
}

/** 本地日历日序号（从 1970 起的天数），用 UTC 算，避免夏令时把一天算成 23/25 小时 */
function dayNumber(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d) / 86400000
}

/** 把相差天数转成倒计时文案：0=今天，1=明天，正=还剩 N 天，负=已过 N 天 */
function countdownLabel(diff: number): string {
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff > 0) return `还剩 ${diff} 天`
  return `已过 ${-diff} 天`
}

/**
 * 纪念日倒计时文案：
 * - 'MM-DD'（每年循环）：按今年算——还没到显示「还剩 N 天」，已过（非今天）显示「已过 N 天」
 * - 'YYYY-MM-DD'（一次性）：按绝对日期算，未来显示「还剩 N 天」，过去显示「已过 N 天」
 * 日期非法返回空串。
 */
export function daysUntil(date: string, now: number = Date.now()): string {
  const parsed = parseAnniversaryDate(date)
  if (!parsed) return ''
  const d = new Date(now)
  const today = dayNumber(d.getFullYear(), d.getMonth() + 1, d.getDate())
  const year = parsed.year ?? d.getFullYear()
  return countdownLabel(dayNumber(year, parsed.month, parsed.day) - today)
}

/**
 * 纪念日展示日期：'MM-DD' →「8月22日」（每年循环不去年份）；
 * 'YYYY-MM-DD' →「2026年8月22日」（一次性带完整年）。非法返回空串。
 */
export function formatAnniversaryDate(date: string): string {
  const parsed = parseAnniversaryDate(date)
  if (!parsed) return ''
  const base = `${parsed.month}月${parsed.day}日`
  return parsed.year != null ? `${parsed.year}年${base}` : base
}

/**
 * 主展示计时文案（纯函数，可 Node 单测）：
 * - forward（正计时）：「已经 X 天」——X = 从最近一次 a.date 到 now 的天数。
 *   日期 'MM-DD'（每年循环）按今年算，今年还没到就按去年那次算（已过则跨年）；
 *   'YYYY-MM-DD'（一次性）按绝对日期算，未来的兜底显示「还剩 N 天」。
 * - countdown（倒计时）：「还剩 X 天」，日期计算与 daysUntil 一致；已过的显示「已过 N 天」。
 * - 今天（差 0 天）统一显示「就是今天」。
 * 无 countMode 按 forward 兼容旧数据。日期非法返回空串。
 */
export function formatCountdown(a: Anniversary, now: number = Date.now()): string {
  const parsed = parseAnniversaryDate(a?.date ?? '')
  if (!parsed) return ''
  const mode = a.countMode ?? 'forward'
  const d = new Date(now)
  const today = dayNumber(d.getFullYear(), d.getMonth() + 1, d.getDate())

  if (mode === 'countdown') {
    const year = parsed.year ?? d.getFullYear()
    const diff = dayNumber(year, parsed.month, parsed.day) - today
    if (diff === 0) return '就是今天'
    if (diff > 0) return `还剩 ${diff} 天`
    return `已过 ${-diff} 天`
  }

  // 正计时
  let diff: number
  if (parsed.year != null) {
    diff = today - dayNumber(parsed.year, parsed.month, parsed.day)
  } else {
    const thisYear = dayNumber(d.getFullYear(), parsed.month, parsed.day)
    diff = thisYear <= today ? today - thisYear : today - dayNumber(d.getFullYear() - 1, parsed.month, parsed.day)
  }
  if (diff === 0) return '就是今天'
  if (diff > 0) return `已经 ${diff} 天`
  return `还剩 ${-diff} 天`
}

/**
 * 纯函数：由 firstSeen 时间戳生成默认「认识纪念日」（date 取 MM-DD，每年循环）。
 * 与 getDefaultAnniversary 拆开，方便 Node 单测。
 */
export function buildDefaultAnniversary(firstSeen: number, now: number = Date.now()): Anniversary {
  const d = new Date(firstSeen)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return {
    id: `default-${mm}-${dd}-${firstSeen}`,
    label: '认识纪念日',
    date: `${mm}-${dd}`,
    createdAt: now,
  }
}

/**
 * 首次进入（还没有任何纪念日、也从没存过纪念日数据）时，用 getFirstSeen() 生成并保存默认「认识纪念日」；
 * 只要 localStorage 里出现过纪念日 key——哪怕是空数组（用户删光过）——就不再生成（删光了不自动复活）。
 */
export function getDefaultAnniversary(): Anniversary | null {
  try {
    if (localStorage.getItem(ANNIVERSARIES_KEY) != null) return null
  } catch {
    // 读不到 key 按首次处理
  }
  const a = buildDefaultAnniversary(getFirstSeen())
  saveAnniversaries([a])
  return a
}
