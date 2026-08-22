// TA 的空间 · 动态引擎自测
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_aispace.mjs
// 覆盖：首访 3 条 / 隔 2 小时补 1 条 / 隔 24 小时补 2 条 / 上限 20 条 / 模板 30 天不重复 /
//        季节时段天气 / 占位替换 / 文案红线（无「演」字、无 emoji、每类 ≥4 条）

import {
  KIND_KEYS,
  TEMPLATES,
  getSeason,
  getTimeWord,
  pickWeatherWord,
  computeNewCount,
  newPostTimestamps,
  pickTemplateIndex,
  buildPostText,
  advanceTimeline,
  MAX_POSTS,
  MIN_INTERVAL_MS,
  DAY_INTERVAL_MS,
  THIRTY_DAYS,
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

const now = Date.now()

console.log('\n[1] 模板库完整性')
ok(KIND_KEYS.length >= 6, '至少有 6 个 kind')
for (const kind of KIND_KEYS) {
  const list = TEMPLATES[kind] || []
  ok(list.length >= 4, `${kind} 类模板 ${list.length} 条（≥4）`)
  for (const t of list) {
    ok(!t.includes('演'), `${kind} 模板无「演」字：${t.slice(0, 14)}…`)
    ok(!/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(t), `${kind} 模板无 emoji：${t.slice(0, 14)}…`)
  }
}

console.log('\n[2] 季节 / 时段 / 天气')
eq(getSeason(new Date(2026, 2, 15).getTime()), '春', '3 月是春')
eq(getSeason(new Date(2026, 5, 15).getTime()), '夏', '6 月是夏')
eq(getSeason(new Date(2026, 8, 15).getTime()), '秋', '9 月是秋')
eq(getSeason(new Date(2026, 11, 15).getTime()), '冬', '12 月是冬')
eq(getTimeWord(new Date(2026, 0, 1, 8).getTime()), '早上', '8 点早上')
eq(getTimeWord(new Date(2026, 0, 1, 12).getTime()), '午后', '12 点午后')
eq(getTimeWord(new Date(2026, 0, 1, 16).getTime()), '傍晚', '16 点傍晚')
eq(getTimeWord(new Date(2026, 0, 1, 22).getTime()), '夜里', '22 点夜里')
const w = pickWeatherWord(seeded(1))
ok(['晴', '雨', '阴', '多云'].includes(w), `天气词合法（得 ${w}）`)

console.log('\n[3] 时间轴推进条数')
eq(computeNewCount(null, now), 3, '首访补 3 条')
eq(computeNewCount(now - 1 * HOUR, now), 0, '不到 2 小时不补')
eq(computeNewCount(now - 2 * HOUR, now), 1, '正好 2 小时补 1 条')
eq(computeNewCount(now - 10 * HOUR, now), 1, '2~24 小时之间补 1 条')
eq(computeNewCount(now - 24 * HOUR, now), 2, '正好 24 小时补 2 条')
eq(computeNewCount(now - 3 * DAY, now), 2, '超过 24 小时也补 2 条')
eq(computeNewCount(now + 1000, now), 0, '时间倒挂不补')

console.log('\n[4] 首访预生成时间戳')
const firstTs = newPostTimestamps(3, now, true)
eq(firstTs, [now - 40 * MINUTE, now - 3 * HOUR, now - 7 * HOUR], '首访三段时间偏移')

console.log('\n[5] advanceTimeline 首访生成 3 条，最新在前')
const vars = { taName: 'TA', yourName: '小七', season: '夏', timeWord: '午后', weatherWord: '晴' }
const first = advanceTimeline({ posts: [], lastVisit: null, used: {} }, vars, now, seeded(7))
eq(first.created, 3, '首访创建 3 条')
eq(first.state.posts.length, 3, '首访后共 3 条')
ok(first.state.posts[0].at > first.state.posts[1].at && first.state.posts[1].at > first.state.posts[2].at, '按时间倒序（最新在前）')
eq(first.state.lastVisit, now, 'lastVisit 更新为本次时间')
ok(Number.isFinite(first.state.posts[0].at), '时间戳都是数字')

console.log('\n[6] 隔 2 小时补 1 条，隔 24 小时补 2 条')
const twoH = advanceTimeline(
  { posts: first.state.posts, lastVisit: now - 2 * HOUR, used: first.state.used },
  vars,
  now,
  seeded(8),
)
eq(twoH.created, 1, '隔 2 小时补 1 条')
eq(twoH.state.posts.length, 4, '补 1 条后共 4 条')
ok(twoH.state.posts[0].at > first.state.posts[0].at, '新动态排在最前')

const noNew = advanceTimeline(
  { posts: twoH.state.posts, lastVisit: now - 30 * MINUTE, used: twoH.state.used },
  vars,
  now,
  seeded(9),
)
eq(noNew.created, 0, '不足 2 小时不补')

const day = advanceTimeline(
  { posts: twoH.state.posts, lastVisit: now - 25 * HOUR, used: twoH.state.used },
  vars,
  now,
  seeded(10),
)
eq(day.created, 2, '隔 24 小时以上补 2 条')
eq(day.state.posts.length, 6, '补 2 条后共 6 条')

console.log('\n[7] 上限 20 条，超出丢最旧')
let state = { posts: [], lastVisit: null, used: {} }
let n = 0
// 先首访 + 反复模拟隔天打开，把列表撑到上限附近
state = advanceTimeline(state, vars, now, seeded(11)).state
while (state.posts.length < MAX_POSTS - 1) {
  state = advanceTimeline(
    { posts: state.posts, lastVisit: now - 2 * DAY, used: state.used },
    vars,
    now + n++,
    seeded(n),
  ).state
}
eq(state.posts.length, MAX_POSTS - 1, `先铺到 ${MAX_POSTS - 1} 条`)
const overflow = advanceTimeline(
  { posts: state.posts, lastVisit: now - 2 * DAY, used: state.used },
  vars,
  now,
  seeded(99),
)
eq(overflow.state.posts.length, MAX_POSTS, '超上限后被裁回 20 条')

console.log('\n[8] 模板 30 天不重复')
const kind = '日常'
const used = {}
// 除索引 2（31 天前用过）外，其余索引最近都刚用过
for (let i = 0; i < TEMPLATES[kind].length; i++) {
  used[`${kind}:${i}`] = i === 2 ? now - 31 * DAY : now - 1 * DAY
}
const idx = pickTemplateIndex(kind, used, now, seeded(3))
eq(idx, 2, '近 30 天用过的索引被跳过，选中 31 天前的 2')

const usedAll = {}
for (let i = 0; i < TEMPLATES[kind].length; i++) usedAll[`${kind}:${i}`] = now - 1 * DAY
const fallback = pickTemplateIndex(kind, usedAll, now, seeded(4))
ok(fallback >= 0 && fallback < TEMPLATES[kind].length, '全部近 30 天用过时兜底仍能选到索引')

// 用反向查找：由填好后的文案找出它用的模板索引，再核对 used 记录
function findTemplateIndex(kindName, text, vars) {
  const list = TEMPLATES[kindName] || []
  for (let i = 0; i < list.length; i++) {
    if (buildPostText(kindName, i, vars) === text) return i
  }
  return -1
}

// 第一批：隔 2 天打开，生成 2 条并记入 used；第二批隔 2 天再打开，不应复用近 30 天用过的模板
const batch1 = advanceTimeline(
  { posts: [], lastVisit: now - 2 * DAY, used: {} },
  vars,
  now,
  seeded(21),
)
eq(batch1.created, 2, '第一批补 2 条')
ok(new Set(batch1.state.posts.map((p) => p.text)).size === batch1.state.posts.length, '同一次批量生成的文案不重复')

const batch2 = advanceTimeline(
  { posts: batch1.state.posts, lastVisit: now - 2 * DAY, used: batch1.state.used },
  vars,
  now + 1000,
  seeded(22),
)
eq(batch2.created, 2, '第二批补 2 条')
// 只检查第二批新增的前 N 条（state 里可能还带着第一批的旧动态）
for (const p of batch2.state.posts.slice(0, batch2.created)) {
  const ti = findTemplateIndex(p.kind, p.text, vars)
  ok(ti >= 0, `${p.kind} 的文案能反查出模板索引`)
  if (ti >= 0) {
    const last = batch1.state.used[`${p.kind}:${ti}`]
    ok(last == null || now - last >= THIRTY_DAYS, `${p.kind} 未用近 30 天模板：${p.text.slice(0, 12)}…`)
  }
}

console.log('\n[9] 占位替换')
const built = buildPostText('日常', 0, {
  taName: '小忆',
  yourName: '阿明',
  season: '秋',
  timeWord: '傍晚',
  weatherWord: '多云',
})
ok(built.includes('小忆') || built.includes('阿明') || built.includes('秋') || built.includes('傍晚') || built.includes('多云'), '占位符被替换')
ok(!built.includes('{'), '替换后不留残留花括号')
// 全库扫描：模板里出现的占位符必须都在已知集合里
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

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
