export const CONTINUOUS_USE_REMINDER_MS = 2 * 60 * 60_000
export const DENSE_CHAT_WINDOW_MS = 90 * 60_000
export const DENSE_CHAT_REPLY_COUNT = 24

/** 只看本机本次页面生命周期内的前台使用时长，不分析聊天内容。 */
export function shouldShowContinuousUseReminder(
  activeForegroundMs: number,
  alreadyShown: boolean,
): boolean {
  return !alreadyShown
    && Number.isFinite(activeForegroundMs)
    && activeForegroundMs >= CONTINUOUS_USE_REMINDER_MS
}

/**
 * “聊得很密”仅按本机本次页面生命周期内的真实 assistant commit 频率判断。
 * 不做情感依赖诊断、不读取聊天正文、不调用模型。
 */
export function shouldShowRealityBoundaryReminder(
  committedReplyTimes: number[],
  now: number,
  alreadyShown: boolean,
): boolean {
  if (alreadyShown || !Number.isFinite(now)) return false
  const recent = (Array.isArray(committedReplyTimes) ? committedReplyTimes : [])
    .filter((ts) => Number.isFinite(ts) && ts > 0 && now - ts >= 0 && now - ts <= DENSE_CHAT_WINDOW_MS)
  return recent.length >= DENSE_CHAT_REPLY_COUNT
}

export function pruneCommittedReplyTimes(committedReplyTimes: number[], now: number): number[] {
  return (Array.isArray(committedReplyTimes) ? committedReplyTimes : [])
    .filter((ts) => Number.isFinite(ts) && ts > 0 && now - ts >= 0 && now - ts <= DENSE_CHAT_WINDOW_MS)
}
