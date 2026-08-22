// 记忆页 v2 · 顶部汇总纯逻辑自测
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_memory_summary.mjs
// 覆盖：空/单条/多条 / 主题并列 / 最常惦记 / 最早时间 / 相处天数 / 跨年日期 / 重要记忆计数 / LLM 提示词 / 返回清洗

import {
  summarizeStats,
  buildTopTopicLine,
  formatSummaryDate,
  buildKnownSince,
  formatFirstRememberedDate,
  computeKnownDays,
  buildSummaryMessages,
  cleanSummaryText,
} from '../src/lib/memorySummary.ts'

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

// 固定一个「今天」：2026-08-22
const today = new Date(2026, 7, 22, 12, 0).getTime()
const tsSame = new Date(2026, 7, 20, 10, 30).getTime() // 2026-08-20（同年）
const tsOld = new Date(2025, 0, 5, 9, 0).getTime() // 2025-01-05（跨年）

// pinned 传 true/false 表示显式带字段（默认不带 = 旧数据不置顶）
const M = (id, text, topic, ts, pinned) => ({
  id,
  text,
  ...(topic ? { topic } : {}),
  ...(ts != null ? { createdAt: ts } : {}),
  ...(pinned != null ? { pinned } : {}),
})

console.log('\n[1] summarizeStats 空 / 非法 / 单条')
eq(summarizeStats([]), { count: 0, topicCount: 0, topTopic: null, earliestTs: null, daysKnown: 1, pinnedCount: 0 }, '空数组')
eq(summarizeStats(null), { count: 0, topicCount: 0, topTopic: null, earliestTs: null, daysKnown: 1, pinnedCount: 0 }, 'null 兜底为空统计')
eq(summarizeStats([null, undefined, { id: 'x' }]), { count: 0, topicCount: 0, topTopic: null, earliestTs: null, daysKnown: 1, pinnedCount: 0 }, '字段非法被过滤')
eq(
  summarizeStats([M('a', '爱吃辣', '饮食', tsSame)]),
  { count: 1, topicCount: 1, topTopic: null, earliestTs: tsSame, daysKnown: 3, pinnedCount: 0 },
  '单条：不足 2 条不点评',
)
eq(
  summarizeStats([M('a', '爱吃辣', undefined, tsSame)]),
  { count: 1, topicCount: 1, topTopic: null, earliestTs: tsSame, daysKnown: 3, pinnedCount: 0 },
  '无主题按关键词推断为饮食（仍不足 2 条 → 不点评）',
)

console.log('\n[2] 主题统计 / 并列')
eq(
  summarizeStats([M('a', '爱吃辣', '饮食', tsSame), M('b', '爱喝奶茶', '饮食', tsSame)]),
  { count: 2, topicCount: 1, topTopic: '饮食', earliestTs: tsSame, daysKnown: 3, pinnedCount: 0 },
  '两条同主题 → 最常惦记饮食',
)
eq(
  summarizeStats([M('a', '爱吃辣', '饮食', tsSame), M('b', '养了只猫', '宠物', tsSame)]),
  { count: 2, topicCount: 2, topTopic: null, earliestTs: tsSame, daysKnown: 3, pinnedCount: 0 },
  '两条不同主题各 1 条 → 不点评',
)
eq(
  summarizeStats([M('a', '爱吃辣', '饮食', tsSame), M('b', '爱喝奶茶', '饮食', tsSame), M('c', '养了只猫', '宠物', tsSame)]),
  { count: 3, topicCount: 2, topTopic: '饮食', earliestTs: tsSame, daysKnown: 3, pinnedCount: 0 },
  '饮食 2 条 > 宠物 1 条 → 点评饮食',
)
eq(
  summarizeStats([M('a', '爱吃辣', '饮食', tsSame), M('b', '养了只猫', '宠物', tsSame), M('c', '爱喝奶茶', '饮食', tsSame), M('d', '猫叫小白', '宠物', tsSame)]),
  { count: 4, topicCount: 2, topTopic: '饮食', earliestTs: tsSame, daysKnown: 3, pinnedCount: 0 },
  '并列 2:2 取最先出现的（饮食在前）',
)
eq(
  summarizeStats([M('a', '养了只猫', '宠物', tsSame), M('b', '爱吃辣', '饮食', tsSame), M('c', '猫叫小白', '宠物', tsSame), M('d', '爱喝奶茶', '饮食', tsSame)]),
  { count: 4, topicCount: 2, topTopic: '宠物', earliestTs: tsSame, daysKnown: 3, pinnedCount: 0 },
  '并列 2:2 取最先出现的（宠物在前）',
)

console.log('\n[3] 最早时间')
eq(
  summarizeStats([M('a', '爱吃辣', '饮食', tsSame), M('b', '养了只猫', '宠物', tsOld)]),
  { count: 2, topicCount: 2, topTopic: null, earliestTs: tsOld, daysKnown: computeKnownDays(tsOld, today), pinnedCount: 0 },
  '多条取最早时间戳',
)
eq(
  summarizeStats([M('a', '爱吃辣', '饮食', NaN), M('b', '养了只猫', '宠物', tsSame)]),
  { count: 2, topicCount: 2, topTopic: null, earliestTs: tsSame, daysKnown: 3, pinnedCount: 0 },
  '非法时间戳被忽略',
)
eq(
  summarizeStats([M('a', '爱吃辣', '饮食')]),
  { count: 1, topicCount: 1, topTopic: null, earliestTs: null, daysKnown: 1, pinnedCount: 0 },
  '没有时间戳 → earliestTs null、天数 1',
)

console.log('\n[3.5] 重要记忆（置顶）计数')
eq(
  summarizeStats([M('a', '爱吃辣', '饮食', tsSame, true), M('b', '养了只猫', '宠物', tsSame)]),
  { count: 2, topicCount: 2, topTopic: null, earliestTs: tsSame, daysKnown: 3, pinnedCount: 1 },
  '1 条置顶 → pinnedCount 1',
)
eq(
  summarizeStats([M('a', '爱吃辣', '饮食', tsSame, true), M('b', '养了只猫', '宠物', tsSame, true), M('c', '怕黑', '生活', tsSame)]),
  { count: 3, topicCount: 3, topTopic: null, earliestTs: tsSame, daysKnown: 3, pinnedCount: 2 },
  '2 条置顶 → pinnedCount 2',
)
eq(
  summarizeStats([M('a', '爱吃辣', '饮食', tsSame, false)]),
  { count: 1, topicCount: 1, topTopic: null, earliestTs: tsSame, daysKnown: 3, pinnedCount: 0 },
  'pinned: false 不算置顶',
)

console.log('\n[4] 相处天数')
eq(computeKnownDays(tsSame, today), 3, '8月20日到22日 → 第 3 天')
eq(computeKnownDays(today, today), 1, '同一天 → 第 1 天')
eq(computeKnownDays(NaN, today), 1, '非法时间戳 → 第 1 天')

console.log('\n[5] 一句话点评')
eq(buildTopTopicLine('饮食'), 'TA 最常惦记你的饮食', '正常点评')
eq(buildTopTopicLine(null), null, 'null → null')
eq(buildTopTopicLine(''), null, '空串 → null')

console.log('\n[6] 日期格式化（含跨年）')
eq(formatSummaryDate(tsSame, today), '8月20日', '同年不去年份')
eq(formatSummaryDate(tsOld, today), '2025年1月5日', '跨年带年份')
eq(formatSummaryDate(NaN, today), '', '非法 → 空串')
eq(buildKnownSince(tsSame, today), '从 8月20日起记得你', '汇总卡最早一条（同年）')
eq(buildKnownSince(tsOld, today), '从 2025年1月5日起记得你', '汇总卡最早一条（跨年）')
eq(buildKnownSince(NaN, today), '', '汇总卡非法 → 空串')
eq(formatFirstRememberedDate(tsSame, today), 'TA 从 8月20日起记得', '单条日期小字（同年）')
eq(formatFirstRememberedDate(tsOld, today), 'TA 从 2025年1月5日起记得', '单条日期小字（跨年）')

console.log('\n[7] 「TA 眼中的你」LLM 提示词')
const msgs = buildSummaryMessages('小忆', '小七', '你是个温柔的人', [
  M('a', '爱吃辣', '饮食', tsSame),
  M('b', '怕黑', '生活', tsSame),
])
eq(msgs.length, 2, 'system + user 两段')
eq(msgs[0].role, 'system', '首条是 system')
eq(msgs[1].role, 'user', '次条是 user')
ok(msgs[0].content.includes('小忆'), 'system 含 TA 昵称')
ok(msgs[0].content.includes('心里话'), 'system 有口吻要求')
ok(msgs[0].content.includes('80 字以内'), 'system 有字数约束')
ok(msgs[1].content.includes('小七'), 'user 含用户昵称')
ok(msgs[1].content.includes('爱吃辣') && msgs[1].content.includes('怕黑'), 'user 含全部记忆文本')
ok(msgs[1].content.includes('你是个温柔的人'), 'user 含人设全文')
ok(!msgs[0].content.includes('{') && !msgs[1].content.includes('{'), '无残留占位符')

console.log('\n[8] LLM 返回清洗')
eq(cleanSummaryText('  在我心里，你是个很暖的人  '), '在我心里，你是个很暖的人', '去首尾空格')
eq(cleanSummaryText('"在我心里，你是个很暖的人"'), '在我心里，你是个很暖的人', '去英文双引号')
eq(cleanSummaryText('“在我心里，你是个很暖的人”'), '在我心里，你是个很暖的人', '去中文双引号')
eq(cleanSummaryText('「在我心里，你是个很暖的人」'), '在我心里，你是个很暖的人', '去中文方引号')
eq(cleanSummaryText(''), null, '空串 → null')
eq(cleanSummaryText('   '), null, '纯空格 → null')
eq(cleanSummaryText('  ""  '), null, '只剩引号 → null')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
