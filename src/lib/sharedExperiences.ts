// 一起经历过（Shared Experiences）——空间时间轴的数据源
// 当前实现 = 记忆按天聚类（legacy）；Event 上线后只换这里（getSharedExperiences 内部），调用方不动。
//
// 逻辑：把该角色的记忆按「第 N 天」聚类，每天取最早一条（第一次发生的那条），倒序返回。
// 与聊天注入、记忆墙同源：关于我（全局 explicit，所有角色共享）+ 当前角色会话记忆。
// 纯逻辑（聚类/排序）不碰 localStorage，可被 Node 脚本直接跑单测。

import { loadMemory, type MemoryItem } from './memory.ts'
import { getMemoriesCache } from './sessionStore.ts'
import { getFirstSeen } from './storage.ts'
import { computeDaysKnown } from './aiSpaceDetail.ts'

export interface SharedExperience {
  /** 第 N 天（认识当天 = 第 1 天，与 computeDaysKnown 同算法） */
  day: number
  /** 当天最早一条记忆的时间戳（展示节点日期用） */
  dateTs: number
  /** 当天第一条记忆的原文（节点的一句话） */
  text: string
}

/** 读取「一起经历过」节点（legacy：记忆按天聚类；Event 上线后只换这里） */
export function getSharedExperiences(sessionId?: string): SharedExperience[] {
  const global = loadMemory().filter((m) => m.explicit === true)
  const memories: MemoryItem[] = sessionId ? [...global, ...getMemoriesCache(sessionId)] : global
  const firstSeen = getFirstSeen(sessionId || undefined)
  const byDay = new Map<number, MemoryItem>()
  for (const m of memories) {
    if (!m || typeof m.createdAt !== 'number' || !Number.isFinite(m.createdAt)) continue
    const n = computeDaysKnown(firstSeen, m.createdAt)
    if (!byDay.has(n) || m.createdAt < (byDay.get(n)?.createdAt ?? Infinity)) {
      byDay.set(n, m)
    }
  }
  return [...byDay.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([n, m]) => ({ day: n, dateTs: m.createdAt, text: m.text }))
}

/** 节点日期文案：「09月01日」（时间戳 → MM月DD日，补零） */
export function formatSharedDate(ts: number): string {
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${m}月${dd}日`
}
