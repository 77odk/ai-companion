// TA 的详情页 · 纯逻辑自测（相处数据 / 聊天记录按天分组 / firstSeen）
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_aispace_detail.mjs
// 覆盖：日期 key / 今天昨天标题 / 预览截断 / 按天分组 / 相处天数 / firstSeen 挑选 / 记忆日期小字

import {
  dayKey,
  formatDayLabel,
  truncatePreview,
  groupMessagesByDay,
  computeDaysKnown,
  pickFirstSeen,
  formatMemoryDate,
} from '../src/lib/aiSpaceDetail.ts'

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

// 固定一个「今天」：2026-08-22 中午
const today = new Date(2026, 7, 22, 12, 0).getTime()
const d1 = new Date(2026, 7, 20, 10, 30).getTime() // 2026-08-20
const d2 = new Date(2026, 7, 21, 9, 0).getTime() // 2026-08-21
const d3 = new Date(2026, 7, 22, 23, 59).getTime() // 2026-08-22

console.log('\n[1] dayKey 本地日期 key')
eq(dayKey(d1), '2026-08-20', '8月20日')
eq(dayKey(d2), '2026-08-21', '8月21日')
eq(dayKey(d3), '2026-08-22', '8月22日')
eq(dayKey(new Date(2026, 0, 5).getTime()), '2026-01-05', '1月5日补零')
eq(dayKey(new Date(2026, 11, 31, 23, 59).getTime()), '2026-12-31', '12月31日')

console.log('\n[2] formatDayLabel 今天 / 昨天 / 具体日期')
eq(formatDayLabel('2026-08-22', today), '今天', '当天 → 今天')
eq(formatDayLabel('2026-08-21', today), '昨天', '前一天 → 昨天')
eq(formatDayLabel('2026-08-20', today), '8月20日', '更早 → 8月20日')
eq(formatDayLabel('2026-01-05', today), '1月5日', '跨月 → 1月5日')
eq(formatDayLabel('2026-12-31', today), '12月31日', '跨年 → 12月31日')

console.log('\n[3] truncatePreview 预览截断')
eq(truncatePreview('一二三四五', 5), '一二三四五', '未超长原样')
eq(truncatePreview('一二三四五六', 5), '一二三四五…', '超长加省略号')
eq(truncatePreview('一二三四五六七八九十一二三四五六七八九十', 20), '一二三四五六七八九十一二三四五六七八九十', '恰好 20 字不截')
eq(truncatePreview('一二三四五六七八九十一二三四五六七八九十甲乙', 20), '一二三四五六七八九十一二三四五六七八九十…', '超过 20 字截断')
eq(truncatePreview('第一行\n第二行\n第三行', 20), '第一行 第二行 第三行', '换行压平为空格')
eq(truncatePreview('   ', 5), '', '纯空白 → 空串')
eq(truncatePreview('', 5), '', '空串 → 空串')

console.log('\n[4] groupMessagesByDay 按天分组')
const m1 = { role: 'user', content: '早', ts: d1 }
const m2 = { role: 'assistant', content: '早上好', ts: d1 }
const m3 = { role: 'user', content: '在吗', ts: d2 }
const m4 = { role: 'assistant', content: '在的\n【记忆】喜欢雨天', ts: d2 }
const m5 = { role: 'user', content: '今天天气不错', ts: d3 }
const groups = groupMessagesByDay([m1, m2, m3, m4, m5], today)
eq(groups.length, 3, '三天各一组')
eq(groups[0].key, '2026-08-22', '最近的天在最上（22 日）')
eq(groups[0].label, '今天', '22 日标今天')
eq(groups[0].messages.length, 1, '22 日只有 1 条')
eq(groups[0].preview, '今天天气不错', '22 日预览 = 最后一条原文')
eq(groups[1].key, '2026-08-21', '其次 21 日')
eq(groups[1].label, '昨天', '21 日标昨天')
eq(groups[1].messages.length, 2, '21 日 2 条')
eq(groups[1].messages[0].content, '在吗', '组内按时间正序（先发的在前）')
eq(groups[1].preview, '在的', '预览去掉 TA 记住的标记行')
eq(groups[2].key, '2026-08-20', '最旧 20 日在最下')
eq(groups[2].label, '8月20日', '20 日标具体日期')
eq(groups[2].messages.length, 2, '20 日 2 条')
eq(groups[2].preview, '早上好', '20 日预览 = 当天最后一条')
eq(groupMessagesByDay([], today).length, 0, '空消息 → 空分组')
eq(groupMessagesByDay([{ role: 'user', content: 'x', ts: NaN }], today).length, 0, '时间戳非法自动跳过')

console.log('\n[5] computeDaysKnown 相处天数')
eq(computeDaysKnown(d3, today), 1, '今天认识 → 第 1 天')
eq(computeDaysKnown(d2, today), 2, '昨天认识 → 第 2 天')
eq(computeDaysKnown(d1, today), 3, '前天认识 → 第 3 天')
eq(computeDaysKnown(new Date(2026, 4, 14).getTime(), today), 101, '5月14日认识 → 第 101 天')
eq(computeDaysKnown(today + 86400000, today), 1, '未来时间戳兜底 → 第 1 天')
eq(computeDaysKnown(NaN, today), 1, '非法时间戳 → 第 1 天')

console.log('\n[6] pickFirstSeen 最早时间戳')
eq(
  pickFirstSeen({
    messages: [{ role: 'user', content: 'x', ts: 100 }],
    memories: [{ id: 'm', text: 'y', createdAt: 50 }],
    posts: [{ id: 'p', at: 80, kind: '日常', text: 'z', art: 0 }],
  }),
  50,
  '记忆最早 → 取记忆',
)
eq(
  pickFirstSeen({
    messages: [{ role: 'user', content: 'x', ts: 100 }],
    memories: [],
    posts: [{ id: 'p', at: 80, kind: '日常', text: 'z', art: 0 }],
  }),
  80,
  '动态早于消息 → 取动态',
)
eq(
  pickFirstSeen({ messages: [], memories: [], posts: [] }),
  null,
  '全空 → null',
)
eq(
  pickFirstSeen({
    messages: [{ role: 'user', content: 'x', ts: NaN }],
    memories: [{ id: 'm', text: 'y', createdAt: 60 }],
    posts: [{ id: 'p', at: Number.NEGATIVE_INFINITY, kind: '日常', text: 'z', art: 0 }],
  }),
  60,
  '非法时间戳被忽略',
)

console.log('\n[7] formatMemoryDate 记忆日期小字')
eq(formatMemoryDate(d2, today), '记于 8月21日', '同年 → 记于 8月21日')
eq(formatMemoryDate(new Date(2025, 0, 5).getTime(), today), '记于 2025年1月5日', '跨年带年份')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
