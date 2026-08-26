// 纪念日（重要的日子）读写，localStorage 存储
// date 支持两种格式：
//   'MM-DD'        每年循环（如生日、认识 TA 的日子）
//   'YYYY-MM-DD'   一次性（如某次约定的日子、里程碑那天）
// 纯逻辑（buildDefaultAnniversary / buildMilestoneAnniversary / formatCountdown / daysUntil /
// formatAnniversaryDate / isValidAnniversaryDate / nextMilestoneDay）不碰 localStorage，
// 可被 Node 脚本直接跑单测；读写与广播才依赖浏览器。

import { MEMORY_UPDATED_EVENT } from './memory.ts'
import { notifyDataChanged } from './dataChange.ts'
import { getFirstSeen } from './storage.ts'
import { getDefaultSessionId, getSessionsCache } from './sessionStore.ts'
import { MILESTONE_DAYS, getKnownDays } from './milestone.ts'

/** 计时模式：正计时（已经 X 天）| 倒计时（还剩 X 天） */
export type CountMode = 'forward' | 'countdown'

export interface Anniversary {
  id: string
  /** 名称：认识 TA 的日子 / 生日 / 在一起纪念日 / 在一起 X 天（里程碑）… */
  label: string
  /** 'MM-DD'（每年循环）或 'YYYY-MM-DD'（一次性） */
  date: string
  /** 创建时间戳 */
  createdAt: number
  /** 计时模式：缺省 = 'forward'（默认正计时，兼容旧数据） */
  countMode?: CountMode
  /** 主题色（可选，管理页可设；缺省用默认暖橘） */
  color?: string
  /**
   * 个人 vs 双人：personal（用户生日/自身节日）存全局纪念日 key（不绑角色）；
   * couple（双人纪念日）存角色 key。老数据缺省 = couple（都是双人）。
   */
  kind?: 'personal' | 'couple'
  /** 生理期专用：周期天数（如 28）。date 存「上次来潮日期」，展示时用周期估算下次来潮日 */
  periodDays?: number
  /**
   * 里程碑条目专用：目标认识天数（如 100，=「在一起 100 天」）。有这个字段就是里程碑，
   * 由 ensureRoleDefaults 自动维护（只保留下一个，认识天数过掉就换），列表打「里程碑」标，不让手动编辑/删除
   */
  milestoneDay?: number
}

// TASK-UI2 角色隔离：按会话分 key（ai_companion_anniversaries_<sid>），无会话回落全局 key（兼容老逻辑）。
// 全局 key 现在装「个人节日」（kind=personal）+ 尚未迁移的旧双人数据；会话 key 装该角色的双人纪念日。
const ANNIVERSARIES_KEY = 'ai_companion_anniversaries'
/** 主展示纪念日 id（记忆页小卡片显示哪个；null = 默认取列表第一条） */
const MAIN_ANNIVERSARY_KEY = 'ai_companion_main_anniversary'
/** 老全局数据已迁移到默认角色 key 的标记（防重复迁移） */
const ANNIVERSARIES_MIGRATED_KEY = 'ai_companion_anniv_migrated'

const anniversariesKey = (sessionId?: string) =>
  sessionId ? `${ANNIVERSARIES_KEY}_${sessionId}` : ANNIVERSARIES_KEY
const mainAnniversaryKey = (sessionId?: string) =>
  sessionId ? `${MAIN_ANNIVERSARY_KEY}_${sessionId}` : MAIN_ANNIVERSARY_KEY

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

/** 内部原始读取：只读某一个 store（全局 或 某会话 key），不触发迁移、不并集 */
function readRaw(sessionId?: string): Anniversary[] {
  try {
    const raw = localStorage.getItem(anniversariesKey(sessionId))
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

/**
 * 首次按会话读取时，把老全局数据迁到「默认角色」名下（TASK-UI2）。
 * 按 kind 拆：personal（用户自己生日/节日）留在全局 key（所有角色共享）；
 * couple / 无 kind 的旧数据（默认双人）整批迁到默认角色 key。
 * 幂等：打过迁移标记 / 没有默认会话 → 直接跳过；全局没数据不打标记，云端同步下来的数据以后还能迁移。
 */
function ensureSessionData(sessionId?: string): void {
  if (!sessionId) return
  // 主展示纪念日 id 同样从老全局 key 挪到默认角色 key
  try {
    const rawMain = localStorage.getItem(MAIN_ANNIVERSARY_KEY)
    if (rawMain != null) {
      const defSid = getDefaultSessionId()
      if (defSid && localStorage.getItem(mainAnniversaryKey(defSid)) == null) {
        localStorage.setItem(mainAnniversaryKey(defSid), rawMain)
      }
    }
  } catch {
    // 迁移失败不阻塞
  }
  if (localStorage.getItem(ANNIVERSARIES_MIGRATED_KEY) != null) return
  try {
    const defaultSid = getDefaultSessionId()
    if (!defaultSid) return
    const globalList = readRaw(undefined)
    if (globalList.length === 0) return // 全局没数据：不打标记，等云端数据同步下来再迁
    const personal = globalList.filter((a) => a.kind === 'personal')
    const couple = globalList.filter((a) => a.kind !== 'personal')
    localStorage.setItem(ANNIVERSARIES_KEY, JSON.stringify(personal))
    if (couple.length > 0) {
      localStorage.setItem(anniversariesKey(defaultSid), JSON.stringify([...couple, ...readRaw(defaultSid)]))
    }
    localStorage.setItem(ANNIVERSARIES_MIGRATED_KEY, '1')
  } catch {
    // 迁移失败不阻塞：数据留在全局 key，遗留模式仍可读，下次再试
  }
}

/**
 * 读取全部纪念日（TASK-UI2 会话感知）：
 * - 无 sessionId → 只读全局 key（老逻辑，兼容遗留模式/同步/测试）
 * - 有 sessionId → 个人节日（全局 key）+ 当前角色双人节日（会话 key）并集，按 createdAt 倒序
 * 数据损坏/格式不对就返回空数组。
 */
export function getAnniversaries(sessionId?: string): Anniversary[] {
  if (sessionId) {
    ensureSessionData(sessionId)
    ensureRoleDefaults(sessionId)
  }
  const global = readRaw(undefined)
  if (!sessionId) return global
  return [...global, ...readRaw(sessionId)].sort((a, b) => b.createdAt - a.createdAt)
}

/** 读取全部纪念日（无会话全局读取；保留旧名字，兼容老调用/同步/测试） */
export function loadAnniversaries(): Anniversary[] {
  return getAnniversaries()
}

/**
 * 云端同步用：汇总全部角色的纪念日（全局个人 + 各会话双人），保证角色隔离后云端仍持有完整数据。
 * 同步本身仍是全局合并（applyData 写全局 key），这里只是防止上传时把角色数据清空。
 */
export function collectAllAnniversaries(): Anniversary[] {
  const out = [...readRaw(undefined)]
  for (const s of getSessionsCache()) {
    const sid = String(s.id)
    if (sid) out.push(...readRaw(sid))
  }
  return out
}

/** 保存全部纪念日到指定 store（缺省全局 key；调用方负责广播） */
export function saveAnniversaries(list: Anniversary[], sessionId?: string): void {
  localStorage.setItem(anniversariesKey(sessionId), JSON.stringify(Array.isArray(list) ? list : []))
  notifyDataChanged()
}

/** 某条纪念日所在的 store 的 key；找不到返回 null（null = 不存在，区别于全局 key） */
function storeKeyOf(id: string, sessionId?: string): string | null {
  if (sessionId && readRaw(sessionId).some((a) => a.id === id)) return anniversariesKey(sessionId)
  if (readRaw(undefined).some((a) => a.id === id)) return ANNIVERSARIES_KEY
  return null
}

/** 新增一条纪念日（TASK-UI2 路由）：kind=personal 存全局 key，couple 存会话 key（无会话回落全局）。
 * 返回更新后的完整展示列表（个人 + 当前角色双人）。 */
export function addAnniversary(
  label: string,
  date: string,
  fields?: { countMode?: CountMode; color?: string; kind?: 'personal' | 'couple'; periodDays?: number },
  sessionId?: string,
): Anniversary[] {
  const l = label.trim()
  const d = date.trim()
  if (!l || !isValidAnniversaryDate(d)) return getAnniversaries(sessionId)
  const kind = fields?.kind ?? 'couple'
  const targetSid = kind === 'personal' ? undefined : sessionId
  // 双人（缺省）不写 kind 字段——老数据没这个字段，保持存储形状不变；只有个人节日显式标 kind=personal
  const item: Anniversary = {
    id: newId(),
    label: l,
    date: d,
    createdAt: Date.now(),
    ...(fields?.countMode === 'countdown' ? { countMode: 'countdown' as CountMode } : {}),
    ...(fields?.color?.trim() ? { color: fields.color.trim() } : {}),
    ...(fields?.periodDays != null && fields.periodDays > 0 ? { periodDays: Math.round(fields.periodDays) } : {}),
    ...(kind === 'personal' ? { kind: 'personal' as const } : {}),
  }
  saveAnniversaries([item, ...readRaw(targetSid)], targetSid)
  broadcastAnniversariesUpdated()
  return getAnniversaries(sessionId)
}

/** 更新一条纪念日的名称/日期/计时模式/主题色；kind 变了会跨 store 挪动（个人 ⇄ 双人）。保存并广播，返回更新后的完整展示列表 */
export function updateAnniversary(
  id: string,
  label: string,
  date: string,
  fields?: { countMode?: CountMode; color?: string; kind?: 'personal' | 'couple'; periodDays?: number },
  sessionId?: string,
): Anniversary[] {
  const l = label.trim()
  const d = date.trim()
  if (!l || !isValidAnniversaryDate(d)) return getAnniversaries(sessionId)
  const currentKey = storeKeyOf(id, sessionId)
  if (currentKey == null) return getAnniversaries(sessionId)
  const currentSid = currentKey === ANNIVERSARIES_KEY ? undefined : sessionId
  const list = readRaw(currentSid)
  const idx = list.findIndex((a) => a.id === id)
  if (idx < 0) return getAnniversaries(sessionId)
  const newKind = fields?.kind ?? list[idx].kind ?? 'couple'
  const newSid = newKind === 'personal' ? undefined : sessionId
  const updated: Anniversary = { ...list[idx], label: l, date: d }
  // 个人显式标 kind=personal；双人（含老数据无字段）不写 kind，保持存储形状兼容
  if (newKind === 'personal') updated.kind = 'personal'
  else delete updated.kind
  if (fields != null) {
    if (fields.countMode === 'countdown') updated.countMode = 'countdown'
    else delete updated.countMode
    if (fields.color?.trim()) updated.color = fields.color.trim()
    else delete updated.color
    if (fields.periodDays != null && fields.periodDays > 0) updated.periodDays = Math.round(fields.periodDays)
    else delete updated.periodDays
  }
  if (newSid === currentSid) {
    list[idx] = updated
    saveAnniversaries(list, newSid)
  } else {
    // 个人 ⇄ 双人：从旧 store 移除，写入新 store
    saveAnniversaries(list.filter((x) => x.id !== id), currentSid)
    saveAnniversaries([updated, ...readRaw(newSid)], newSid)
  }
  broadcastAnniversariesUpdated()
  return getAnniversaries(sessionId)
}

/** 删除一条纪念日（按所在 store 定位）；找不到 id 就原样返回。保存并广播，返回更新后的完整展示列表 */
export function removeAnniversary(id: string, sessionId?: string): Anniversary[] {
  const currentKey = storeKeyOf(id, sessionId)
  if (currentKey != null) {
    const currentSid = currentKey === ANNIVERSARIES_KEY ? undefined : sessionId
    saveAnniversaries(readRaw(currentSid).filter((a) => a.id !== id), currentSid)
    broadcastAnniversariesUpdated()
  }
  return getAnniversaries(sessionId)
}

// ---- 主展示（记忆页小卡片上显示哪个纪念日） ----

/**
 * 读取主展示纪念日 id（会话感知）：null = 未设置（默认取列表第一条）。
 * 读不到 / 存坏返回 null，不影响缺省行为。
 */
export function getMainAnniversaryId(sessionId?: string): string | null {
  try {
    return localStorage.getItem(mainAnniversaryKey(sessionId)) || null
  } catch {
    return null
  }
}

/** 设置主展示纪念日 id（会话感知）；传 null/空串清除（回到默认取列表第一条）。保存并广播，让记忆页小卡片跟着刷新。 */
export function setMainAnniversaryId(id: string | null, sessionId?: string): void {
  try {
    if (id == null || id === '') localStorage.removeItem(mainAnniversaryKey(sessionId))
    else localStorage.setItem(mainAnniversaryKey(sessionId), id)
  } catch {
    // 存不下不影响功能：主展示缺省取第一条
  }
  broadcastAnniversariesUpdated()
  notifyDataChanged()
}

/** 解析主展示纪念日（会话感知）：有主展示 id 且还在列表里 → 用那条；否则（含 id 指向已删除条目）取列表第一条；空列表 → null */
export function resolveMainAnniversary(list: Anniversary[], sessionId?: string): Anniversary | null {
  if (!Array.isArray(list) || list.length === 0) return null
  const mainId = getMainAnniversaryId(sessionId)
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
 * - countdown（倒计时）：「还剩 X 天」——永远指向「下一次」这个日子：日期已过（含带年份的生日）自动顺延到明年同月日。
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
    let y = parsed.year ?? d.getFullYear()
    let diff = dayNumber(y, parsed.month, parsed.day) - today
    if (diff < 0) {
      // 今年的这个日子已过 → 顺延到明年同月日：倒计时永远指向「下一次」（生日/纪念日每年都要过）
      y = d.getFullYear() + 1
      diff = dayNumber(y, parsed.month, parsed.day) - today
    }
    if (diff === 0) return '就是今天'
    return `还剩 ${diff} 天`
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
 * 纯函数：倒计时模式下「下一次」还差多少天（数字）。
 * 日期已过（含带年份的生日）自动顺延到明年同月日；日期非法返回 null。
 */
export function daysUntilNext(a: Anniversary, now: number = Date.now()): number | null {
  const parsed = parseAnniversaryDate(a?.date ?? '')
  if (!parsed) return null
  const d = new Date(now)
  const today = dayNumber(d.getFullYear(), d.getMonth() + 1, d.getDate())
  let y = parsed.year ?? d.getFullYear()
  let diff = dayNumber(y, parsed.month, parsed.day) - today
  if (diff < 0) {
    y = d.getFullYear() + 1
    diff = dayNumber(y, parsed.month, parsed.day) - today
  }
  return diff
}

/**
 * 纯函数：从纪念日列表里挑「最近的下一个大日子」（Big day）。
 * 用 daysUntilNext 比较：>=0 里 diff 最小的那条；列表空/全过返回 null。
 */
export function pickNextBigDay(list: Anniversary[], now: number = Date.now()): Anniversary | null {
  if (!Array.isArray(list) || list.length === 0) return null
  let best: Anniversary | null = null
  let bestDiff = Infinity
  for (const a of list) {
    const diff = daysUntilNext(a, now)
    if (diff != null && diff >= 0 && diff < bestDiff) {
      best = a
      bestDiff = diff
    }
  }
  return best
}

/**
 * 生理期专用：由「上次来潮日期」+ 周期天数估算「下次来潮日」文案。
 * date 须为 'YYYY-MM-DD'（一次性绝对日期）；periodDays 缺省 28。
 * 返回如「预计 9 月 2 日来」；日期非法返回空串。
 */
export function formatPeriodEstimate(a: Anniversary, now: number = Date.now()): string {
  const parsed = parseAnniversaryDate(a?.date ?? '')
  if (!parsed || parsed.year == null) return ''
  const days = Number.isFinite(a.periodDays) && (a.periodDays ?? 0) > 0 ? Math.round(a.periodDays ?? 28) : 28
  const last = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day))
  if (Number.isNaN(last.getTime())) return ''
  const next = new Date(last.getTime() + days * 86400000)
  // 下次已经过了：提醒该更新来潮日期
  const todayStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate())
  if (next.getTime() < todayStart) return '该更新啦'
  return `预计 ${next.getUTCMonth() + 1} 月 ${next.getUTCDate()} 日来`
}

/**
 * 生理期专用：距下次来潮还差几天（数字，>=0）；日期非法返回 null。
 */
export function daysUntilPeriod(a: Anniversary, now: number = Date.now()): number | null {
  const parsed = parseAnniversaryDate(a?.date ?? '')
  if (!parsed || parsed.year == null) return null
  const days = Number.isFinite(a.periodDays) && (a.periodDays ?? 0) > 0 ? Math.round(a.periodDays ?? 28) : 28
  const last = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day))
  if (Number.isNaN(last.getTime())) return null
  const next = last.getTime() + days * 86400000
  const todayStart = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate())).getTime()
  const diff = Math.round((next - todayStart) / 86400000)
  return diff >= 0 ? diff : 0
}

/**
 * 纯函数：由 firstSeen 时间戳生成默认「认识 TA 的日子」（date 取 MM-DD，每年循环）。
 * 与 getDefaultAnniversary 拆开，方便 Node 单测。
 */
export function buildDefaultAnniversary(firstSeen: number, now: number = Date.now()): Anniversary {
  const d = new Date(firstSeen)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return {
    id: `default-${mm}-${dd}-${firstSeen}`,
    label: '认识 TA 的日子',
    date: `${mm}-${dd}`,
    createdAt: now,
  }
}

/**
 * 首次进入（该 store 还没有任何纪念日、也从没存过纪念日数据）时，用 getFirstSeen() 生成并保存默认「认识 TA 的日子」；
 * 只要 localStorage 里出现过该纪念日 key——哪怕是空数组（用户删光过）——就不再生成（删光了不自动复活）。
 * 无会话缺省写全局 key（老逻辑）；有会话时默认双人生成到会话 key，且认识日按该角色自己的 firstSeen 算
 * （每个角色各自的认识日，2026-08-25 七七拍板：跟每个人都有自己的纪念日/里程碑）。
 */
export function getDefaultAnniversary(sessionId?: string): Anniversary | null {
  try {
    if (localStorage.getItem(anniversariesKey(sessionId)) != null) return null
  } catch {
    // 读不到 key 按首次处理
  }
  const a = buildDefaultAnniversary(getFirstSeen(sessionId))
  saveAnniversaries([a], sessionId)
  return a
}

// ---- 里程碑条目（「在一起 X 天」，TASK-UI3 七七拍板：每个角色自动生成，只保留下一个） ----

/** 本地日历日加 N 天 → 'YYYY-MM-DD'（UTC 基准，避免夏令时把一天算成 23/25 小时；纯函数可单测） */
function addLocalDays(ts: number, n: number): string {
  const d = new Date(ts)
  const day = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) + n * 86400000
  const dt = new Date(day)
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/**
 * 纯函数：生成「在一起 X 天」里程碑条目。targetDay = 认识第几天（认识当天 = 第 1 天，与 getKnownDays 同算法），
 * date = 那一天（firstSeen + (targetDay-1) 本地日历日），标 milestoneDay。countMode 用 forward：未来显示「还剩 N 天」，
 * 到了当天显示「就是今天」，过掉当天由 ensureRoleDefaults 换成下一个里程碑。
 */
export function buildMilestoneAnniversary(firstSeen: number, targetDay: number, now: number = Date.now()): Anniversary {
  return {
    id: `milestone-${targetDay}-${firstSeen}`,
    label: `在一起 ${targetDay} 天`,
    date: addLocalDays(firstSeen, targetDay - 1),
    createdAt: now,
    countMode: 'forward',
    milestoneDay: targetDay,
  }
}

/** 下一个里程碑日：认识天数已达/超过后返回下一个目标（认识当天=1，第 7 天 → 7）；超出全部里程碑返回 null */
export function nextMilestoneDay(knownDays: number): number | null {
  const next = (MILESTONE_DAYS as readonly number[]).find((d) => d >= knownDays)
  return next ?? null
}

/** 某条目是否里程碑（有 milestoneDay 即里程碑） */
export function isMilestoneAnniversary(a: Anniversary | null | undefined): boolean {
  return a != null && typeof a.milestoneDay === 'number' && a.milestoneDay > 0
}

/**
 * 首次按会话读取时补默认条目（TASK-UI3，七七拍板每个角色各有一套）：
 * 1) 「认识 TA 的日子」——store key 从未存在才补（getDefaultAnniversary 语义，用户删光不复活）；
 * 2) 下一个「在一起 X 天」里程碑——认识天数过掉当前里程碑就换成下一个；全部过完（730+）移除。
 * 幂等：无变化不写不广播。只在有 sessionId 时生效（无会话 = 遗留全局模式不生成）。
 * 被 getAnniversaries 调用，因此空间页/纪念日页/聊天注入第一次读到就自动补齐。
 */
function ensureRoleDefaults(sessionId?: string): void {
  if (!sessionId) return
  try {
    const raw = localStorage.getItem(anniversariesKey(sessionId))
    const neverInited = raw == null
    const list = readRaw(sessionId)
    const firstSeen = getFirstSeen(sessionId)
    if (!firstSeen) return
    const now = Date.now()
    const changed: Anniversary[] = [...list]
    if (neverInited) {
      changed.push(buildDefaultAnniversary(firstSeen, now))
    }
    const knownDays = getKnownDays(now, sessionId)
    const next = nextMilestoneDay(knownDays)
    const existingIdx = changed.findIndex((a) => isMilestoneAnniversary(a))
    if (next != null) {
      const existing = existingIdx >= 0 ? changed[existingIdx] : null
      if (!existing) {
        changed.push(buildMilestoneAnniversary(firstSeen, next, now))
      } else if (existing.milestoneDay !== next) {
        changed.splice(existingIdx, 1, buildMilestoneAnniversary(firstSeen, next, now))
      }
    } else if (existingIdx >= 0) {
      changed.splice(existingIdx, 1)
    }
    const same = changed.length === list.length && changed.every((a, i) => a.id === list[i].id)
    if (!same) {
      saveAnniversaries(changed, sessionId)
      broadcastAnniversariesUpdated()
    }
  } catch {
    // 保证默认数据失败不阻塞（localStorage 满/损坏）
  }
}
