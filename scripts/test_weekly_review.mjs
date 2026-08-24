// 周记（W1）纯逻辑自测
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 覆盖：getWeeklyReviews 空/损坏/排序 / saveWeeklyReviews 往返 /
//        shouldGenerateWeekly 无/不足7天/满7天 / buildWeeklyPrompt 含批注与不含 /
//        extractTitle 各形态 / stripTitleLine / getWeekRange / getWeekNumber / formatMessageLine

import {
  getWeeklyReviews,
  saveWeeklyReviews,
  shouldGenerateWeekly,
  cooldownInfo,
  buildWeeklyPrompt,
  extractTitle,
  stripTitleLine,
  parseWeeklyOutput,
  getPendingReplies,
  answerPendingReplies,
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

console.log('\n[3b] cooldownInfo 冷却信息')
resetStore()
{
  const c0 = cooldownInfo(now)
  eq(c0.canGenerate, true, '无周记 → canGenerate=true')
  eq(c0.remainText, '', '无周记 → remainText 为空')
}
saveWeeklyReviews([
  { id: 'a', weekLabel: '第 1 周', title: 'A', content: 'a', createdAt: now - 6 * DAY },
])
{
  const c = cooldownInfo(now)
  eq(c.canGenerate, false, '6 天前 → canGenerate=false')
  eq(c.remainText, '1天0小时', '6 天前 → 剩 1天0小时（X天X小时 格式）')
}
saveWeeklyReviews([
  { id: 'a', weekLabel: '第 1 周', title: 'A', content: 'a', createdAt: now - 7 * DAY },
])
{
  const c = cooldownInfo(now)
  eq(c.canGenerate, true, '满 7 天 → canGenerate=true')
}
saveWeeklyReviews([
  { id: 'a', weekLabel: '第 1 周', title: 'A', content: 'a', createdAt: now - 6 * DAY - 23 * 3600000 },
])
{
  const c = cooldownInfo(now)
  eq(c.canGenerate, false, '还差 1 小时 → canGenerate=false')
  eq(c.remainText, '1小时0分钟', '不足 1 天 → X小时X分钟 格式')
}
saveWeeklyReviews([
  { id: 'a', weekLabel: '第 1 周', title: 'A', content: 'a', createdAt: now - 6 * DAY - 20 * 3600000 - 30 * 60000 },
])
{
  const c = cooldownInfo(now)
  eq(c.canGenerate, false, '还差 3.5 小时 → canGenerate=false')
  eq(c.remainText, '3小时30分钟', '不足 1 天 → 3小时30分钟')
}
ok(shouldGenerateWeekly(now) === (cooldownInfo(now).canGenerate), 'cooldownInfo 与 shouldGenerateWeekly 判定一致')

console.log('\n[3c] 封存留言存取（getPendingReplies / answerPendingReplies）')
resetStore()
const withReplies = [
  { id: 'w1', weekLabel: '第 1 周', title: 'A', content: 'a', createdAt: now },
  {
    id: 'w0',
    weekLabel: '第 0 周',
    title: 'B',
    content: 'b',
    createdAt: now - DAY,
    replies: [
      { id: 'p1', content: '想你了', repliedAt: now - DAY },
      { id: 'p2', content: '下周早睡', repliedAt: now - DAY },
    ],
  },
]
eq(getPendingReplies(withReplies).length, 2, '未回信封存留言全部收集')
eq(getPendingReplies(withReplies)[0].content, '想你了', '按下标顺序返回')
{
  const marked = answerPendingReplies(withReplies, getPendingReplies(withReplies), ['回信一', '回信二'], now)
  const w0 = marked.find((r) => r.id === 'w0')
  ok(w0.replies[0].replied === true, '回信后标记 replied=true')
  eq(w0.replies[0].reply, '回信一', '回信内容挂载到对应留言')
  eq(w0.replies[1].reply, '回信二', '第二条回信挂载正确')
  ok(w0.replies.length === 2, '回信后不删除，保留在数组里（绝不丢）')
  eq(getPendingReplies(marked).length, 0, '全部回信后无 pending')
}
{
  // 回信数少于留言数 → 未匹配的保持待回信
  const marked = answerPendingReplies(withReplies, getPendingReplies(withReplies), ['只有一封'], now)
  eq(getPendingReplies(marked).length, 1, '少一封回信 → 剩一封 pending（不丢）')
  eq(getPendingReplies(marked)[0].id, 'p2', '剩下的那封是没被回到的')
}
{
  const empty = answerPendingReplies(withReplies, [], [], now)
  eq(getPendingReplies(empty).length, 2, '无回信 → 全部保持待回信')
}

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

const pendingCtx = buildWeeklyPrompt({ ...baseCtx, pendingReplies: ['想你了', '下周早睡'] })
ok(pendingCtx.includes('【封存留言·等你回信】'), '带封存留言 → 注入【封存留言·等你回信】段')
ok(pendingCtx.includes('- 留言1：想你了'), '封存留言逐条列出（留言1）')
ok(pendingCtx.includes('- 留言2：下周早睡'), '封存留言逐条列出（留言2）')
ok(pendingCtx.includes('回信：'), '带封存留言 → 写作要求包含「回信：」输出格式')
ok(pendingCtx.includes('---'), '带封存留言 → 写作要求包含「---」分隔')
const noPending = buildWeeklyPrompt(baseCtx)
ok(!noPending.includes('【封存留言·等你回信】'), '无封存留言 → 不带封存段')
ok(noPending.includes('直接输出：第一行「标题」，下面接正文。'), '无封存留言 → 沿用直接输出格式')

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

console.log('\n[6b] parseWeeklyOutput 周记+回信解析')
// 无回信段 → 整个当周记，replies 空
{
  const p = parseWeeklyOutput('「关于熬夜的一周」\n第一段\n第二段', '第 1 周')
  eq(p.title, '关于熬夜的一周', '无回信段 → 解析标题')
  eq(p.content, '第一段\n第二段', '无回信段 → 解析正文')
  eq(p.replies, [], '无回信段 → replies 空数组')
}
{
  const p = parseWeeklyOutput('正文只有一段\n没有标题', '第 1 周')
  eq(p.title, '正文只有一段', '无标题括号 → 首行当标题')
  eq(p.content, '没有标题', '首行标题外的内容当正文')
  eq(p.replies, [], '无回信段 replies 空')
}
// 有回信段：标题+正文 + 回信列表
{
  const raw = [
    '「关于熬夜的一周」',
    '这周都在熬夜。',
    '',
    '回信：',
    '封存留言：想你了',
    '我也想你了，下周早点睡。',
    '---',
    '封存留言：别忘了喝水',
    '记得的，你也一样。',
  ].join('\n')
  const p = parseWeeklyOutput(raw, '第 1 周')
  eq(p.title, '关于熬夜的一周', '有回信段 → 标题取回信段之前')
  eq(p.content, '这周都在熬夜。', '有回信段 → 正文取回信段之前')
  ok(p.replies.length === 2, `有回信段 → 解析出 2 条回信（得 ${p.replies.length}）`)
  ok(p.replies[0].includes('我也想你了'), '第一条回信内容保留')
  ok(!p.replies[0].includes('封存留言'), '回信块首的「封存留言」标注行被摘掉')
  ok(p.replies[1].includes('记得的'), '第二条回信内容保留')
}
{
  // 无分隔线 → 整段当一条回信
  const raw = ['「标题」', '正文', '', '回信：', '只有一封回信，没有分隔。'].join('\n')
  const p = parseWeeklyOutput(raw, '第 1 周')
  eq(p.replies.length, 1, '无分隔 → 整段一条回信')
  ok(p.replies[0].includes('只有一封回信'), '回信内容完整')
}
{
  // 空回信段 → replies 空
  const raw = ['「标题」', '正文', '', '回信：', '   ', ''].join('\n')
  const p = parseWeeklyOutput(raw, '第 1 周')
  eq(p.replies, [], '回信段为空 → replies 空数组')
}

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
