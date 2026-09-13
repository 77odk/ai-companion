// Time Interaction Closure：生日 / 生理期选择器纯逻辑自测
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖构建工具。
// 跑法：node scripts/test_time_interaction.mjs
// 覆盖：闰年/月份天数 / 周期 clamp / picker 回填解析（MM-DD、YYYY-MM-DD、脏日期 clamp、非法）/
//       保存格式 pad（生日 MM-DD、生理期 YYYY-MM-DD）/ 日选项（生日 2 月 29 循环、生理期按真实闰性）/
//       年份选项 / Anniversary 数据层兼容（isValidAnniversaryDate + formatCountdown 顺延 + period 需年份）

import { strict as assert } from 'node:assert'
import {
  pad2,
  isLeapYear,
  monthDayCount,
  clampCycleDays,
  parseDateForPicker,
  toMonthDay,
  toFullDate,
  monthOptions,
  dayOptions,
  periodYearOptions,
  periodMonthOptions,
  periodDayOptions,
  isFutureOnset,
  localDateKey,
} from '../src/lib/timeInteraction.ts'
import { isValidAnniversaryDate, formatCountdown, formatPeriodEstimate } from '../src/lib/anniversary.ts'

let passed = 0
const ok = (name) => {
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('1. pad2 / 闰年 / 月份天数')
assert.equal(pad2(9), '09')
assert.equal(pad2(28), '28')
ok('pad2 补零')
assert.equal(isLeapYear(2024), true)
assert.equal(isLeapYear(2026), false)
assert.equal(isLeapYear(2000), true)
assert.equal(isLeapYear(1900), false)
ok('闰年判断（4/100/400 规则）')
assert.equal(monthDayCount(2026, 2), 28)
assert.equal(monthDayCount(2024, 2), 29)
assert.equal(monthDayCount(2026, 4), 30)
assert.equal(monthDayCount(2026, 12), 31)
ok('月份真实天数（2/4/12）')

console.log('2. 周期天数 clamp（沿用现有 1–90）')
assert.equal(clampCycleDays(28), 28)
assert.equal(clampCycleDays(0), 1)
assert.equal(clampCycleDays(-5), 1)
assert.equal(clampCycleDays(91), 90)
assert.equal(clampCycleDays(45.6), 46)
assert.equal(clampCycleDays(Number.NaN), 28)
ok('clampCycleDays 边界（1–90，NaN 回落 28）')

console.log('3. picker 回填解析')
assert.deepEqual(parseDateForPicker('09-28'), { month: 9, day: 28 })
assert.deepEqual(parseDateForPicker('2026-09-12'), { year: 2026, month: 9, day: 12 })
ok('MM-DD 与 YYYY-MM-DD 均可回填')
assert.deepEqual(parseDateForPicker('04-31'), { month: 4, day: 30 })
assert.deepEqual(parseDateForPicker('2025-04-31'), { year: 2025, month: 4, day: 30 })
ok('脏日期 4/31 在表单层 clamp 到 4/30（不写存储）')
assert.deepEqual(parseDateForPicker('02-29'), { month: 2, day: 29 })
assert.deepEqual(parseDateForPicker('2024-02-30'), { year: 2024, month: 2, day: 29 })
assert.deepEqual(parseDateForPicker('2026-02-30'), { year: 2026, month: 2, day: 28 })
ok('2 月：生日 29 循环可选；生理期按真实年份闰性 clamp')
assert.equal(parseDateForPicker('13-01'), null)
assert.equal(parseDateForPicker(''), null)
assert.equal(parseDateForPicker('2026-13-01'), null)
ok('非法（13 月 / 空）→ null')

console.log('4. 保存格式')
assert.equal(toMonthDay(9, 28), '09-28')
assert.equal(toMonthDay(2, 9), '02-09')
assert.equal(toFullDate(2026, 9, 12), '2026-09-12')
ok('生日 MM-DD / 生理期 YYYY-MM-DD pad 两位')

console.log('5. 日选项')
assert.equal(monthOptions().length, 12)
assert.equal(monthOptions()[0], '01')
assert.equal(monthOptions()[11], '12')
ok('月份选项 01–12')
assert.equal(dayOptions(undefined, 2).length, 29)
assert.equal(dayOptions(undefined, 4).length, 30)
assert.equal(dayOptions(2026, 2).length, 28)
assert.equal(dayOptions(2024, 2).length, 29)
ok('生日 2 月始终 29（循环）；生理期按真实闰性')
const ys = periodYearOptions(new Date(2026, 8, 13, 12, 0, 0))
assert.deepEqual(ys, [2025, 2026])
ok('生理期年份选项 = 去年/今年（明年不可选 —— future onset 禁止）')

console.log('6. REVIEW-FIX-01：未来 onset 防御（本地日历，不走 UTC）')
// now 用本地时间构造（任何时区下本地年月日都是 2026-09-13）
const R = new Date(2026, 8, 13, 12, 0, 0)
assert.equal(R.getFullYear(), 2026)
assert.equal(R.getMonth() + 1, 9)
assert.equal(R.getDate(), 13)
assert.equal(localDateKey(2026, 9, 13), 20260913)
assert.equal(localDateKey(2026, 1, 1), 20260101)
ok('localDateKey 数值键（YYYYMMDD）')
assert.equal(isFutureOnset(2026, 9, 13, R), false)
ok('today → PASS（允许保存）')
assert.equal(isFutureOnset(2026, 9, 12, R), false)
ok('yesterday → PASS')
assert.equal(isFutureOnset(2026, 9, 14, R), true)
ok('tomorrow → FAIL（禁止保存）')
assert.equal(isFutureOnset(2026, 10, 1, R), true)
ok('future month → FAIL')
assert.equal(isFutureOnset(2027, 1, 1, R), true)
ok('next year → FAIL（且年份选项里不存在）')
assert.deepEqual(periodMonthOptions(2026, R), ['01', '02', '03', '04', '05', '06', '07', '08', '09'])
assert.deepEqual(periodMonthOptions(2025, R), monthOptions())
ok('periodMonthOptions：今年只到当前月 09；去年全年 12 个月')
assert.equal(periodDayOptions(2026, 9, R).length, 13)
assert.equal(periodDayOptions(2026, 8, R).length, 31)
assert.equal(periodDayOptions(2025, 2, R).length, 28)
ok('periodDayOptions：今年当前月只到当前日 13；已过月份按真实天数；去年按真实闰性')
// 本地边界：实现必须用 getFullYear/getMonth/getDate（本地日历）。
// 反例（错误实现）：若用 date.toISOString().slice(0,10)（UTC），本地 2026-09-13 06:00
// 会被截成 2026-09-12，把「今天」误判成「未来」—— 本断言锁死本地日历语义。
const boundary = new Date(2026, 8, 13, 6, 0, 0)
assert.equal(boundary.getFullYear(), 2026)
assert.equal(boundary.getMonth() + 1, 9)
assert.equal(boundary.getDate(), 13)
assert.equal(isFutureOnset(2026, 9, 13, boundary), false)
assert.equal(isFutureOnset(2026, 9, 14, boundary), true)
ok('local date boundary：本地日历比较，不用 UTC 字符串')

console.log('7. Anniversary 数据层兼容（不改 schema 的前提下保存格式合法）')
assert.equal(isValidAnniversaryDate('09-28'), true)
assert.equal(isValidAnniversaryDate('02-29'), true)
assert.equal(isValidAnniversaryDate('2026-09-12'), true)
ok('生日 MM-DD / 生理期 YYYY-MM-DD 均通过现有 isValidAnniversaryDate')
const now = new Date('2026-09-13T12:00:00Z').getTime()
const cd = formatCountdown({ date: '09-28', countMode: 'countdown' }, now)
assert.equal(cd, '还剩 15 天')
ok(`生日无年份 MM-DD 倒计时顺延正确（2026-09-13 → ${cd}）`)
// 现有 formatCountdown 对「跨年旧 YYYY-MM-DD」会顺延到明年而非今年（parsed.year 落后时 diff<0 → year+1）。
// 这是 anniversary.ts 现有行为，本任务不修改数据层；新 UI 一律保存 MM-DD 从源头规避此路径。
assert.equal(formatCountdown({ date: '2025-09-28', countMode: 'countdown' }, now), '还剩 380 天')
ok('现有 YYYY-MM-DD 跨年行为记录在案（380 天 → 2027-09-28）；新保存格式用 MM-DD 规避')
const pe = formatPeriodEstimate({ date: '2026-09-12', periodDays: 28 }, now)
assert.ok(typeof pe === 'string' && pe.length > 0, `period YYYY-MM-DD 有年份 → 可估算（${pe}）`)
assert.equal(formatPeriodEstimate({ date: '09-12', periodDays: 28 }, now), '')
ok('period 无年份 → 现有估算返回空（证明生理期必须保存 YYYY-MM-DD）')

console.log(`\n✅ test_time_interaction：${passed} passed / 0 failed`)
