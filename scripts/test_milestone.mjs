// 相处里程碑（W1）纯逻辑自测
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 覆盖：认识天数判定（第 7/30/100/365 天命中，其他不中）/ 里程碑日标记往返 / 模板文案

import { getKnownDays, getMilestoneStatus, markMilestoneShown, milestoneText, MILESTONE_DAYS } from '../src/lib/milestone.ts'

let passed = 0
let failed = 0

function ok(cond, name) {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}

function eq(actual, expected, name) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  ok(a === b, `${name}（得 ${a}，期望 ${b}）`)
}

// 简易 localStorage mock：getFirstSeen 依赖 ai_companion_first_seen 缓存
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}
function resetStore() {
  store.clear()
}

// 固定「今天」：2026-08-24
const now = new Date(2026, 7, 24, 12, 0).getTime()
const firstSeen = (y, m, d) => new Date(y, m, d, 10, 0).getTime()

console.log('\n[1] 认识天数判定：第 7 天命中')
resetStore()
localStorage.setItem('ai_companion_first_seen', String(firstSeen(2026, 7, 18))) // 8月18日
eq(getKnownDays(now), 7, '8月18日→8月24日 认识第 7 天')
const s7 = getMilestoneStatus(now)
eq(s7, { day: 7, hit: true, shown: false }, '第 7 天 → hit=true, shown=false')

console.log('\n[2] 其他天数不命中')
localStorage.setItem('ai_companion_first_seen', String(firstSeen(2026, 7, 19))) // 8月19日 → 第 6 天
eq(getMilestoneStatus(now), { day: 6, hit: false, shown: false }, '第 6 天 → 不命中')
localStorage.setItem('ai_companion_first_seen', String(firstSeen(2026, 7, 17))) // 8月17日 → 第 8 天
eq(getMilestoneStatus(now), { day: 8, hit: false, shown: false }, '第 8 天 → 不命中')

console.log('\n[3] 第 30 / 100 / 365 天命中')
localStorage.setItem('ai_companion_first_seen', String(firstSeen(2026, 6, 26))) // 7月26日 → 第 30 天
ok(getMilestoneStatus(now).hit === true && getMilestoneStatus(now).day === 30, '第 30 天 → 命中')
localStorage.setItem('ai_companion_first_seen', String(firstSeen(2026, 4, 17))) // 5月17日 → 第 100 天
ok(getMilestoneStatus(now).hit === true && getMilestoneStatus(now).day === 100, '第 100 天 → 命中')
localStorage.setItem('ai_companion_first_seen', String(firstSeen(2025, 7, 25))) // 2025年8月25日 → 第 365 天
ok(getMilestoneStatus(now).hit === true && getMilestoneStatus(now).day === 365, '第 365 天 → 命中')

console.log('\n[4] 非里程碑日不命中（隔天再查）')
localStorage.setItem('ai_companion_first_seen', String(firstSeen(2026, 7, 18)))
eq(getMilestoneStatus(new Date(2026, 7, 25, 12, 0).getTime()), { day: 8, hit: false, shown: false }, '第 8 天 → 不命中')

console.log('\n[5] shown 标记往返：展示过一次不再弹')
resetStore()
localStorage.setItem('ai_companion_first_seen', String(firstSeen(2026, 7, 18)))
ok(getMilestoneStatus(now).shown === false, '初始未展示 → shown=false')
markMilestoneShown(7)
ok(getMilestoneStatus(now).shown === true, '标记后 → shown=true')
ok(localStorage.getItem('ai_companion_milestone_shown_7') === '1', '落盘到 ai_companion_milestone_shown_7')
markMilestoneShown(30)
ok(localStorage.getItem('ai_companion_milestone_shown_30') === '1', '不同里程碑日独立标记')
ok(localStorage.getItem('ai_companion_milestone_shown_100') == null, '未展示的天不落盘')
eq(MILESTONE_DAYS, [7, 30, 100, 365, 730], '里程碑日清单：7/30/100/365/730')

console.log('\n[6] milestoneText 模板文案（TA 口吻，非空、不重复）')
const texts = [7, 30, 100, 365, 730].map((d) => milestoneText(d))
ok(texts.every((t) => typeof t === 'string' && t.trim().length > 0), '各里程碑日都有文案')
ok(new Set(texts).size === texts.length, '文案各不相同')
ok(milestoneText(7).includes('一周'), '7 天文案提「一周」')
ok(milestoneText(30).includes('一个月'), '30 天文案提「一个月」')
ok(milestoneText(100).includes('一百天'), '100 天文案提「一百天」')
ok(milestoneText(365).includes('一年'), '365 天文案提「一年」')
ok(milestoneText(730).includes('两年'), '730 天文案提「两年」')
ok(milestoneText(42).includes('认识'), '非里程碑天 → 兜底文案')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
