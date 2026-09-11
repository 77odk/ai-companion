// Event（你们一起经历过的事）· 数据层（E1）
// 2026-09-11：Event 类型 + 本地存储 + 会话隔离 + 软删 + 合并 + 周查询。
// 接口契约对齐 E2（识别写入 createEvent({source:'chat'}) / EVENT_CONFIDENCE_THRESHOLD）
// 与 E3（同步 mergeEvents / 手动添加入口 source='manual' / getEventsForWeek / getRecentEvents）。
// 纯逻辑（合并/过滤/排序/周窗口）导出可单测函数；localStorage 读写带 try/catch（Node 无 localStorage 时安全）。
import { notifyDataChanged } from './dataChange.ts'
import { getSessionsCache } from './sessionStore.ts'

/** Event 合法类型白名单（E2 硬过滤「type 合法」/ E3 手动表单类型下拉共用） */
export const EVENT_TYPES = ['activity', 'meal', 'trip', 'milestone', 'celebration'] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const EVENT_SOURCE_CHAT = 'chat'
export const EVENT_SOURCE_MANUAL = 'manual'
export type EventSource = 'chat' | 'manual'

export interface CompanionEvent {
  /** 随机不可猜（crypto.randomUUID，Node/浏览器通用） */
  id: string
  /** 会话隔离：角色 id；空串 = 无会话全局（E2：A 角色检出的 Event，B 角色看不到） */
  sessionId: string
  /** 类型：EVENT_TYPES 白名单内（识别硬过滤校验；手动默认 activity） */
  type: EventType
  /** 非空（识别硬过滤 / 手动表单必填） */
  title: string
  /** 可选描述 */
  description?: string
  /** 事件发生时间戳（ms）；不晚于当前时间（E2 硬过滤未来拒 / 手动表单未来拒） */
  occurredAt: number
  /** 首次创建时间戳 */
  createdAt: number
  /** 最近更新/软删时间戳（合并取新 / 软删覆盖存活的依据） */
  updatedAt: number
  /** 软删标记：非空 = 已删除（列表隐藏，但保留待同步到其他设备） */
  deletedAt?: number | null
  /** 置信度 0-1：识别按阈值过滤；手动添加恒为 1 */
  confidence: number
  /** 来源：chat（识别写入）/ manual（用户手动添加） */
  source: EventSource
}

const EVENTS_KEY_PREFIX = 'ai_companion_events'

/** 存储 key：有会话按会话隔离（ai_companion_events_<sid>），无会话回落全局（ai_companion_events） */
export function eventsKey(sessionId?: string): string {
  return sessionId ? `${EVENTS_KEY_PREFIX}_${sessionId}` : EVENTS_KEY_PREFIX
}

/** 会话 id 归一：undefined → 空串（全局） */
export function normSession(sessionId?: string): string {
  return sessionId?.trim() || ''
}

export function newEventId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  }
}

// ---- 纯逻辑（可单测，不碰 localStorage） ----

/** 可见过滤：未软删的 */
export function filterVisibleEvents(list: CompanionEvent[]): CompanionEvent[] {
  return (list ?? []).filter((e) => e && e.deletedAt == null)
}

/** 排序：occurredAt 倒序（同一天按 createdAt 新在前） */
export function sortEventsDesc(list: CompanionEvent[]): CompanionEvent[] {
  return [...(list ?? [])].sort((a, b) => {
    if (b.occurredAt !== a.occurredAt) return b.occurredAt - a.occurredAt
    return b.createdAt - a.createdAt
  })
}

/**
 * 合并（E3：照 mergeMessages/mergeMemory 模式）：按 id 合并，同 id 取 updatedAt 更新的那条；
 * deletedAt 非空的覆盖存活的（软删要能同步到其他设备）。
 * 顺序无关：cloud 和 local 谁新谁赢。
 */
export function mergeEvents(
  local: CompanionEvent[],
  cloud: CompanionEvent[],
): CompanionEvent[] {
  const map = new Map<string, CompanionEvent>()
  for (const e of [...(cloud ?? []), ...(local ?? [])]) {
    if (e == null || typeof e.id !== 'string' || !e.id) continue
    const prev = map.get(e.id)
    if (!prev || e.updatedAt >= prev.updatedAt) map.set(e.id, e)
  }
  return [...map.values()]
}

/** 周窗口查询（E3 Weekly）：某会话 occurredAt ∈ [start, end) 的可见事件，倒序 */
export function getEventsForWeek(
  sessionId: string | undefined,
  start: number,
  end: number,
): CompanionEvent[] {
  return sortEventsDesc(
    filterVisibleEvents(readRaw(sessionId)).filter((e) => e.occurredAt >= start && e.occurredAt < end),
  )
}

/** 校验一条待创建的事件（E2 硬过滤的前置）：title 非空 / occurredAt 合法 / type 合法；返回错误原因或 null */
export function validateEventInput(
  input: Pick<CompanionEvent, 'title' | 'occurredAt' | 'type'>,
): string | null {
  if (typeof input.title !== 'string' || !input.title.trim()) return 'title-empty'
  if (
    typeof input.occurredAt !== 'number' ||
    !Number.isFinite(input.occurredAt) ||
    input.occurredAt <= 0
  )
    return 'occurredAt-invalid'
  if (!EVENT_TYPES.includes(input.type as EventType)) return 'type-invalid'
  return null
}

// ---- 存储层（localStorage，带 try/catch） ----

function readRaw(sessionId?: string): CompanionEvent[] {
  try {
    const raw = localStorage.getItem(eventsKey(sessionId))
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as CompanionEvent[]) : []
  } catch {
    return []
  }
}

function writeRaw(sessionId: string | undefined, list: CompanionEvent[]): void {
  try {
    localStorage.setItem(eventsKey(sessionId), JSON.stringify(list))
  } catch {
    // 存不下不影响
  }
  try {
    notifyDataChanged()
  } catch {
    // 静默
  }
}

/** 读某会话全量 Event（含已软删的，供合并/统计；展示请用 getEvents） */
export function loadEvents(sessionId?: string): CompanionEvent[] {
  return readRaw(sessionId)
}

/** 覆盖写某会话 Event 列表 */
export function saveEvents(sessionId: string | undefined, list: CompanionEvent[]): void {
  writeRaw(sessionId, list)
}

/** 展示用：某会话可见 Event，occurredAt 倒序 */
export function getEvents(sessionId?: string): CompanionEvent[] {
  return sortEventsDesc(filterVisibleEvents(readRaw(sessionId)))
}

/** 最近 n 条可见 Event（聊天注入用，E3） */
/** 展示/注入用短日期（设备本地时区）：YYYY-MM-DD（注入给模型的背景带上时间，模型才能说对"上次""上周"） */
export function formatEventDateShort(ts: number): string {
  const d = new Date(ts)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export function getRecentEvents(sessionId?: string, n = 5): CompanionEvent[] {
  return getEvents(sessionId).slice(0, n)
}

/**
 * 创建 Event（E2 识别写入 / E3 手动添加共用）。
 * 校验不过返回 null（不写库）；成功写库并广播数据变更。
 */
export function createEvent(input: {
  sessionId?: string
  type?: EventType
  title: string
  description?: string
  occurredAt: number
  confidence?: number
  source: EventSource
}): CompanionEvent | null {
  const sid = normSession(input.sessionId)
  const type = input.type ?? 'activity'
  const err = validateEventInput({ title: input.title, occurredAt: input.occurredAt, type })
  if (err) return null
  const now = Date.now()
  const ev: CompanionEvent = {
    id: newEventId(),
    sessionId: sid,
    type,
    title: input.title.trim(),
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    occurredAt: input.occurredAt,
    createdAt: now,
    updatedAt: now,
    confidence: typeof input.confidence === 'number' ? input.confidence : 1,
    source: input.source,
  }
  const list = readRaw(sid)
  list.push(ev)
  writeRaw(sid, list)
  return ev
}

/** 更新 Event（编辑）：id 找不到返回 null；updatedAt 刷新 */
export function updateEvent(
  sessionId: string | undefined,
  id: string,
  patch: Partial<Pick<CompanionEvent, 'title' | 'description' | 'occurredAt' | 'type'>>,
): CompanionEvent | null {
  const sid = normSession(sessionId)
  const list = readRaw(sid)
  const idx = list.findIndex((e) => e.id === id)
  if (idx < 0) return null
  const next: CompanionEvent = {
    ...list[idx],
    ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
    ...(patch.description !== undefined
      ? patch.description.trim()
        ? { description: patch.description.trim() }
        : { description: undefined }
      : {}),
    ...(patch.occurredAt !== undefined ? { occurredAt: patch.occurredAt } : {}),
    ...(patch.type !== undefined ? { type: patch.type } : {}),
    updatedAt: Date.now(),
  }
  if (validateEventInput({ title: next.title, occurredAt: next.occurredAt, type: next.type })) return null
  list[idx] = next
  writeRaw(sid, list)
  return next
}

/** 软删：deletedAt = now（列表立刻消失，状态保留待同步） */
export function softDeleteEvent(sessionId: string | undefined, id: string): boolean {
  const sid = normSession(sessionId)
  const list = readRaw(sid)
  const idx = list.findIndex((e) => e.id === id)
  if (idx < 0) return false
  list[idx] = { ...list[idx], deletedAt: Date.now(), updatedAt: Date.now() }
  writeRaw(sid, list)
  return true
}

/** 云端同步用：汇总全部角色的 Event（全局 + 各会话，含软删——软删要同步到其他设备） */
export function collectAllEvents(): CompanionEvent[] {
  const out: CompanionEvent[] = []
  const globalList = readRaw(undefined)
  if (globalList.length > 0) out.push(...globalList)
  for (const s of getSessionsCache()) {
    const sid = String(s.id)
    if (sid) {
      const list = readRaw(sid)
      if (list.length > 0) out.push(...list)
    }
  }
  return out
}

/**
 * applyData 用：把合并后的全量 Event 按 sessionId 分组写回各 key（全局的写全局 key，会话的写各自 key）。
 * 没有该 key 时不创建空 key。返回写回的角色 key 数。
 */
export function distributeEventsToKeys(all: CompanionEvent[]): number {
  const bySid = new Map<string, CompanionEvent[]>()
  for (const e of all ?? []) {
    if (e == null || typeof e.id !== 'string') continue
    const sid = e.sessionId ?? ''
    const list = bySid.get(sid)
    if (list) list.push(e)
    else bySid.set(sid, [e])
  }
  let wrote = 0
  for (const [sid, list] of bySid) {
    writeRaw(sid || undefined, list)
    wrote++
  }
  return wrote
}

/** 本地全量合并云端（E3 同步）：每个 key 各自 mergeEvents（本地优先写回），再分发 */
export function applyCloudEvents(cloud: CompanionEvent[]): number {
  if (!Array.isArray(cloud) || cloud.length === 0) return 0
  // 先按 sid 分云端数据
  const bySid = new Map<string, CompanionEvent[]>()
  for (const e of cloud) {
    if (e == null || typeof e.id !== 'string') continue
    const sid = e.sessionId ?? ''
    const list = bySid.get(sid)
    if (list) list.push(e)
    else bySid.set(sid, [e])
  }
  // 涉及的 key：云端有的 + 本地已有的（全局 key + 每个会话 key）
  const keys = new Set<string>(bySid.keys())
  keys.add('')
  for (const s of getSessionsCache()) keys.add(String(s.id))
  let wrote = 0
  for (const sid of keys) {
    const local = readRaw(sid || undefined)
    const cloudList = bySid.get(sid) ?? []
    const merged = mergeEvents(local, cloudList)
    if (merged.length > 0 || local.length > 0) {
      writeRaw(sid || undefined, merged)
      wrote++
    }
  }
  return wrote
}
