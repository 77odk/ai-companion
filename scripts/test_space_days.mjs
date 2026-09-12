// 空间「重要的日子 / DAYS」数据层回归测试（TASK-SPACE-DAYS-V2）
// 覆盖验收 B/C/D/E/F/G/H：personal/couple 近远选择、milestone 排除、最多 3 条、
//       同名同日合并、跨年 MM-DD 顺延、当天「就是今天」、空态 []。
// 跑法：node scripts/test_space_days.mjs（npm test 自动纳入 scripts/test_*.mjs）

import { getSpaceDays } from '../src/lib/spaceDays.ts'

let passed = 0
let failed = 0
function ok(cond, name) {
  if (cond) passed++
  else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}
function eq(actual, expected, name) {
  ok(actual === expected, `${name}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`)
}

/** 固定 now：2026-09-15（UTC） */
const NOW = Date.UTC(2026, 8, 15)

function ann(overrides) {
  return { id: 'a', label: '测试日', date: '01-01', createdAt: 1, kind: 'couple', ...overrides }
}

/** 从 NOW 偏移 offsetDays 的 MM-DD（跨月/跨年安全） */
function mmdd(offsetDays, base = NOW) {
  const d = new Date(base)
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

console.log('[1] personal 最近：生日 3 天 vs 纪念日 20 天 → 生日第一')
{
  const items = getSpaceDays(
    [
      ann({ id: 'bday', label: '我的生日', date: mmdd(3) }),
      ann({ id: 'anniv', label: '我们的纪念日', date: mmdd(20) }),
    ],
    NOW,
  )
  eq(items.length, 2, '返回 2 条')
  eq(items[0].label, '我的生日', '第一条 = 我的生日')
  eq(items[0].countText, '还剩 3 天', '生日倒计时 = 还剩 3 天')
  eq(items[1].label, '我们的纪念日', '第二条 = 纪念日')
}

console.log('[2] couple 最近：纪念日 2 天 vs 生日 20 天 → 纪念日第一')
{
  const items = getSpaceDays(
    [
      ann({ id: 'bday', label: '我的生日', date: mmdd(20) }),
      ann({ id: 'anniv', label: '我们的纪念日', date: mmdd(2) }),
    ],
    NOW,
  )
  eq(items.length, 2, '返回 2 条')
  eq(items[0].label, '我们的纪念日', '第一条 = 我们的纪念日')
  eq(items[0].countText, '还剩 2 天', '纪念日倒计时 = 还剩 2 天')
}

console.log('[3] milestone 条目排除（不参与展示）')
{
  const items = getSpaceDays(
    [
      ann({ id: 'm1', label: '在一起 100 天', date: '07-01', milestoneDay: 100 }),
      ann({ id: 'bday', label: '我的生日', date: mmdd(3) }),
    ],
    NOW,
  )
  eq(items.length, 1, '只剩生日 1 条')
  eq(items[0].id, 'bday', 'milestone 被排除')
}

console.log('[4] 最多 3 条：5 条 Anniversary → 只出最近 3 条')
{
  const list = [mmdd(40), mmdd(30), mmdd(20), mmdd(10), mmdd(1)].map((d, i) =>
    ann({ id: `d${i}`, label: `日子${i}`, date: d }),
  )
  const items = getSpaceDays(list, NOW, 3)
  eq(items.length, 3, '只返回 3 条')
  eq(items[0].countText, '还剩 1 天', '最近 = 1 天后')
  eq(items[1].countText, '还剩 10 天', '第二条 = 10 天后')
  eq(items[2].countText, '还剩 20 天', '第三条 = 20 天后')
}

console.log('[5] 跨年 MM-DD：now 12 月，01-15 顺延到下一年并正常排序')
{
  const decNow = Date.UTC(2026, 11, 20)
  const items = getSpaceDays(
    [
      ann({ id: 'ny', label: '跨年日', date: '01-15' }),
      ann({ id: 'soon', label: '近期日', date: '12-25' }),
    ],
    decNow,
  )
  eq(items.length, 2, '返回 2 条')
  eq(items[0].id, 'soon', '12-25 更近在前')
  eq(items[1].id, 'ny', '01-15 顺延到下一年在后')
  ok(items[1].countText.startsWith('还剩'), `跨年日倒计时为「还剩 N 天」（=${items[1].countText}）`)
  eq(items[1].dateText, '1月15日', '跨年日展示日期不带年份')
}

console.log('[6] 当天 →「就是今天」')
{
  const items = getSpaceDays([ann({ id: 'today', label: '我们的纪念日', date: mmdd(0) })], NOW)
  eq(items.length, 1, '返回 1 条')
  eq(items[0].countText, '就是今天', '当天显示「就是今天」')
}

console.log('[7] countdown 模式同样生效')
{
  const items = getSpaceDays(
    [ann({ id: 'cd', label: '倒计时日', date: mmdd(5), countMode: 'countdown' })],
    NOW,
  )
  eq(items[0].countText, '还剩 5 天', 'countdown 模式 = 还剩 5 天')
}

console.log('[8] 一次性 YYYY-MM-DD 未来：带年展示 + 倒计时')
{
  const items = getSpaceDays(
    [ann({ id: 'oneday', label: '见面日', date: '2026-10-01' })],
    NOW,
  )
  eq(items[0].dateText, '2026年10月1日', '一次性日期带年份')
  eq(items[0].countText, '还剩 16 天', '一次性日期倒计时')
}

console.log('[9] 同名同日期合并展示（数据不删，只合并展示）')
{
  const items = getSpaceDays(
    [
      ann({ id: 'x1', label: '重复日', date: '09-20' }),
      ann({ id: 'x2', label: '重复日', date: '09-20' }),
      ann({ id: 'x3', label: '另一天', date: mmdd(9) }),
    ],
    NOW,
  )
  eq(items.length, 2, '重复条目合并为 1 条')
  eq(items.filter((i) => i.label === '重复日').length, 1, '同名同日只出现一次')
}

console.log('[10] 空态：空列表 / null / 全 milestone / 非法条目')
{
  eq(getSpaceDays([], NOW).length, 0, '空列表 → []')
  eq(getSpaceDays(null, NOW).length, 0, 'null → []')
  eq(getSpaceDays(undefined, NOW).length, 0, 'undefined → []')
  eq(getSpaceDays([ann({ id: 'm', label: '里程碑', date: '07-01', milestoneDay: 30 })], NOW).length, 0, '全 milestone → []')
  eq(getSpaceDays([ann({ id: 'bad', date: 'bad-date' })], NOW).length, 0, '非法日期 → []（formatCountdown 空串被跳过前不产生条目）')
  eq(getSpaceDays([ann({})], NOW, 0).length, 0, 'limit=0 → []')
}

console.log('[11] limit 为负/非法值不崩')
{
  const items = getSpaceDays([ann({ id: 'a1', label: '日子', date: mmdd(2) })], NOW, -1)
  eq(items.length, 0, 'limit=-1 → []')
}

console.log('[12] dateText/dateValue 输出形态')
{
  const items = getSpaceDays([ann({ id: 'fmt', label: '格式日', date: mmdd(7) })], NOW)
  eq(items[0].dateText, '9月22日', 'MM-DD → 9月22日')
  eq(items[0].dateValue, mmdd(7), 'dateValue = 原始 MM-DD')
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
