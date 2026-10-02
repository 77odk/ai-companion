/** Model-visible time labels are context metadata, never assistant prose. */
const TIME_LABEL =
  '[\\[［【]\\s*(?:' +
  '(?:(?:[01]?\\d|2[0-3]):[0-5]\\d)|' +
  '刚刚|此刻|当前|现在|刚才|昨晚|今晚|上周|本周|这周|上个月|这个月|' +
  '(?:今天|昨天|前天)(?:早上|上午|中午|下午|晚上)?|' +
  '\\d+\\s*(?:秒|分钟|个小时|小时|天|个月|年)前|' +
  'just now|\\d+\\s*(?:secs?|seconds|mins?|minutes|hours?|hrs?|days?)\\s+ago' +
  ')\\s*[\\]］】]'

/**
 * Strip bracketed time metadata wherever a weak model copied it into prose.
 * Examples: [9:21] / [09:21] / [21:05] / [昨晚] / [今天早上] / [3 分钟前].
 */
export function stripTimeLabels(text: string): string {
  if (!text) return ''
  return text
    .replace(new RegExp(`${TIME_LABEL}\\s*`, 'gu'), '')
    .replace(/[ \\t]+(?=\\n|$)/g, '')
}
