// TA 的空间 · 动态引擎自测
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_aispace.mjs
// 覆盖：首访铺 3 天 / 事件日必补 / 非事件日按概率补（TA 有生活）/ 回填窗口与凌晨锚点 /
//        每天最多 2 条限频 / 上限 20 条 / 模板 30 天不重复 / 时段细分 / 占位替换 / 降级回复话术红线

import {
  KIND_KEYS,
  TEMPLATES,
  getSeason,
  getTimeWord,
  pickWeatherWord,
  planBackfillTimestamps,
  dayStartOf,
  pickDayPostHour,
  pickTemplateIndex,
  buildPostText,
  advanceTimeline,
  dayKeyOf,
  countPostsOnDay,
  pickReplyFallback,
  REPLY_FALLBACKS,
  MAX_POSTS,
  MIN_INTERVAL_MS,
  DAY_INTERVAL_MS,
  THIRTY_DAYS,
  MAX_BACKFILL_DAYS,
  BACKFILL_LIFE_CHANCE,
} from '../src/lib/aiSpaceCore.ts'

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

/** 可复现的伪随机，避免测试受 Math.random 影响 */
function seeded(seed = 42) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u

// 固定一个「今天」：2026-08-22 中午（限频按自然日，固定时间避免测试受跑测时刻影响）
const now = new Date(2026, 7, 22, 12, 0).getTime()
const todayStart = dayStartOf(now)

console.log('\n[1] 模板库完整性')
ok(KIND_KEYS.length >= 6, '至少有 6 个 kind')
for (const kind of KIND_KEYS) {
  const list = TEMPLATES[kind] || []
  ok(list.length >= 4, `${kind} 类模板 ${list.length} 条（≥4）`)
  for (const t of list) {
    ok(!t.includes('演'), `${kind} 模板无「演」字：${t.slice(0, 14)}…`)
    ok(!t.includes('干活'), `${kind} 模板无「干活」二字：${t.slice(0, 14)}…`)
    ok(!EMOJI_RE.test(t), `${kind} 模板无 emoji：${t.slice(0, 14)}…`)
  }
}

console.log('\n[2] 季节 / 时段（细分，2026-09-04） / 天气')
eq(getSeason(new Date(2026, 2, 15).getTime()), '春', '3 月是春')
eq(getSeason(new Date(2026, 5, 15).getTime()), '夏', '6 月是夏')
eq(getSeason(new Date(2026, 8, 15).getTime()), '秋', '9 月是秋')
eq(getSeason(new Date(2026, 11, 15).getTime()), '冬', '12 月是冬')
eq(getTimeWord(new Date(2026, 0, 1, 2).getTime()), '凌晨', '凌晨 2 点 → 凌晨')
eq(getTimeWord(new Date(2026, 0, 1, 6).getTime()), '清晨', '清晨 6 点 → 清晨')
eq(getTimeWord(new Date(2026, 0, 1, 10).getTime()), '上午', '上午 10 点 → 上午')
eq(getTimeWord(new Date(2026, 0, 1, 12).getTime()), '中午', '中午 12 点 → 中午')
eq(getTimeWord(new Date(2026, 0, 1, 16).getTime()), '下午', '下午 16 点 → 下午')
eq(getTimeWord(new Date(2026, 0, 1, 20).getTime()), '晚上', '晚上 20 点 → 晚上')
eq(getTimeWord(new Date(2026, 0, 1, 23).getTime()), '深夜', '深夜 23 点 → 深夜')
const w = pickWeatherWord(seeded(1))
ok(['晴', '雨', '阴', '多云'].includes(w), `天气词合法（得 ${w}）`)

console.log('\n[3] 回填计划·基础（2026-09-04 回填式时间轴）')
// 首访：铺最近 MAX_BACKFILL_DAYS 个自然日，每天 1 条（旧→新）
const firstPlan = planBackfillTimestamps(null, now, [], new Set(), seeded(2))
eq(firstPlan.length, MAX_BACKFILL_DAYS, '首访铺 3 天')
ok(firstPlan[0] < firstPlan[1] && firstPlan[1] < firstPlan[2], '升序（从旧到新）')
const daysOfFirst = new Set(firstPlan.map((ts) => dayKeyOf(ts)))
eq(daysOfFirst.size, MAX_BACKFILL_DAYS, '首访分布在 3 个不同自然日')
for (const ts of firstPlan) {
  const hh = new Date(ts).getHours()
  ok(hh >= 7 && hh <= 23, `首访时间戳在 7-23 点之间（${hh} 点）`)
}
// 防抖：2 小时内不补
eq(planBackfillTimestamps(now - 1 * HOUR, now, [], new Set(), seeded(3)).length, 0, '距上次 1 小时不补')
// 昨天聊过（事件日）→ 必补
const lastVisit = now - 2 * DAY - 2 * HOUR // 前天访问
const yesterdayKey = dayKeyOf(now - DAY)
const evtPlan = planBackfillTimestamps(lastVisit, now, [], new Set([yesterdayKey]), seeded(4))
ok(evtPlan.length >= 1, '事件日（昨天聊过）必补至少 1 条')
const evtDays = new Set(evtPlan.map((ts) => dayKeyOf(ts)))
ok(evtDays.has(yesterdayKey), '补发的动态包含昨天（事件日）')
ok(evtPlan.length <= 2 * MAX_BACKFILL_DAYS, '总量有界')
// 非事件日按概率（总量≤3，每天最多 1 条）
const lifePlan = planBackfillTimestamps(lastVisit, now, [], new Set(), seeded(5))
ok(lifePlan.length <= MAX_BACKFILL_DAYS, '非事件日每天最多 1 条（总量≤3）')
// 凌晨访问：锚点让给昨天，不回填「今天凌晨」
const midnight = new Date(2026, 7, 22, 3, 0).getTime()
const latePlan = planBackfillTimestamps(midnight - 2 * DAY - HOUR, midnight, [], new Set(), seeded(6))
for (const ts of latePlan) {
  ok(dayKeyOf(ts) !== dayKeyOf(midnight), '凌晨 3 点访问不回填今天（TA 在睡觉）')
  ok(ts < dayStartOf(midnight), '凌晨访问回填的都在昨天及以前')
}

console.log('\n[4] 每天最多 2 条（已有动态占用额度）')
// 昨天已满 2 条 → 事件日也不再给昨天加
const yPosts = [
  { id: 'a', at: now - DAY + 5 * HOUR, kind: '日常', text: 'A', art: 0 },
  { id: 'b', at: now - DAY + 9 * HOUR, kind: '日常', text: 'B', art: 0 },
]
const capped = planBackfillTimestamps(lastVisit, now, yPosts, new Set([yesterdayKey]), seeded(7))
ok(!capped.some((ts) => dayKeyOf(ts) === yesterdayKey), '昨天已满 2 条则不再补昨天')
ok(capped.every((ts) => countPostsOnDay(yPosts, dayKeyOf(ts)) < 2 || dayKeyOf(ts) !== yesterdayKey), '不超每日上限')

console.log('\n[5] advanceTimeline 回填生成')
const vars = { taName: 'TA', yourName: '小七', season: '夏', timeWord: '中午', weatherWord: '晴' }
const first = advanceTimeline({ posts: [], lastVisit: null, used: {} }, vars, now, new Set(), seeded(8))
eq(first.created, MAX_BACKFILL_DAYS, '首访创建 3 条')
eq(first.state.posts.length, MAX_BACKFILL_DAYS, '首访后共 3 条')
ok(first.state.posts[0].at > first.state.posts[1].at && first.state.posts[1].at > first.state.posts[2].at, '按时间倒序（最新在前）')
eq(first.state.lastVisit, now, 'lastVisit 更新为本次时间')
const firstDayCounts = {}
for (const p of first.state.posts) firstDayCounts[dayKeyOf(p.at)] = (firstDayCounts[dayKeyOf(p.at)] ?? 0) + 1
ok(Object.values(firstDayCounts).every((n) => n <= 2), '首访每天不超过 2 条')

console.log('\n[6] 限频场景：2 小时内再来不补，事件日必补')
const recent = advanceTimeline(
  { posts: first.state.posts, lastVisit: now - 30 * MINUTE, used: first.state.used },
  vars,
  now,
  new Set([dayKeyOf(now)]),
  seeded(9),
)
eq(recent.created, 0, '距上次 30 分钟：即使今天是事件日也不补（防抖）')

// 距上次 2 天、今天有事件（约了事）→ 今天必补
const eventToday = advanceTimeline(
  { posts: first.state.posts, lastVisit: now - 2 * DAY, used: first.state.used },
  vars,
  now,
  new Set([dayKeyOf(now)]),
  seeded(10),
)
const todayCreated = eventToday.state.posts.filter((p) => dayKeyOf(p.at) === dayKeyOf(now))
ok(todayCreated.length >= 1, '事件日（今天约了事）今天必补至少 1 条')
ok(todayCreated.length <= 2, '今天不超过 2 条')

console.log('\n[7] 上限 20 条，超出丢最旧')
let state = { posts: [], lastVisit: null, used: {} }
let dayNow = now
state = advanceTimeline(state, vars, dayNow, new Set(), seeded(11)).state
// 每天推一天，每次隔一天打开补 2 条，把列表铺到上限附近
while (state.posts.length < MAX_POSTS - 1) {
  dayNow += DAY
  state = advanceTimeline(
    { posts: state.posts, lastVisit: dayNow - DAY - MINUTE, used: state.used },
    vars,
    dayNow,
    new Set([dayKeyOf(dayNow)]),
    seeded(20 + state.posts.length),
  ).state
}
eq(state.posts.length, MAX_POSTS - 1, `先铺到 ${MAX_POSTS - 1} 条`)
const overflow = advanceTimeline(
  { posts: state.posts, lastVisit: dayNow - DAY, used: state.used },
  vars,
  dayNow + DAY,
  new Set([dayKeyOf(dayNow + DAY)]),
  seeded(99),
)
eq(overflow.state.posts.length, MAX_POSTS, '超上限后被裁回 20 条')

console.log('\n[8] 模板 30 天不重复')
const kind = '日常'
const used = {}
for (let i = 0; i < TEMPLATES[kind].length; i++) {
  used[`${kind}:${i}`] = i === 2 ? now - 31 * DAY : now - 1 * DAY
}
const idx = pickTemplateIndex(kind, used, now, seeded(3))
eq(idx, 2, '近 30 天用过的索引被跳过，选中 31 天前的 2')

const usedAll = {}
for (let i = 0; i < TEMPLATES[kind].length; i++) usedAll[`${kind}:${i}`] = now - 1 * DAY
const fallback = pickTemplateIndex(kind, usedAll, now, seeded(4))
ok(fallback >= 0 && fallback < TEMPLATES[kind].length, '全部近 30 天用过时兜底仍能选到索引')

function findTemplateIndex(kindName, text, vars2) {
  const list = TEMPLATES[kindName] || []
  for (let i = 0; i < list.length; i++) {
    if (buildPostText(kindName, i, vars2) === text) return i
  }
  return -1
}

const batch1 = advanceTimeline(
  { posts: [], lastVisit: now - 2 * DAY, used: {} },
  vars,
  now,
  new Set([dayKeyOf(now), dayKeyOf(now - DAY)]),
  seeded(21),
)
ok(batch1.created >= 1, '第一批至少补 1 条')
ok(new Set(batch1.state.posts.map((p) => p.text)).size === batch1.state.posts.length, '同一次批量生成的文案不重复')

const nextDay = new Date(2026, 7, 23, 12, 0).getTime()
const batch2 = advanceTimeline(
  { posts: batch1.state.posts, lastVisit: now - 2 * DAY, used: batch1.state.used },
  vars,
  nextDay,
  new Set([dayKeyOf(nextDay)]),
  seeded(22),
)
ok(batch2.created >= 1, '第二批至少补 1 条')
// 跨批不重复：第二批新增的动态文案不能和第一批撞（模板 30 天去重的近似验证——
// 动态按各自时间戳随机时段/天气填充，无法用固定 vars 反查模板索引，改验文案不撞车）
const batch2New = new Set(batch2.state.posts.slice(0, batch2.created).map((p) => p.text))
const batch1Texts = new Set(batch1.state.posts.map((p) => p.text))
for (const t of batch2New) {
  ok(!batch1Texts.has(t), `第二批文案不与第一批重复：${t.slice(0, 12)}…`)
}

console.log('\n[9] 占位替换')
const built = buildPostText('日常', 0, {
  taName: '小忆',
  yourName: '阿明',
  season: '秋',
  timeWord: '晚上',
  weatherWord: '多云',
})
ok(built.includes('小忆') || built.includes('阿明') || built.includes('秋') || built.includes('晚上') || built.includes('多云'), '占位符被替换')
ok(!built.includes('{'), '替换后不留残留花括号')
const known = ['{taName}', '{yourName}', '{season}', '{timeWord}', '{weatherWord}']
for (const list of Object.values(TEMPLATES)) {
  for (const t of list) {
    const leftover = t.match(/\{[^}]+\}/g) || []
    for (const ph of leftover) ok(known.includes(ph), `占位符 ${ph} 是已知的：${t.slice(0, 16)}…`)
  }
}

console.log('\n[10] 时间常量自洽')
ok(MIN_INTERVAL_MS === 2 * HOUR, '2 小时常量正确')
ok(DAY_INTERVAL_MS === 24 * HOUR, '24 小时常量正确')
ok(MAX_POSTS === 20, '上限为 20')
ok(MAX_BACKFILL_DAYS === 3, '回填窗口 3 天')
ok(BACKFILL_LIFE_CHANCE > 0 && BACKFILL_LIFE_CHANCE < 1, '生活动态概率在 0-1 之间')

console.log('\n[11] 降级回复话术 + 常量')
eq(dayKeyOf(new Date(2026, 7, 22, 23, 59).getTime()), '2026-08-22', 'dayKeyOf 本地日期')
eq(dayKeyOf(new Date(2026, 0, 5, 0, 0).getTime()), '2026-01-05', 'dayKeyOf 补零')

ok(REPLY_FALLBACKS.length >= 3, '降级回复至少 3 条')
const fb = pickReplyFallback(seeded(2))
ok(typeof fb === 'string' && fb.length > 0, 'pickReplyFallback 返回非空')
ok(!REPLY_FALLBACKS.some((r) => /[AI它演干活]/.test(r)), '降级回复无禁用字（AI/它/演/干活）')
ok(!EMOJI_RE.test(fb), '降级回复无 emoji')

console.log('\n[12] pickDayPostHour / dayStartOf')
eq(dayStartOf(new Date(2026, 7, 22, 23, 59).getTime()), new Date(2026, 7, 22, 0, 0).getTime(), 'dayStartOf 取当日 00:00')
const hourTs = pickDayPostHour(todayStart, seeded(13))
const hh = new Date(hourTs).getHours()
ok(hh >= 7 && hh <= 23, `pickDayPostHour 在 7-23 点之间（得 ${hh} 点）`)

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
