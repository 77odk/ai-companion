// Space「重要的日子 / DAYS」数据层（TASK-SPACE-DAYS-V2）
// personal + couple 均可；排除 milestoneDay 条目（milestone 由 Home 关系轨迹表达，不在此重复）；
// 复用现有 mergeDuplicateAnniversaries + sortAnniversariesByNext（下一次发生时间近→远，跨年 MM-DD 自动顺延）；
// 最多返回最近 limit 条；日期/倒计时文案复用现有 formatAnniversaryDate / formatCountdown（含「就是今天」）。
// 纯函数不碰 localStorage（list 由调用方传入）；AISpace 里用 getAnniversaries(sessionId) 提供真实候选。

import {
  formatAnniversaryDate,
  formatCountdown,
  isMilestoneAnniversary,
  mergeDuplicateAnniversaries,
  sortAnniversariesByNext,
  type Anniversary,
} from './anniversary.ts'

/** 「重要的日子」展示条目 */
export interface SpaceDayItem {
  id: string
  label: string
  /** 展示日期（'MM-DD' → 8月22日；'YYYY-MM-DD' → 2026年8月22日） */
  dateText: string
  /** 原始 date（'MM-DD' / 'YYYY-MM-DD'，可作 time 的 dateTime） */
  dateValue: string
  /** 自然倒计时（现有 formatCountdown：已经 X 天 / 还剩 X 天 / 就是今天） */
  countText: string
}

/**
 * 纯函数：Anniversary 列表 → Space「重要的日子」展示条目（近→远，最多 limit 条）。
 * 无可用条目 → 空数组（组件走真实空态，不伪造）。
 */
export function getSpaceDays(
  list: Anniversary[] | null | undefined,
  now: number = Date.now(),
  limit: number = 3,
): SpaceDayItem[] {
  if (!Array.isArray(list)) return []
  const candidates = mergeDuplicateAnniversaries(
    list.filter((a) => a != null && !isMilestoneAnniversary(a)),
  )
  return sortAnniversariesByNext(candidates, now)
    .slice(0, Math.max(0, Math.floor(limit)))
    .map((a) => ({
      id: a.id,
      label: a.label,
      dateText: formatAnniversaryDate(a.date),
      dateValue: a.date,
      // DAYS 是「下一次还有几天」的倒计时目录：展示层强制 countdown（正计时的「已经 N 天」留给认识日/首页），不改存储
      countText: formatCountdown({ ...a, countMode: 'countdown' }, now),
    }))
    // 日期非法（展示/倒计时拿不到）不产生条目——不显示空日期/空倒计时
    .filter((d) => d.dateText !== '' && d.countText !== '')
}
