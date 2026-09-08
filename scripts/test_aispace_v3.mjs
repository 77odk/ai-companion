// AI Space v3 补全自测（事件通道 + 配额账本 + 素材/时刻注入 + 色卡清理）
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖构建工具。
// 跑法：node scripts/test_aispace_v3.mjs
// 覆盖：事件优先不吞日常配额 / 事件一天一条 / 全天 ≤MAX_TOTAL_PER_DAY /
//       当天补发通道（窗口不含今天时今天的新大事仍趁热发）/
//       账本读写与跨天滚动 / 删动态不回升 / 时刻注入与素材注入提示词 / LLM 端到端落盘记账

import {
  planBackfillSlots,
  planBackfillTimestamps,
  advanceTimeline,
  dayKeyOf,
  dayStartOf,
  dayUsage,
  addLedgerEntry,
  pruneLedger,
  getLedgerEntry,
  formatNowAnchor,
  MAX_POSTS_PER_DAY,
  MAX_TOTAL_PER_DAY,
  MAX_BACKFILL_DAYS,
} from '../src/lib/aiSpaceCore.ts'
import { buildLlmMessages, buildLlmPost } from '../src/lib/aiSpaceLlm.ts'
import { refreshSpace, generatePendingPosts, loadCurrentPosts, readLedger } from '../src/lib/aiSpace.ts'
import { recordChatTopic } from '../src/lib/chatTopics.ts'
import { savePersona, saveSettings } from '../src/lib/storage.ts'

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

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// 简易 localStorage mock（Node 无 localStorage）
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

// 固定「今天」2026-09-09 白天（本地时区构造，跨天/时段判断全程自洽）
const now = new Date(2026, 8, 9, 12, 0).getTime()
const todayKey = dayKeyOf(now)
const yesterdayKey = dayKeyOf(now - DAY)
const twoDaysAgoVisit = now - 2 * DAY - 2 * HOUR // 上次访问=前天上午，窗口=昨天+今天

console.log('\n[1] 常量与账本纯函数')
eq(MAX_POSTS_PER_DAY, 2, '日常配额仍为 2（MAX_POSTS_PER_DAY 语义保留）')
eq(MAX_TOTAL_PER_DAY, 3, '全天总数上限 = 日常 2 + 事件 1 = 3')
let ledger = {}
ledger = addLedgerEntry(ledger, todayKey, 'daily')
ledger = addLedgerEntry(ledger, todayKey, 'daily')
ledger = addLedgerEntry(ledger, todayKey, 'event')
eq(ledger[todayKey], { daily: 2, event: 1 }, '记账：同天两条日常 + 一条事件分开累计')
ledger = addLedgerEntry(ledger, '2026-09-08', 'event')
eq(Object.keys(ledger).length, 2, '历史键先记着')
const rolled = pruneLedger(ledger, todayKey)
eq(Object.keys(rolled), [todayKey], '跨天滚动：只保留今天的键')
eq(rolled[todayKey], { daily: 2, event: 1 }, '滚动后今天的计数原样保留')
eq(getLedgerEntry(undefined, todayKey), { daily: 0, event: 0 }, '无账本 → 全 0')
eq(getLedgerEntry({}, 'x'), { daily: 0, event: 0 }, '空账本 → 全 0')
eq(dayUsage([], todayKey, { [todayKey]: { daily: 2, event: 1 } }), { daily: 2, event: 1, total: 3 }, 'dayUsage 账本优先')
const withPosts = [{ id: 'x', at: now - 2 * HOUR, kind: '日常', text: 'x' }]
eq(dayUsage(withPosts, todayKey), { daily: 1, event: 0, total: 1 }, 'dayUsage 按现存动态数（老数据无 source=日常）')
eq(dayUsage(withPosts, todayKey, { [todayKey]: { daily: 2, event: 0 } }).daily, 2, 'dayUsage = max(现存, 账本)：删了动态配额照扣')
eq(formatNowAnchor(now), '2026年9月9日 星期三', 'formatNowAnchor 生成中文日期锚（含星期）')

console.log('\n[2] 事件通道：大事趁热，不被日常 2 条配额吞掉')
// 昨天已是日常 2 条 + 昨天聊过事 → 仍补 1 条事件（旧版会 continue 吞掉）
const fullDaily = [
  { id: 'a', at: now - DAY + 5 * HOUR, kind: '日常', text: 'A' },
  { id: 'b', at: now - DAY + 9 * HOUR, kind: '日常', text: 'B' },
]
const slots1 = planBackfillSlots(twoDaysAgoVisit, now, fullDaily, new Set([yesterdayKey]), () => 0.1)
const yEvt = slots1.filter((s) => dayKeyOf(s.at) === yesterdayKey)
eq(yEvt.length, 1, '日常满 2 条的昨天仍补 1 条')
eq(yEvt[0].source, 'event', '补的是事件动态（source=event）')
ok(!slots1.some((s) => s.source === 'daily' && dayKeyOf(s.at) === yesterdayKey), '不再补日常（日常配额独立，事件不占）')
// 事件已发过 → 一天一件事，不再补
const hasEvent = [...fullDaily, { id: 'c', at: now - DAY + 11 * HOUR, kind: '日常', text: 'C', source: 'event' }]
const slots1b = planBackfillSlots(twoDaysAgoVisit, now, hasEvent, new Set([yesterdayKey]), () => 0.1)
ok(!slots1b.some((s) => dayKeyOf(s.at) === yesterdayKey), '昨天已有事件动态 → 当天不再补事件')
// 全天总数 ≤3：日常 2 + 事件 1 后不再有任何新槽
const slots1c = planBackfillSlots(twoDaysAgoVisit, now, hasEvent, new Set([yesterdayKey, todayKey]), () => 0.1)
const byDay = (slots) =>
  slots.reduce((m, s) => {
    const k = dayKeyOf(s.at)
    m[k] = (m[k] ?? 0) + 1
    return m
  }, {})
ok(Object.values(byDay(slots1c)).every((n) => n <= MAX_TOTAL_PER_DAY), '任意一天槽数 ≤ 全天上限 3')

console.log('\n[3] 事件不占日常配额 + advanceTimeline 落盘按 source 分开')
const vars = { taName: 'TA', yourName: '小七', season: '秋', timeWord: '中午', weatherWord: '晴' }
// 事件日（今天聊过事）但今天日常已 2 条 → advanceTimeline 仍产出 1 条事件（全天 3 条，日常不缩水）
const todayFull = [
  { id: 'd', at: now - 3 * HOUR, kind: '日常', text: 'D', source: 'daily' },
  { id: 'e', at: now - 1 * HOUR, kind: '日常', text: 'E', source: 'daily' },
]
const res3 = advanceTimeline(
  { posts: todayFull, lastVisit: twoDaysAgoVisit, used: {} },
  vars,
  now,
  new Set([todayKey]),
  () => 0.2,
)
const todayCounts = { daily: 0, event: 0 }
for (const p of res3.state.posts) {
  if (dayKeyOf(p.at) !== todayKey) continue
  if (p.source === 'event') todayCounts.event++
  else todayCounts.daily++
}
eq(todayCounts, { daily: 2, event: 1 }, '事件动态不占日常配额：日常仍 2 条，事件另加 1 条')
eq(res3.state.posts.filter((p) => dayKeyOf(p.at) === todayKey).length, 3, '当天共 3 条（= 全天上限）')
// 非事件日：日常配额照旧 ≤2
const res3b = advanceTimeline(
  { posts: todayFull, lastVisit: twoDaysAgoVisit, used: res3.state.used },
  vars,
  now,
  new Set(),
  () => 0.1,
)
const today3b = res3b.state.posts.filter((p) => dayKeyOf(p.at) === todayKey)
ok(today3b.every((p) => p.source !== 'event'), '非事件日不产事件动态')
ok(today3b.length <= 2, '非事件日日常 ≤2 条')
// 生成的动态都带 source 通道、不再写 art
for (const p of res3b.state.posts) {
  ok(p.source === 'daily' || p.source === 'event', `动态带合法 source（得 ${p.source}）`)
  ok(p.art == null, `v3 动态不写 art 色卡字段（id=${p.id.slice(0, 6)}）`)
}

console.log('\n[4] 当天补发通道：窗口不含今天时，今天新聊出的大事仍趁热发')
// 上次访问就是今天上午（窗口=空）→ 今天白天补发了话题 → 进空间仍补 1 条今天的事件动态
const thisMorning = new Date(2026, 8, 9, 8, 0).getTime()
const revisit = new Date(2026, 8, 9, 14, 0).getTime()
eq(planBackfillTimestamps(thisMorning, revisit, [], new Set()).length, 0, '无新事件时窗口不含今天 → 不补（刚更新过）')
const catchup = planBackfillSlots(thisMorning, revisit, [], new Set([todayKey]), () => 0.3)
eq(catchup.length, 1, '今天新聊出大事 → 补 1 条')
eq(catchup[0].source, 'event', '补的是事件动态')
ok(dayKeyOf(catchup[0].at) === todayKey && catchup[0].at < revisit - 5 * MINUTE, '事件时间戳在今天已过去的时段')
// 防抖：距上次访问不足 2h → 大事也不补（留给下次进空间）
const tooSoon = new Date(2026, 8, 9, 8, 30).getTime()
eq(planBackfillSlots(thisMorning, tooSoon, [], new Set([todayKey])).length, 0, '30 分钟内重复进空间：防抖优先，不补')
// 凌晨（0-4 点）：今天的大事件要等白天，绝不补凌晨的「今天」动态
const midnight = new Date(2026, 8, 9, 3, 0).getTime()
const midSlots = planBackfillSlots(midnight - 2 * DAY, midnight, [], new Set([dayKeyOf(midnight)]), () => 0.3)
ok(!midSlots.some((s) => dayKeyOf(s.at) === dayKeyOf(midnight)), '凌晨 3 点不补当天的动态（TA 在睡觉，锚点让给昨天）')

console.log('\n[5] 删动态不回升（账本挡刷屏）')
// 场景：今天日常 2 条已发过、被用户删光（posts=[]），账本还记着 daily=2
const ledgerTodayFull = { [todayKey]: { daily: 2, event: 0 } }
const noRegen = planBackfillSlots(twoDaysAgoVisit, now, [], new Set(), () => 0.05, ledgerTodayFull)
ok(!noRegen.some((s) => dayKeyOf(s.at) === todayKey), '今天日常已发 2 条（账本记着，动态被删）→ 不再补日常')
const regenIfNoLedger = planBackfillSlots(twoDaysAgoVisit, now, [], new Set(), () => 0.05)
ok(regenIfNoLedger.some((s) => dayKeyOf(s.at) === todayKey), '对照：没有账本时同样的空列表会补日常（账本才是防刷屏关键）')
// 事件不受影响：账本 daily=2 但今天聊出大事 → 仍补 1 条事件（total 2 < 3）
const evtAfterDelete = planBackfillSlots(twoDaysAgoVisit, now, [], new Set([todayKey]), () => 0.05, ledgerTodayFull)
eq(evtAfterDelete.filter((s) => s.source === 'event' && dayKeyOf(s.at) === todayKey).length, 1, '删了日常动态后，今天的大事件照常补（不占已扣的日常配额）')
// advanceTimeline 同样吃账本
const res5 = advanceTimeline(
  { posts: [], lastVisit: twoDaysAgoVisit, used: {} },
  vars,
  now,
  new Set([todayKey]),
  () => 0.05,
  ledgerTodayFull,
)
const today5 = res5.state.posts.filter((p) => dayKeyOf(p.at) === todayKey)
eq(today5.filter((p) => p.source === 'event').length, 1, 'advanceTimeline（模板路径）吃账本：只补事件不补日常')
ok(today5.every((p) => p.source === 'event'), 'advanceTimeline 不把已扣日常配额的今天补回日常')

console.log('\n[6] 持久账本：localStorage 读写 + 跨天滚动 + 会话分 key')
resetStore()
eq(readLedger(), {}, '无账本 → {}')
store.set('ai_space_ledger', JSON.stringify({ '2026-09-07': { daily: 1, event: 0 }, '2026-09-08': { daily: 2, event: 1 } }))
eq(readLedger(undefined, now), {}, '读时自动过滤非今天键：全历史键都被滚掉')
store.set('ai_space_ledger', JSON.stringify({ [todayKey]: { daily: 2, event: 1 }, '2026-09-08': { daily: 2, event: 1 } }))
const kept = readLedger(undefined, now)
eq(Object.keys(kept), [todayKey], '今天的键保留，昨天的键被过滤（跨天滚动）')
eq(kept[todayKey], { daily: 2, event: 1 }, '今天计数原样')
store.set('ai_space_ledger_7', JSON.stringify({ [todayKey]: { daily: 1, event: 0 } }))
eq(readLedger('7', now)[todayKey].daily, 1, '有会话：账本按会话分 key 读写')
eq(readLedger(undefined, now)[todayKey].daily, 2, '无会话回落全局 key，互不串')
store.set('ai_space_ledger', 'not json')
eq(readLedger(undefined, now), {}, '坏数据兜底空账本')

console.log('\n[7] 时刻锚 + 素材注入（buildLlmMessages 提示词）')
const llmMsgs = buildLlmMessages({
  taName: '小忆',
  yourName: '阿明',
  persona: '你是只猫，爱晒太阳',
  season: '秋',
  timeWord: '上午',
  weatherWord: '晴',
  atDateStr: '9月7日',
  recent: ['昨天追了一下午的剧', '煮了碗面'],
  nowAnchor: '2026年9月9日 星期三',
})
const user = llmMsgs[1].content
ok(user.includes('【当前时刻】现在是 2026年9月9日 星期三'), '注入当前真实时刻锚（星期几，防跨天说错日子）')
ok(user.includes('9月7日') && user.includes('别把日子说错'), 'at 对齐日期与时刻锚共存：明确以动态标注时间为准')
ok(user.includes('别重复同样的内容，生活继续往前'), '素材注入：最近动态别重复，生活继续往前')
// 事件动态提示词走「那天共同的事」通道
const evtMsgs = buildLlmMessages({
  taName: '小忆',
  yourName: '阿明',
  persona: '你是只猫，爱晒太阳',
  season: '秋',
  timeWord: '晚上',
  weatherWord: '晴',
  atDateStr: '9月9日',
  recent: [],
  chatTopics: ['今天 晚上一起去看电影'],
  nowAnchor: '2026年9月9日 星期三',
  postSource: 'event',
})
ok(evtMsgs[1].content.includes('这条动态正是为你和对方那天共同经历或约好的事发的'), '事件动态：以当天共同的事为主体写')
// 日常动态仍是素材换血（九成写自己）
const dailyMsgs = buildLlmMessages({
  taName: '小忆',
  yourName: '阿明',
  persona: '你是只猫，爱晒太阳',
  season: '秋',
  timeWord: '中午',
  weatherWord: '晴',
  atDateStr: '9月9日',
  recent: [],
  chatTopics: ['今天 晚上一起去看电影'],
  nowAnchor: '2026年9月9日 星期三',
  postSource: 'daily',
})
ok(dailyMsgs[1].content.includes('大多数动态写你自己的日子就好'), '日常动态：素材换血（写自己的日子）')
ok(dailyMsgs[1].content.includes('不是你的全部生活'), '素材换血：TA 不是对方生活的复读机')

console.log('\n[8] 端到端（LLM 路径）：refreshSpace → generatePendingPosts 事件落盘 + 记账 + [配图]剥除')
resetStore()
// 有人设 + 有 key（走 LLM）
savePersona('你是小忆，爱喝咖啡，最近在学画画')
saveSettings({ provider: 'custom', apiKey: 'k-test', baseUrl: 'https://llm.test/v1', model: 'm-test' })
// 今天聊过的大事（带 ts → 事件日）
recordChatTopic('晚上约好一起去看电影', undefined, now - 1 * HOUR)
// 上次访问在昨天：窗口含今天
store.set('ai_space_last_visit', String(new Date(2026, 8, 8, 10, 0).getTime()))
let lastUserMsg = ''
let userMsgCount = 0
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body ?? '{}'))
  const msg = (body.messages ?? []).find((m) => m.role === 'user')
  lastUserMsg = msg?.content ?? ''
  userMsgCount++
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: '散场出来，风挺凉，电影里的那句台词还在脑子里转。\n[配图]路灯下的长影' } }],
    }),
  }
}
const plan8 = refreshSpace('小忆', '阿明', now)
eq(plan8.mode, 'llm', '有人设+key → llm 模式')
eq(plan8.pending.length, 1, '今天的事件日 → 1 条待生成（事件）')
eq(plan8.pending[0].source, 'event', 'pending 带来源通道 = event')
const res8 = await generatePendingPosts(plan8, '小忆', '阿明', undefined, now)
eq(res8.created, 1, '生成 1 条')
eq(res8.usedFallback, false, 'LLM 成功，无模板降级')
ok(lastUserMsg.includes('【当前时刻】现在是 2026年9月9日 星期三'), '发给模型的 user 含当前时刻锚')
ok(lastUserMsg.includes('这条动态正是为你和对方那天共同经历或约好的事发的'), '发给模型的是事件动态提示词')
ok(userMsgCount >= 1, '真实发起过 LLM 请求')
const saved8 = loadCurrentPosts()
eq(saved8.length, 1, '落盘 1 条')
eq(saved8[0].source, 'event', '落盘动态 source=event')
ok(!saved8[0].text.includes('[配图]'), '[配图] 标记被剥除（纯文字清洗保留）')
ok(saved8[0].text.includes('散场出来'), '正文保留')
ok(saved8[0].art == null, '落盘动态不写 art')
const ledger8 = readLedger(undefined, now)
eq(ledger8[todayKey]?.event ?? 0, 1, '事件动态记入账本 event=1')
eq(ledger8[todayKey]?.daily ?? 0, 0, '事件不占日常配额：daily 仍 0')
// 模板降级路径也记账（fetch 抛错 → 降级模板，source 仍 event）
resetStore()
savePersona('你是小忆，爱喝咖啡')
saveSettings({ provider: 'custom', apiKey: 'k-test', baseUrl: 'https://llm.test/v1', model: 'm-test' })
recordChatTopic('约好明天一起去爬山', undefined, now - 1 * HOUR)
store.set('ai_space_last_visit', String(new Date(2026, 8, 8, 10, 0).getTime()))
globalThis.fetch = async () => {
  throw new Error('network down')
}
const plan8b = refreshSpace('小忆', '阿明', now)
const res8b = await generatePendingPosts(plan8b, '小忆', '阿明', undefined, now)
eq(res8b.created, 1, 'LLM 失败 → 模板降级仍生成 1 条')
eq(res8b.usedFallback, true, 'usedFallback 标记')
const saved8b = loadCurrentPosts()
eq(saved8b[0].source, 'event', '降级模板也带 source=event（配额账本两条路径都记账）')
eq(readLedger(undefined, now)[todayKey]?.event ?? 0, 1, '降级生成的也记入账本 event=1')

console.log('\n[9] 端到端（模板路径）：refreshSpace 落盘 source + 记账 + 删动态不回升')
resetStore()
savePersona('你是小忆，爱喝咖啡') // 有人设但没 key → 模板路径
saveSettings({ provider: 'custom', apiKey: '', baseUrl: '', model: '' })
const plan9 = refreshSpace('小忆', '阿明', now)
eq(plan9.mode, 'template', '有人设没 key → 模板路径同步生成')
ok(plan9.created >= 1, `本次生成 ${plan9.created} 条`)
const saved9 = loadCurrentPosts()
ok(saved9.length === plan9.posts.length, '落盘与返回一致')
ok(saved9.every((p) => p.source === 'daily' || p.source === 'event'), '模板路径落盘动态都带合法 source')
ok(saved9.every((p) => p.art == null), '模板路径不再写 art 色卡字段')
eq(readLedger(undefined, now)[todayKey]?.daily ?? 0, 1, '首访今天 1 条日常已记账（daily=1）')
// 手动删掉今天动态 + 账本不删 → 同一天再来（>2h）不会重生成刷屏
const later = new Date(2026, 8, 9, 18, 0).getTime()
const todayPosts9 = saved9.filter((p) => dayKeyOf(p.at) === todayKey)
for (const p of todayPosts9) {
  const idx = store.get('ai_space_posts')
  const arr = JSON.parse(idx ?? '[]')
  store.set('ai_space_posts', JSON.stringify(arr.filter((x) => x.id !== p.id)))
}
eq(loadCurrentPosts().filter((p) => dayKeyOf(p.at) === todayKey).length, 0, '模拟用户删光今天的动态')
const plan9b = refreshSpace('小忆', '阿明', later)
eq(plan9b.created, 0, '删光今天动态后当天再来：窗口已结算 + 账本照扣 → 不再生成（防刷屏）')
ok(loadCurrentPosts().every((p) => dayKeyOf(p.at) !== todayKey), '今天没有被重新生成')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
