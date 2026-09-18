// TA 空间动态时间修复（2026-09-18 七七真机报的「早上发的动态现在显示刚刚」）
// 根因两条：
//   1) 生成侧：首访路径对「今天」也用全天随机（7:00-23:59），会造出未来时间戳的动态；
//   2) 展示侧：timeAgo 对「未来的时间戳」也算进 m<1 分支 → 永远显示「刚刚」。
// 覆盖：规划器绝不产出未来时间戳（多个随机种子）/ 首访今天太早不排 / 展示侧源码契约
// 跑法：node scripts/test_space_time_fix.mjs

import { planBackfillSlots } from '../src/lib/aiSpaceCore.ts'
import { readFileSync } from 'node:fs'

let passed = 0
let failed = 0
function ok(cond, name, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' → ' + detail : ''}`) }
}

const DAY = 86400000
const dayStart = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime() }

console.log('[1] 首访：今天的时间戳绝不落在未来')
const noon = dayStart(Date.now()) + 12 * 3600 * 1000   // 今天中午 12:00
for (const r of [0, 0.25, 0.5, 0.75, 0.99]) {
  const slots = planBackfillSlots(null, noon, [], new Set(), () => r)
  const future = slots.filter((s) => s.at > noon)
  ok(future.length === 0, `随机值 ${r} → 没有未来时间戳`, JSON.stringify(future.map((s) => new Date(s.at).toISOString())))
  ok(slots.every((s) => s.at <= noon - 4 * 60 * 1000), `随机值 ${r} → 都早于「现在-5 分钟」`)
}

console.log('\n[2] 首访：清晨（还没到 7 点）不排今天的动态')
const early = dayStart(Date.now()) + 6 * 3600 * 1000    // 今天 06:00
const earlySlots = planBackfillSlots(null, early, [], new Set(), () => 0.9)
ok(earlySlots.every((s) => s.at < dayStart(early) + 1), '凌晨/清晨的槽位只铺过去的日子（不含今天）')

console.log('\n[3] 首访：过去的日子仍是 7:00-23:59 的正常时段')
const manySlots = planBackfillSlots(null, noon, [], new Set(), () => 0.6)
ok(manySlots.length >= 3, '会铺多天（TA 不是空的）', `slots=${manySlots.length}`)
ok(manySlots.every((s) => { const h = new Date(s.at).getHours(); return h >= 7 || h === 23 }), '过去的日子都在 7:00 之后')

console.log('\n[4] 展示侧源码契约：未来时间戳不许显示「刚刚」')
const lifeSrc = readFileSync(new URL('../src/components/SpaceLife.tsx', import.meta.url), 'utf8')
const homeSrc = readFileSync(new URL('../src/components/Home.tsx', import.meta.url), 'utf8')
ok(lifeSrc.includes('if (m >= 0 && m < 1) return \'刚刚\''), '生活页：刚刚只留给 0-1 分钟')
ok(!/if \(m < 1\) return '刚刚'/.test(lifeSrc), '生活页：旧的裸 m<1 判断已消失')
ok(homeSrc.includes("return (m >= 0 && m < 1) ? '刚刚' : hm"), '首页预览：同样收紧')
ok(!/return m < 1 \? '刚刚' : hm/.test(homeSrc), '首页预览：旧的裸判断已消失')

console.log('\n[5] 生成侧源码契约：两条路径共用同一个「不许未来」的函数')
const coreSrc = readFileSync(new URL('../src/lib/aiSpaceCore.ts', import.meta.url), 'utf8')
ok(coreSrc.includes('function pickPostTimeForDay('), '有统一的 pickPostTimeForDay')
ok(/const pickTime = \(day: number\): number \| null => pickPostTimeForDay\(day, now, rand\)/.test(coreSrc), '补发路径复用同一个函数')
ok(!/out\.push\(\{ at: pickDayPostHour\(day, rand\)/.test(coreSrc), '首访路径不再直接用全天随机')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
