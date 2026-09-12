// 首页「时间关系卡」数据层回归测试（TASK-HOME-BIG-DAY-V2）
// 覆盖：里程碑进度 day 1/7/8/30/31/100/365/730/731；Big Day 在 couple/personal 间选择；
//       milestone 条目不作 Big Day；跨年 MM-DD 顺延；无 Anniversary → null。
// 跑法：node scripts/test_home_bigday.mjs（npm test 自动纳入 scripts/test_*.mjs）

import {
  getMilestoneProgress,
  homeBigDayCandidates,
  pickHomeBigDay,
} from '../src/lib/homeBigDay.ts'

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
function close(actual, expected, eps, name) {
  ok(Math.abs(actual - expected) <= eps, `${name}（期望 ≈${expected}，实际 ${actual}）`)
}

function ann(overrides) {
  return { id: 'x', label: 'l', date: '01-01', createdAt: 1, kind: 'couple', ...overrides }
}

/** 从固定 now 往前/后偏移 offsetDays 的 MM-DD */
function mmdd(offsetDays, base) {
  const d = new Date(base)
  d.setDate(d.getDate() + offsetDays)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

console.log('[1] 里程碑进度：day 1 / 7 / 8 / 30 / 31 / 100 / 365 / 730 / 731')
{
  const cases = [
    [1, 0, 7, false],
    [7, 0, 7, true],
    [8, 7, 30, false],
    [30, 7, 30, true],
    [31, 30, 100, false],
    [100, 30, 100, true],
    [365, 100, 365, true],
    [730, 365, 730, true],
    [731, 730, null, false],
  ]
  for (const [day, prev, next, reached] of cases) {
    const p = getMilestoneProgress(day)
    eq(p.day, day, `day=${day} day`)
    eq(p.previous, prev, `day=${day} previous`)
    eq(p.next, next, `day=${day} next`)
    eq(p.reached, reached, `day=${day} reached`)
    ok(p.progress >= 0 && p.progress <= 1, `day=${day} progress 在 0–1（=${p.progress}）`)
  }
  close(getMilestoneProgress(1).progress, 1 / 7, 1e-9, 'day=1 progress = 1/7')
  eq(getMilestoneProgress(7).progress, 1, 'day=7 progress = 1（刚完成 0→7 段）')
  close(getMilestoneProgress(8).progress, 1 / 23, 1e-9, 'day=8 progress = 1/23')
  eq(getMilestoneProgress(30).progress, 1, 'day=30 progress = 1（刚完成 7→30 段）')
  close(getMilestoneProgress(31).progress, 1 / 70, 1e-9, 'day=31 progress = 1/70')
  eq(getMilestoneProgress(100).progress, 1, 'day=100 progress = 1')
  eq(getMilestoneProgress(365).progress, 1, 'day=365 progress = 1')
  eq(getMilestoneProgress(730).progress, 1, 'day=730 progress = 1（刚完成 365→730 段）')
  eq(getMilestoneProgress(731).progress, 1, 'day=731 progress = 1（730 后稳定完成态）')
  ok(getMilestoneProgress(0).day === 1, 'day=0 兜底为第 1 天')
}

console.log('[2] Big Day：couple 更近 → 选 couple；personal 更近 → 选 personal')
{
  const now = Date.UTC(2026, 8, 10) // 2026-09-10 固定
  const couple = ann({ id: 'c', label: '在一起纪念日', date: mmdd(2, now), kind: 'couple' })
  const personal = ann({ id: 'p', label: '我的生日', date: mmdd(5, now), kind: 'personal' })
  eq(pickHomeBigDay([personal, couple], now)?.id, 'c', 'couple 2 天后更近 → 选 couple')

  const coupleFar = ann({ id: 'cf', label: '在一起纪念日', date: mmdd(10, now), kind: 'couple' })
  const personalNear = ann({ id: 'pn', label: '我的生日', date: mmdd(1, now), kind: 'personal' })
  eq(pickHomeBigDay([coupleFar, personalNear], now)?.id, 'pn', 'personal 1 天后更近 → 选 personal')
}

console.log('[3] milestone 条目不会成为 Big Day')
{
  const now = Date.UTC(2026, 8, 10)
  const milestone = ann({ id: 'm', label: '在一起 100 天', date: mmdd(1, now), milestoneDay: 100 })
  const normal = ann({ id: 'n', label: '认识 TA 的日子', date: mmdd(5, now), kind: 'couple' })
  eq(pickHomeBigDay([milestone, normal], now)?.id, 'n', 'milestone 更近也被排除，选正常条目')
  eq(pickHomeBigDay([milestone], now), null, '只剩 milestone → null（不伪造）')
  eq(homeBigDayCandidates([milestone, normal]).length, 1, '候选过滤后只剩正常条目')
}

console.log('[4] 跨年 MM-DD：12 月时 01-15 顺延到明年并选中')
{
  const now = Date.UTC(2026, 11, 20) // 2026-12-20
  const newYear = ann({ id: 'ny', label: '我的生日', date: '01-15', kind: 'personal' })
  const far = ann({ id: 'f', label: '约定', date: '02-10', kind: 'couple' })
  const picked = pickHomeBigDay([far, newYear], now)
  eq(picked?.id, 'ny', '01-15 比 02-10 更近（跨年后 26 天）→ 选中')
}

console.log('[5] 无 Anniversary → null（保持 empty/fallback）')
{
  eq(pickHomeBigDay([], Date.UTC(2026, 8, 10)), null, '空列表 → null')
  eq(pickHomeBigDay(null, Date.UTC(2026, 8, 10)), null, 'null → null')
  eq(pickHomeBigDay([ann({ date: 'invalid-xx' })], Date.UTC(2026, 8, 10)), null, '全为非法日期 → null')
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
