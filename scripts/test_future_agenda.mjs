// 因果链第二环 · 未来约定注入聊天 自测（纯函数）
// 跑法：node scripts/test_future_agenda.mjs
// 覆盖：daysUntil 天数差 / dayLabel 口语标签 / 约定过滤（没到期注入、到期不注入）/ 排序与上限 / 无约定空串 / zh/en
import { buildFutureAgendaBlock, daysUntil, dayLabel } from '../src/lib/futureAgenda.ts'

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

// 固定「今天」= 2026-09-09 周三
const now = new Date(2026, 8, 9, 12, 0)

console.log('\n[1] daysUntil / dayLabel')
eq(daysUntil('2026-09-09', now), 0, '今天 → 0')
eq(daysUntil('2026-09-10', now), 1, '明天 → 1')
eq(daysUntil('2026-09-11', now), 2, '后天 → 2')
eq(daysUntil('2026-09-16', now), 7, '下周三 → 7')
eq(dayLabel('2026-09-09', now), '今天', '今天 → 今天')
eq(dayLabel('2026-09-10', now), '明天', '明天 → 明天')
eq(dayLabel('2026-09-11', now), '后天', '后天 → 后天')
eq(dayLabel('2026-09-16', now), '9月16日', '一周后 → M月D日')
eq(dayLabel('2026-09-11', now, 'en'), 'the day after tomorrow', 'en 后天')

console.log('\n[2] buildFutureAgendaBlock：只有真实约定（futureDay）才注入')
const topics = [
  { t: '周五晚上我们去看那部新电影吧', ts: now.getTime(), futureDay: '2026-09-11' }, // 后天
  { t: '今天上班好累啊', ts: now.getTime() }, // 非约定 → 不注入
  { t: '约好下周三去吃火锅', ts: now.getTime(), futureDay: '2026-09-16' }, // 下周
]
const block = buildFutureAgendaBlock(topics, now)
ok(typeof block === 'string' && block.length > 0, '有约定 → 注入非空')
ok(block.includes('你们说好要做的事'), '块头提示语在')
ok(block.includes('后天') && block.includes('电影'), '含后天约定原文')
ok(block.includes('9月16日') && block.includes('火锅'), '含下周约定原文（M月D日 标签）')
ok(!block.includes('上班'), '非约定消息不注入')
ok(block.includes('还没到日子'), '明确「别当成已经做了」')

console.log('\n[3] 到期过滤：已到期的约定不再提')
eq(buildFutureAgendaBlock([{ t: '上周去看的电影', ts: now.getTime(), futureDay: '2026-09-05' }], now), '', '已到期的约定不再聊天里反复提（动态已表达）')

console.log('\n[4] 排序与上限')
const many = ['2026-09-12', '2026-09-10', '2026-09-18', '2026-09-13', '2026-09-11'].map((fd, i) => ({
  t: `约定${i}`, ts: now.getTime(), futureDay: fd,
}))
const b2 = buildFutureAgendaBlock(many, now)
const orderOk = b2.indexOf('明天') < b2.indexOf('后天') && b2.indexOf('后天') < b2.indexOf('9月12日')
ok(orderOk, '按日期从近到远排')
ok((b2.match(/约定/g) || []).length <= 3, '最多注入 3 条')

console.log('\n[5] 边界与空')
eq(buildFutureAgendaBlock([], now), '', '无话题 → 空串')
eq(buildFutureAgendaBlock([{ t: '普通聊天', ts: now.getTime() }], now), '', '全非约定 → 空串')
eq(buildFutureAgendaBlock(null, now), '', 'null → 空串')
eq(buildFutureAgendaBlock([{ t: 'x', ts: now.getTime(), futureDay: '坏格式' }], now), '', 'futureDay 格式坏 → 不认（不注入）')
const enBlock = buildFutureAgendaBlock([{ t: 'go see a movie', ts: now.getTime(), futureDay: '2026-09-11' }], now, 'en')
ok(enBlock.includes('Things you two agreed to do together') && enBlock.includes('movie'), 'en 版文案')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
