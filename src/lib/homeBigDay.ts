// 首页「时间关系卡」数据层（TASK-HOME-BIG-DAY-V2）
// A. 最近的重要日子：couple + personal 都可成为 Big Day，排除里程碑条目，用 pickNextBigDay 自动选最近。
// B. 关系里程碑进度：认识天数在 7/30/100/365/730 区间内的位置（纯函数，可 Node 单测）。
// 纯逻辑不碰 localStorage（list 由调用方传入）；Home.tsx 里用 getAnniversaries(sessionId) 提供真实候选。

import { isMilestoneAnniversary, pickNextBigDay, type Anniversary } from './anniversary.ts'
import { MILESTONE_DAYS } from './milestone.ts'

/**
 * Big Day 候选：couple + personal 均可，剔除里程碑条目（避免与下方关系里程碑重复）。
 * 纯过滤，不改数据；传入 list 为 null/空 → 空数组。
 */
export function homeBigDayCandidates(list: Anniversary[] | null | undefined): Anniversary[] {
  if (!Array.isArray(list)) return []
  return list.filter((a) => a != null && !isMilestoneAnniversary(a))
}

/**
 * 最近的重要日子：从候选中用 daysUntilNext 选「下一次最近」的一条（跨年 MM-DD 自动顺延）。
 * 没有任何可展示的重要日子 → null（组件走 empty/fallback，不伪造）。
 */
export function pickHomeBigDay(
  list: Anniversary[] | null | undefined,
  now: number = Date.now(),
): Anniversary | null {
  return pickNextBigDay(homeBigDayCandidates(list), now)
}

/** 里程碑进度计算结果 */
export interface MilestoneProgress {
  /** 认识第 N 天（firstSeen 当天算第 1 天） */
  day: number
  /** 上一里程碑（day < 7 时为 0 = 认识起点）；当天等于 day 时为「已到达」的那个 */
  previous: number
  /** 下一里程碑；730 之后为 null（轨迹保持完成态） */
  next: number | null
  /** 0–1，clamp；里程碑当天 = 新区间起点 0，730 之后恒为 1 */
  progress: number
  /** 今天是否正好落在里程碑日（7/30/100/365/730） */
  reached: boolean
}

/**
 * 纯函数：认识天数 → 里程碑区间进度。
 * 规则：里程碑当天表示「刚完成的区间」——previous = 最后一个 < day 的里程碑（day < 第一个时 = 0）；
 * next = 第一个 >= day 的里程碑（当天包含，reached 时 next 就是当天）；
 * progress = (day - previous) / (next - previous)，clamp 0–1（day=7 → 1，刚完成 0→7 段）；
 * next 为 null（>730）→ progress = 1（完成态），不崩溃、不无限造里程碑。
 */
export function getMilestoneProgress(knownDays: number): MilestoneProgress {
  const day = Math.max(1, Math.floor(Number(knownDays) || 1))
  let previous = 0
  let next: number | null = null
  for (const m of MILESTONE_DAYS) {
    if (m < day) previous = m
    else if (next == null) next = m
  }
  let progress: number
  if (next == null) {
    progress = 1
  } else {
    progress = (day - previous) / (next - previous)
  }
  progress = Math.min(1, Math.max(0, progress))
  const reached = (MILESTONE_DAYS as readonly number[]).includes(day)
  return { day, previous, next, progress, reached }
}
