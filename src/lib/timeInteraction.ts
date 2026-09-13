/* Time Interaction Closure：生日 / 生理期选择器纯逻辑（无 UI、无存储、无 Anniversary schema 改动）。
   与 anniversary.ts 数据契约兼容：
   - 生日：'MM-DD'（每年循环；countdown 语义由 formatCountdown 顺延到下一次，任何年份都不影响倒计时）
   - 生理期：'YYYY-MM-DD'（真实发生日期；formatPeriodEstimate / daysUntilPeriod 都要求年份）
   只做展示层日期数学，不新增任何数据模型。 */

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

/** 某年某月（1-12）的真实天数 */
export function monthDayCount(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

/** 生理期周期天数合法范围（与 Home 现有 1-90 保存逻辑一致），非法回落默认 28 */
export function clampCycleDays(n: number): number {
  if (!Number.isFinite(n)) return 28
  return Math.max(1, Math.min(90, Math.round(n)))
}

/**
 * 把已有日期解析成 picker 回填值，兼容 'MM-DD' 与 'YYYY-MM-DD'。
 * 日超过该月真实天数时 clamp 到月末（老脏数据如 04-31 → 04-30，只作用于表单回填，不写存储）。
 * 生日（无年份）2 月允许 29：MM-DD 是循环日期，2/29 四年一次，始终可选；
 * 生理期（有年份）2 月按真实年份闰性。
 */
export function parseDateForPicker(
  date: string,
  nowYear = new Date().getFullYear(),
): { year?: number; month: number; day: number } | null {
  const t = (date ?? '').trim()
  const md = /^(\d{1,2})-(\d{1,2})$/.exec(t)
  if (md) {
    const m = Number(md[1])
    const d = Number(md[2])
    if (m < 1 || m > 12) return null
    const max = m === 2 ? 29 : monthDayCount(nowYear, m)
    return { month: m, day: Math.min(Math.max(1, d), max) }
  }
  const full = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (full) {
    const y = Number(full[1])
    const m = Number(full[2])
    const d = Number(full[3])
    if (y < 1900 || y > 2100 || m < 1 || m > 12) return null
    return { year: y, month: m, day: Math.min(Math.max(1, d), monthDayCount(y, m)) }
  }
  return null
}

/** 生日保存格式：'MM-DD'（pad 两位）。不把"今年"当出生年份 —— 循环语义不漂移 */
export function toMonthDay(m: number, d: number): string {
  return `${pad2(m)}-${pad2(d)}`
}

/** 生理期保存格式：'YYYY-MM-DD'（真实发生日期，不能丢年份） */
export function toFullDate(y: number, m: number, d: number): string {
  return `${String(y)}-${pad2(m)}-${pad2(d)}`
}

/** 月份选项：01–12 */
export function monthOptions(): string[] {
  return Array.from({ length: 12 }, (_, i) => pad2(i + 1))
}

/** 某月日选项：生日（year 缺省）2 月到 29（循环日期四年一次）；生理期按真实年份闰性 */
export function dayOptions(year: number | undefined, month: number): string[] {
  const max =
    year == null ? (month === 2 ? 29 : monthDayCount(new Date().getFullYear(), month)) : monthDayCount(year, month)
  return Array.from({ length: max }, (_, i) => pad2(i + 1))
}

/* ---- 生理期（Period Record V1）：禁止未来 onset ----
   "上次经期开始"是已经发生的 actual onset：
   - 今天允许、过去允许、未来不允许；
   - 明年不可选；今年只到当前月/当前日。
   比较一律用本地日历（getFullYear/getMonth/getDate），不用 UTC 字符串，
   避免跨时区偏一天。 */

/** 本地日历 YYYY-MM-DD 的数值键（y*10000+m*100+d，零填充字符串字典序 = 日期序） */
export function localDateKey(y: number, m: number, d: number): number {
  return y * 10000 + m * 100 + d
}

/** 该日期相对本地 today 是否为未来（> 今天 = 未来 onset，禁止保存） */
export function isFutureOnset(y: number, m: number, d: number, now: Date = new Date()): boolean {
  return localDateKey(y, m, d) > localDateKey(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

/** 生理期年份选项：去年 / 今年（明年不能作为可选年份 —— 未来 onset 不允许） */
export function periodYearOptions(now: Date = new Date()): number[] {
  const y = now.getFullYear()
  return [y - 1, y]
}

/** 生理期月份选项：去年全年 12 个月；今年只到当前月（未来月份不可选） */
export function periodMonthOptions(year: number, now: Date = new Date()): string[] {
  const count = year < now.getFullYear() ? 12 : now.getMonth() + 1
  return Array.from({ length: count }, (_, i) => pad2(i + 1))
}

/** 生理期日选项：今年当前月只到当前日；其它（去年任意月、今年已过月份）按真实月天数 */
export function periodDayOptions(year: number, month: number, now: Date = new Date()): string[] {
  const max =
    year === now.getFullYear() && month === now.getMonth() + 1
      ? now.getDate()
      : monthDayCount(year, month)
  return Array.from({ length: max }, (_, i) => pad2(i + 1))
}
