// 因果链第一步 · 未来意图识别自测（纯函数）
// 跑法：node scripts/test_future_intent.mjs
// 覆盖：意图识别（看/吃/去/约定）/ 时间推算（明天/周X/周末/X月X日/X号/下周）/ 该不算的不算 / 回忆不误伤
import { parseFutureIntent, futureDayKey } from '../src/lib/futureIntent.ts'
import { recordChatTopic, loadChatTopics, collectTopicDays } from '../src/lib/chatTopics.ts'

// 接入层测试需要 localStorage
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

console.log('\n[1] 意图识别：看电影类')
const m1 = parseFutureIntent('我想去看那个新电影，明天去？', now)
ok(m1 !== null, '「想看…电影，明天」→ 认出')
eq(m1.kind, 'watch', 'kind=watch')
eq(m1.dayOffset, 1, '明天 → offset 1')
ok(m1.intent.includes('电影'), `intent 含对象：${m1.intent}`)
const m1b = parseFutureIntent('周五晚上我们去看那部片子吧', now)
eq(m1b.kind, 'watch', '「周五…去看…片子」→ watch')
eq(m1b.dayOffset, 2, '周三说周五 → offset 2')
eq(m1b.when, '周五', 'when=周五')
const m1c = parseFutureIntent('下周三是吧，一起看新上映的动画电影', now)
ok(m1c.dayOffset === 7, `周三说下周三 → offset 7（得 ${m1c.dayOffset}）`)

console.log('\n[2] 意图识别：吃饭类')
const m2 = parseFutureIntent('那明天晚上去吃火锅！', now)
eq(m2.kind, 'eat', '「去吃火锅」→ eat')
eq(m2.dayOffset, 1, '明天 → offset 1')
const m2b = parseFutureIntent('周末约好了一起撸串', now)
eq(m2b.kind, 'eat', '「约好一起撸串」→ eat')
ok(m2b.dayOffset === 3, `周三说周末 → 周六 offset 3（得 ${m2b.dayOffset}）`)

console.log('\n[3] 意图识别：出门/去某地 + 泛约定')
const m3 = parseFutureIntent('明天我们去爬山吧！', now)
eq(m3.kind, 'go', '「去爬山」→ go')
const m3b = parseFutureIntent('约好周日去逛公园', now)
eq(m3b.kind, 'go', '「约好…去逛公园」→ go')
eq(m3b.dayOffset, 4, '周三说周日 → offset 4')
const m3c = parseFutureIntent('说好了下周末一起去露营', now)
ok(m3c !== null && m3c.kind === 'go', '「说好下周末露营」→ 认出')
ok(m3c.dayOffset === 10, `下周末 → 下周六 offset 10（得 ${m3c.dayOffset}）`)

console.log('\n[4] 该不算的不算（红线）')
eq(parseFutureIntent('好想看那个电影啊', now), null, '只有想没约时间 → 不算')
eq(parseFutureIntent('今天好累想睡觉', now), null, '没计划的日常 → 不算')
eq(parseFutureIntent('明天要加班，烦死了', now), null, '时间词但没共同计划 → 不算')
eq(parseFutureIntent('昨天去看的电影真好看', now), null, '回忆过去（昨天…去看）→ 不算')
eq(parseFutureIntent('上周我们吃的火锅真不错', now), null, '回忆过去（上周…吃）→ 不算')
eq(parseFutureIntent('晚安', now), null, '无关话 → 不算')
eq(parseFutureIntent('', now), null, '空串 → 不算')

console.log('\n[5] 时间推算：具体日期 / 号 / 今晚待会')
const m5 = parseFutureIntent('9月15号那天我们去看展吧', now)
ok(m5 !== null && m5.dayOffset === 6, `9月15号（9/9说）→ offset 6（得 ${m5?.dayOffset}）`)
const m5b = parseFutureIntent('那待会儿一起去吃个饭？', now)
eq(m5b.dayOffset, 0, '待会儿 → 今天内 offset 0')
const m5c = parseFutureIntent('今晚去看电影不？', now)
eq(m5c.kind, 'watch', '今晚看电影 → watch')
eq(m5c.dayOffset, 0, '今晚 → offset 0')
const m5d = parseFutureIntent('这周日一起去看海吧', now)
eq(m5d.dayOffset, 4, '周三说这周日 → offset 4')

console.log('\n[6] futureDayKey：算自然日')
eq(futureDayKey(parseFutureIntent('明天去看电影', now), now), '2026-09-10', '明天 → 2026-09-10')
eq(futureDayKey(parseFutureIntent('周五晚上去吃火锅', now), now), '2026-09-11', '周五 → 2026-09-11')
eq(futureDayKey(parseFutureIntent('下周三去看展', now), now), '2026-09-16', '下周三 → 2026-09-16')
eq(futureDayKey(parseFutureIntent('待会去看电影', now), now), '2026-09-09', '待会（今天）→ 2026-09-09')

console.log('\n[7] 接入：recordChatTopic 存约定发生日，loadChatTopics 兼容老数据')
resetStore()
// 周五（9/11）去看电影 → 存 futureDay=2026-09-11
recordChatTopic('周五晚上我们去看那部新电影吧', undefined, now.getTime())
let topics = loadChatTopics()
eq(topics.length, 1, '话题记了 1 条')
eq(topics[0].t.includes('电影'), true, '话题内容保留')
eq(topics[0].futureDay, '2026-09-11', '约定发生日 = 9-11（周五）')
// 非约定消息不写 futureDay
recordChatTopic('今天上班好累啊', undefined, now.getTime())
topics = loadChatTopics()
ok(topics.some((x) => x.t.includes('上班')) && topics.every((x) => x.futureDay === undefined || x.t.includes('电影')), '普通消息不误标 futureDay')
// 老数据（无 futureDay / 纯字符串）照常读
store.set('ai_space_recent_topic', JSON.stringify(['老格式纯字符串', { t: '周五去看电影', ts: now.getTime() }]))
topics = loadChatTopics()
eq(topics[0].t, '老格式纯字符串', '纯字符串老话题兼容')
eq(topics[0].futureDay, undefined, '老话题无 futureDay')
eq(topics[1].futureDay, undefined, '老对象无 futureDay 也兼容（不崩）')

console.log('\n[8] collectTopicDays：话题日 + 约定日（未到期不算、到期算、过期算）')
resetStore()
recordChatTopic('周五去看电影', undefined, now.getTime()) // futureDay 9-11（未到）
recordChatTopic('今天中午吃了碗面', undefined, now.getTime()) // 普通话题 ts=今天
const today = '2026-09-09'
let days = collectTopicDays(loadChatTopics(), today)
ok(days.has(today), '今天聊的话题 → 今天是事件日')
ok(!days.has('2026-09-11'), '还没到的约定（周五）→ 不算事件日（不预生成未来动态）')
// 到了那天（假设现在是 9-12，约定 9-11 已过）→ 约定日成为事件日
const laterTopics = [
  { t: '周五去看电影', ts: new Date(2026, 8, 9, 20).getTime(), futureDay: '2026-09-11' },
  { t: '后天去爬山', ts: new Date(2026, 8, 9, 20).getTime(), futureDay: '2026-09-14' },
]
const laterDays = collectTopicDays(laterTopics, '2026-09-12')
ok(laterDays.has('2026-09-11'), '约定日已过（9-11 ≤ 今天 9-12）→ 事件日，回填补"看完那部片"的动态')
ok(!laterDays.has('2026-09-14'), '后天的约定还没到 → 不算')
ok(laterDays.has('2026-09-09'), '说话那天本身仍是事件日')
// 约定当天（futureDay=今天）→ 今天事件日（晚上去看，当晚/明天动态呼应）
const todayTopics = [{ t: '今晚去看电影', ts: new Date(2026, 8, 9, 18).getTime(), futureDay: '2026-09-09' }]
const todayDays = collectTopicDays(todayTopics, today)
ok(todayDays.has(today), '约定就在今天 → 今天事件日（白天打开也能补）')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
