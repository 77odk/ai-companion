// 聊天记录子页升级（M7-2）· 纯逻辑自测：关键词搜索 + 日历
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_aispace_search_cal.mjs
// 覆盖：searchMessages 命中/倒序/上下文、日历当月网格/高亮集合/切月/标题/可翻范围

import {
  searchMessages,
  getCalendarMonth,
  highlightDayKeys,
  shiftMonth,
  monthLabel,
  calendarMonthRange,
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

// 固定「今天」：2026-08-22 中午
const today = new Date(2026, 7, 22, 12, 0).getTime()
// 三条时间正序消息（历史存储即正序）
const m1 = { role: 'user', content: '早上好', ts: new Date(2026, 7, 20, 9, 0).getTime() } // 8月20日
const m2 = { role: 'assistant', content: '早上好，今天天气不错', ts: new Date(2026, 7, 20, 9, 5).getTime() }
const m3 = { role: 'user', content: '在吗 Hello 世界', ts: new Date(2026, 7, 21, 20, 0).getTime() } // 8月21日

console.log('\n[1] searchMessages 命中与过滤')
eq(searchMessages([], '在吗', today), [], '空消息 → 空结果')
eq(searchMessages([m1, m2, m3], '', today), [], '空关键词 → 空结果')
eq(searchMessages([m1, m2, m3], '   ', today), [], '纯空白关键词 → 空结果')
eq(searchMessages([m1, m2, m3], '不存在的词', today), [], '无命中 → 空结果')
const hitsHello = searchMessages([m1, m2, m3], 'hello', today)
eq(hitsHello.length, 1, '英文关键词忽略大小写命中 1 条')
eq(hitsHello[0].dayKey, '2026-08-21', '命中的日期 key 正确')
eq(hitsHello[0].dayLabel, '昨天', '命中的日期标题正确')

console.log('\n[2] searchMessages 时间倒序')
const many = [
  { role: 'user', content: '第一次提到小红花', ts: new Date(2026, 7, 18, 10, 0).getTime() },
  { role: 'assistant', content: '无关内容', ts: new Date(2026, 7, 19, 10, 0).getTime() },
  { role: 'user', content: '第二次小红花', ts: new Date(2026, 7, 20, 10, 0).getTime() },
  { role: 'assistant', content: '最近的小红花', ts: new Date(2026, 7, 21, 10, 0).getTime() },
]
const hit3 = searchMessages(many, '小红花', today)
eq(hit3.length, 3, '命中 3 条')
eq(hit3[0].msg.content, '最近的小红花', '最近的在最上')
eq(hit3[1].msg.content, '第二次小红花', '其次第二条')
eq(hit3[2].msg.content, '第一次提到小红花', '最旧的沉底')
eq(hit3[0].dayLabel, '昨天', '最近命中标昨天')

console.log('\n[3] searchMessages 命中上下文（前后各一条）')
eq(hit3[1].prev.content, '无关内容', '中间命中的前一条')
eq(hit3[1].next.content, '最近的小红花', '中间命中的后一条')
eq(hit3[0].next, null, '最后一条命中的 next 为 null')
eq(hit3[2].prev, null, '第一条命中的 prev 为 null')

console.log('\n[4] searchMessages 非法数据跳过')
const dirty = [
  m1,
  { role: 'user', content: '有脏数据', ts: NaN },
  { role: 'user', ts: 123 }, // 缺 content
  m3,
]
eq(searchMessages(dirty, '早上好', today).length, 1, '非法时间戳/缺 content 被跳过，只命中 m1')

console.log('\n[5] getCalendarMonth 当月网格')
const feb2026 = getCalendarMonth(2026, 1) // 2026 年 2 月：2/1 是周日
eq(feb2026.length, 5, '2026年2月 5 行')
eq(feb2026[0].length, 7, '每周 7 格')
eq(feb2026[0].filter((c) => c == null).length, 6, '月首 6 个补位（周一到周六）')
eq(feb2026[0][6]?.day, 1, '周日放第一格 → 2/1')
eq(feb2026[1][0]?.day, 2, '第二行周一起 2/2')
eq(feb2026[4][0]?.day, 23, '第五行周一起 2/23')
eq(feb2026[4][6], null, '月末补位 null')
eq(feb2026.flat().length, 35, '2 月网格共 35 格')

const jun2026 = getCalendarMonth(2026, 5) // 2026 年 6 月：6/1 是周一
eq(jun2026[0][0]?.day, 1, '6/1 周一排第一格')
eq(jun2026[4][0]?.day, 29, '第五行周一起 6/29')
eq(jun2026[4][6], null, '6 月 30 天后的补位')
eq(jun2026.flat().filter((c) => c != null).length, 30, '6 月实格 30 天')

const dec2026 = getCalendarMonth(2026, 11)
eq(dec2026.flat().filter((c) => c != null).length, 31, '12 月实格 31 天')
eq(dec2026.flat().find((c) => c?.key === '2026-12-31')?.day, 31, '12/31 的 key 正确')

console.log('\n[6] highlightDayKeys 高亮日期集合')
eq(highlightDayKeys([]), [], '空消息 → 空集合')
eq(
  highlightDayKeys([m3, m1, m2, m3]),
  ['2026-08-20', '2026-08-21'],
  '去重 + 升序（重复的天只留一次）',
)
eq(
  highlightDayKeys([{ role: 'user', content: 'x', ts: NaN }]),
  [],
  '非法时间戳跳过',
)

console.log('\n[7] shiftMonth 切月')
eq(shiftMonth(2026, 7, 1), { year: 2026, month: 8 }, '8月 → 9月')
eq(shiftMonth(2026, 7, -1), { year: 2026, month: 6 }, '8月 → 7月')
eq(shiftMonth(2026, 0, -1), { year: 2025, month: 11 }, '1月 → 去年12月')
eq(shiftMonth(2026, 11, 1), { year: 2027, month: 0 }, '12月 → 明年1月')

console.log('\n[8] monthLabel / calendarMonthRange')
eq(monthLabel(2026, 7), '2026年8月', '月份标题 2026年8月')
eq(monthLabel(2026, 0), '2026年1月', '1 月标题')
const julyMsg = { role: 'user', content: '七月的老消息', ts: new Date(2026, 6, 15, 12, 0).getTime() } // 2026-07-15
eq(
  calendarMonthRange([m1, m2, m3, julyMsg], today),
  { minYear: 2026, minMonth: 6, maxYear: 2026, maxMonth: 7 },
  '最早 7月 最晚 8月',
)
eq(
  calendarMonthRange([m1, m2, m3], today),
  { minYear: 2026, minMonth: 7, maxYear: 2026, maxMonth: 7 },
  '全在 8月 → 只 8月',
)
const onlyThis = calendarMonthRange([], today)
eq(onlyThis, { minYear: 2026, minMonth: 7, maxYear: 2026, maxMonth: 7 }, '无消息 → 只有当前月')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
