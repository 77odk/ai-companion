// 相处里程碑卡（W1）
// 认识第 7/30/100/365/730 天弹一张纪念卡（小红书素材，可截图）。
// 纯模板不调 LLM（成本零）；打开忆文（chat 视图）时检测，展示过一次就标记不再弹。
// 认识天数从 getFirstSeen 算（B2d 已有），与聊天注入的 buildRelationshipBlock 同一算法。

import { getFirstSeen } from './storage.ts'

export const MILESTONE_DAYS = [7, 30, 100, 365, 730] as const

export type MilestoneDay = (typeof MILESTONE_DAYS)[number]

const SHOWN_KEY_PREFIX = 'ai_companion_milestone_shown_'

/** 认识第 N 天：firstSeen 当天算第 1 天（与 buildRelationshipBlock 一致），按本地日历日 */
export function getKnownDays(now: number = Date.now(), sessionId?: string): number {
  const first = getFirstSeen(sessionId)
  const start = new Date(first)
  const today = new Date(now)
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()) / 86400000
  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86400000
  return Math.max(1, Math.round(todayDay - startDay + 1))
}

function shownKey(day: number): string {
  return `${SHOWN_KEY_PREFIX}${day}`
}

function readShown(day: number): boolean {
  try {
    return localStorage.getItem(shownKey(day)) === '1'
  } catch {
    return false
  }
}

/** 标记某里程碑日已展示（关闭纪念卡时调用，之后不再弹） */
export function markMilestoneShown(day: number): void {
  try {
    localStorage.setItem(shownKey(day), '1')
  } catch {
    // 存不下不影响：下次可能再弹一次
  }
}

/** 里程碑状态：今天第几天、是否落在里程碑日、是否已展示过 */
export function getMilestoneStatus(
  now: number = Date.now(),
  sessionId?: string,
): { day: number; hit: boolean; shown: boolean } {
  const day = getKnownDays(now, sessionId)
  const hit = (MILESTONE_DAYS as readonly number[]).includes(day)
  return { day, hit, shown: hit ? readShown(day) : false }
}

/** 里程碑模板文案（TA 口吻，有温度；认识天数不写进文案，卡片上另算大字） */
export function milestoneText(day: number): string {
  switch (day) {
    case 7:
      return '一周啦。日子不长，但你已经在我这里很特别了。'
    case 30:
      return '一个月了，谢谢你每天都在。'
    case 100:
      return '一百天。说长不长，说短不短，刚好够我记住你。'
    case 365:
      return '一年了。我还在，你也还在，真好。'
    case 730:
      return '两年了。好多日子我们一起走过，接下来的日子，也想和你一起走。'
    default:
      return '今天是我们认识的日子，想好好记一下。'
  }
}
