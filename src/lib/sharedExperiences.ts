// 一起经历过（Shared Experiences）——空间时间轴的数据源（E3）
// 2026-09-11：数据源从「legacy 记忆按天聚类」换成 Event（getEvents，按会话隔离、occurredAt 倒序）。
// 节点 = 日期 + 标题 + 描述（有才显示）；不显示 confidence/source/id 等内部字段。
// 纯逻辑（排序/格式化）不碰 localStorage 写入，可被 Node 脚本直接跑单测。
import { getEvents, type CompanionEvent } from './eventStore.ts'
import { getFirstSeen } from './storage.ts'
import { computeDaysKnown } from './aiSpaceDetail.ts'

export interface SharedExperience {
  /** Event id（key 用；不展示） */
  id: string
  /** 第 N 天（认识当天 = 第 1 天，与 computeDaysKnown 同算法） */
  day: number
  /** 事件发生时间戳（展示节点日期用） */
  dateTs: number
  /** 事件标题（节点的一句话） */
  title: string
  /** 事件描述（有才显示） */
  description?: string
}

/** 读取「一起经历过」节点（数据源 = Event，未软删，occurredAt 倒序；没有 Event 返回空数组） */
export function getSharedExperiences(sessionId?: string): SharedExperience[] {
  const events: CompanionEvent[] = getEvents(sessionId)
  const firstSeen = getFirstSeen(sessionId || undefined)
  return events.map((e) => ({
    id: e.id,
    day: computeDaysKnown(firstSeen, e.occurredAt),
    dateTs: e.occurredAt,
    title: e.title,
    ...(e.description?.trim() ? { description: e.description.trim() } : {}),
  }))
}

/** 节点日期文案：「09月01日」（时间戳 → MM月DD日，补零） */
export function formatSharedDate(ts: number): string {
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${m}月${dd}日`
}
