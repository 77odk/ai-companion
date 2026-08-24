// 周记（W1）纯逻辑自测
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 覆盖：getWeeklyReviews 空/损坏/排序 / saveWeeklyReviews 往返 /
//        shouldGenerateWeekly 无/不足7天/满7天 / buildWeeklyPrompt 含批注与不含 /
//        extractTitle 各形态 / stripTitleLine / getWeekRange / getWeekNumber / formatMessageLine

import {
  getWeeklyReviews,
  saveWeeklyReviews,
  shouldGenerateWeekly,
  buildWeeklyPrompt,
  extractTitle,
  stripTitleLine,
  buildWeekLabel,
  getWeekRange,
  getWeekNumber,
  formatMessageLine,
} from '../src/lib/weeklyReview.ts'

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

// 简易 localStorage mock（weeklyReview 的读写只在函数内，模块导入不触发）
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

// 固定「今天」：2026-08-24 周一（各周区间/周数测试的基准）
const now = new Date(2026, 7, 24, 12, 0).getTime()
const DAY = 24 * 60 * 60 * 1000

console.log('\n[1] getWeeklyReviews 空 / 损坏 / 非法条目')
resetStore()
eq(getWeeklyReviews(), [], '无数据 → 空数组')
localStorage.setItem('ai_companion_weekly_reviews', 'not-json')
eq(getWeeklyReviews(), [], '损坏 JSON → 空数组')
localStorage.setItem('ai_companion_weekly_reviews', JSON.stringify([{ id: 'a' }, null, 42]))
eq(getWeeklyReviews(), [], '字段非法条目被过滤')
localStorage.setItem(
  'ai_companion_weekly_reviews',
  JSON.stringify([
    { id: 'w1', weekLabel: '第 1 周 · 8月18日-8月24日', title: '标题', content: '正文', createdAt: now },
    { id: 'w2', weekLabel: '第 2 周', title: '旧', content: '旧', createdAt: now - DAY },
  ]),
)
const loaded = getWeeklyReviews()
eq(loaded.length, 2, '合法条目能读出来')
eq(loaded[0].id, 'w1', '按 createdAt 降序：新的在前')

console.log('\n[2] saveWeeklyReviews 往返')
resetStore()
const list = [
  { id: 'a', weekLabel: '第 1 周 · 8月18日-8月24日', title: 'A', content: 'a', createdAt: now },
  { id: 'b', weekLabel: '第 2 周', title: 'B', content: 'b', createdAt: now - DAY },
]
saveWeeklyReviews(list)
eq(getWeeklyReviews().length, 2, '保存后能读回')
eq(getWeeklyReviews()[0].id, 'a', '读回按 createdAt 降序')
saveWeeklyReviews('not-array')
eq(getWeeklyReviews(), [], '保存非数组 → 存空数组')

console.log('\n[3] shouldGenerateWeekly 无 / 不足7天 / 满7天')
resetStore()
ok(shouldGenerateWeekly(now) === true, '没有周记 → true')
saveWeeklyReviews([{ id: 'a', weekLabel: '第 1 周', title: 'A', content: 'a', createdAt: now }])
ok(shouldGenerateWeekly(now) === false, '刚生成（不足 7 天）→ false')
saveWeeklyReviews([
  { id: 'a', weekLabel: '第 1 周', title: 'A', content: 'a', createdAt: now - 6 * DAY },
])
ok(shouldGenerateWeekly(now) === false, '6 天前 → false')
saveWeeklyReviews([
  { id: 'a', weekLabel: '第 1 周', title: 'A', content: 'a', createdAt: now - 7 * DAY },
])
ok(shouldGenerateWeekly(now) === true, '7 天前 → true')
saveWeeklyReviews([
  { id: 'a', weekLabel: '第 1 周', title: 'A', content: 'a', createdAt: now - 10 * DAY },
])
ok(shouldGenerateWeekly(now) === true, '10 天前 → true')

console.log('\n[4] buildWeeklyPrompt 组装（含批注 / 不含）')
const baseCtx = {
  weekLabel: '第 1 周 · 8月18日-8月24日',
  summaryLines: ['8月18日 你：晚上吃了米粉', '8月18日 TA：那家的辣椒香不香'],
  newMemories: ['对方喜欢吃米粉', '对方最近熬夜多'],
  daysKnown: 3,
}
const noReply = buildWeeklyPrompt(baseCtx)
ok(noReply.includes('【本周时间段】第 1 周 · 8月18日-8月24日'), '含【本周时间段】与周标签')
ok(noReply.includes('【本周聊天摘要】'), '含【本周聊天摘要】')
ok(noReply.includes('8月18日 你：晚上吃了米粉'), '摘要行保留')
ok(noReply.includes('【本周记住的事】'), '含【本周记住的事】')
ok(noReply.includes('- 对方喜欢吃米粉'), '记忆带 - 前缀')
ok(noReply.includes('【相处天数】今天是你们认识的第 3 天。'), '含认识天数')
ok(!noReply.includes('【上一篇批注】'), '无批注 → 不带上一篇批注段')
ok(noReply.includes('【写作要求】'), '含【写作要求】')
ok(noReply.includes('100-200 字'), '写作要求里带字数')

const withReply = buildWeeklyPrompt({ ...baseCtx, lastReply: '下周记得早点睡呀' })
ok(withReply.includes('【上一篇批注】对方在你上篇周记下留了批注：下周记得早点睡呀'), '含批注 → 带上一篇批注段并附原文')

const emptyCtx = buildWeeklyPrompt({ ...baseCtx, summaryLines: [], newMemories: [] })
ok(emptyCtx.includes('这周你们还没怎么聊。'), '无消息 → 兜底文案')
ok(emptyCtx.includes('这周没有记住什么新的事。'), '无记忆 → 兜底文案')

const personaCtx = buildWeeklyPrompt({ ...baseCtx, persona: '嘴硬心软，爱念叨人' })
ok(personaCtx.includes('【你的性格】嘴硬心软，爱念叨人'), '带人设 → 注入【你的性格】')

console.log('\n[5] extractTitle 标题解析')
eq(extractTitle('「关于熬夜和米粉的一周」\n正文……', '第 1 周'), '关于熬夜和米粉的一周', '首行「」→ 取括号内')
eq(extractTitle('《关于熬夜和米粉的一周》\n正文……', '第 1 周'), '关于熬夜和米粉的一周', '首行《》→ 取括号内')
eq(extractTitle('关于熬夜的一周\n正文……', '第 1 周'), '关于熬夜的一周', '首行无括号 → 整行当标题')
eq(extractTitle('关于熬夜的一周。\n正文……', '第 1 周'), '关于熬夜的一周', '首行结尾标点去掉')
eq(extractTitle('   \n  ', '第 1 周'), '第 1 周', '空内容 → 兜底标题')
eq(extractTitle('', '第 3 周'), '第 3 周', '空串 → 兜底标题')

console.log('\n[6] stripTitleLine 去掉标题行')
eq(stripTitleLine('「标题」\n第一段\n第二段'), '第一段\n第二段', '去掉标题行保留正文')
eq(stripTitleLine('   \n「标题」\n正文\n'), '正文', '前导空行 + 标题行都去掉，保留正文')
eq(stripTitleLine('   \n正文\n'), '', '前导空行后只有一行 → 该行当标题，无正文')
eq(stripTitleLine('只有标题行'), '', '没有正文 → 空串')
eq(stripTitleLine(''), '', '空串 → 空串')

console.log('\n[7] getWeekRange / getWeekNumber / buildWeekLabel')
// 今天 2026-08-24 周一；窗口 = 今天 0 点往前 6 天到今天 23:59:59 → 8月18日-8月24日
const range = getWeekRange(now, new Date(2026, 7, 18, 10, 0).getTime())
eq(range.weekLabel, '第 1 周 · 8月18日-8月24日', '周标签：8月18日-8月24日，认识 6 天算第 1 周')
ok(range.startTs === new Date(2026, 7, 18, 0, 0, 0, 0).getTime(), 'startTs 是 8月18日 0 点')
ok(range.endTs === new Date(2026, 7, 24, 23, 59, 59, 999).getTime(), 'endTs 是 8月24日 23:59:59.999')
eq(range.weekNumber, 1, '窗口周数 1')

eq(getWeekNumber(now, now), 1, '今天认识 → 第 1 周')
eq(getWeekNumber(now, new Date(2026, 7, 17, 10, 0).getTime()), 2, '认识 7 天 → 第 2 周')
eq(getWeekNumber(now, new Date(2026, 7, 10, 10, 0).getTime()), 3, '认识 14 天 → 第 3 周')
eq(getWeekNumber(now, 0), 1, 'firstSeen 非法 → 兜底第 1 周')

eq(buildWeekLabel(new Date(2026, 7, 18, 0, 0).getTime(), new Date(2026, 7, 24, 23, 59, 59).getTime(), 3), '第 3 周 · 8月18日-8月24日', 'buildWeekLabel 格式化')

console.log('\n[8] formatMessageLine 消息精简行')
eq(
  formatMessageLine({ role: 'user', content: '晚上吃了米粉，好辣', ts: new Date(2026, 7, 18, 12, 0).getTime() }),
  '8月18日 你：晚上吃了米粉，好辣',
  'user → 你',
)
eq(
  formatMessageLine({ role: 'assistant', content: '那家的辣椒香不香', ts: new Date(2026, 7, 18, 12, 5).getTime() }),
  '8月18日 TA：那家的辣椒香不香',
  'assistant → TA',
)
const long = '啊'.repeat(80)
const longLine = formatMessageLine({ role: 'user', content: long, ts: now })
ok(longLine.length < 70 && longLine.endsWith('…'), '超长内容截断到 60 字并带省略号')
eq(formatMessageLine({ role: 'user', content: '  a\n  b  ', ts: now }).endsWith('你：a b'), true, '压缩空白')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
