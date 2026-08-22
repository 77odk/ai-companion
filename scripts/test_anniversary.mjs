// 纪念日（记忆页「重要的日子」卡片）纯逻辑自测
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_anniversary.mjs
// 覆盖：load 空/损坏 / add 新条目最前且不改输入 / update / remove /
//        buildDefaultAnniversary 生成 / getDefaultAnniversary 首次生成且删光不复活 /
//        daysUntil 今天/明天/还剩/已过/非法 / 日期格式化 / isValid 校验 / buildAnniversaryBlock 注入段

import {
  loadAnniversaries,
  saveAnniversaries,
  addAnniversary,
  updateAnniversary,
  removeAnniversary,
  buildDefaultAnniversary,
  getDefaultAnniversary,
  daysUntil,
  formatAnniversaryDate,
  isValidAnniversaryDate,
} from '../src/lib/anniversary.ts'
import { buildAnniversaryBlock } from '../src/lib/api.ts'

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

// 简易 localStorage mock（Node 无 localStorage；anniversary 的广播在无 window 时静默跳过）
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

// 固定一个「今天」：2026-08-23（各倒计时/日期测试的基准）
const now = new Date(2026, 7, 23, 12, 0).getTime()

console.log('\n[1] loadAnniversaries 空 / 损坏 / 非法条目')
resetStore()
eq(loadAnniversaries(), [], '无数据 → 空数组')
localStorage.setItem('ai_companion_anniversaries', 'not-json')
eq(loadAnniversaries(), [], '损坏 JSON → 空数组')
localStorage.setItem('ai_companion_anniversaries', JSON.stringify([{ id: 'a' }, null, 42]))
eq(loadAnniversaries(), [], '字段非法条目被过滤')
localStorage.setItem(
  'ai_companion_anniversaries',
  JSON.stringify([{ id: 'a', label: '认识纪念日', date: '08-22', createdAt: 1 }]),
)
const loaded = loadAnniversaries()
eq(loaded.length, 1, '合法条目能读出来')
eq(loaded[0].label, '认识纪念日', '读出的 label 正确')

console.log('\n[2] addAnniversary 新条目放最前，不改输入数组')
resetStore()
const before = loadAnniversaries()
const after = addAnniversary('在一起纪念日', '08-22')
eq(after.length, 1, '新增后共 1 条')
eq(after[0].label, '在一起纪念日', '第一条是新加的')
eq(after[0].date, '08-22', '日期是 MM-DD')
ok(after !== before, '返回新数组，不改输入数组')
const after2 = addAnniversary('生日', '03-15')
eq(after2.length, 2, '新增后共 2 条')
eq(after2[0].label, '生日', '后加的排在最前')
eq(after2[1].label, '在一起纪念日', '先加的排后面')
eq(loadAnniversaries().length, 2, '已持久化到 localStorage')
eq(addAnniversary('', '08-22').length, 2, '空名称不新增（列表不变）')
eq(addAnniversary('生日', 'xx-xx').length, 2, '非法日期不新增（列表不变）')

console.log('\n[3] updateAnniversary 改名/改日期')
resetStore()
saveAnniversaries([{ id: 'a1', label: '认识纪念日', date: '08-22', createdAt: 1 }])
const up = updateAnniversary('a1', '在一起的纪念日', '09-01')
eq(up.length, 1, '更新后仍 1 条')
eq(up[0].label, '在一起的纪念日', '名称已更新')
eq(up[0].date, '09-01', '日期已更新')
eq(loadAnniversaries()[0].label, '在一起的纪念日', '已持久化')
const upMissing = updateAnniversary('nope', '生日', '03-15')
eq(upMissing, [{ id: 'a1', label: '在一起的纪念日', date: '09-01', createdAt: 1 }], '不存在的 id 原样返回')
const upBad = updateAnniversary('a1', '生日', 'xx')
eq(upBad[0].date, '09-01', '非法日期不更新')

console.log('\n[4] removeAnniversary 删除')
resetStore()
saveAnniversaries([
  { id: 'a1', label: '认识纪念日', date: '08-22', createdAt: 1 },
  { id: 'a2', label: '生日', date: '03-15', createdAt: 2 },
])
const rm = removeAnniversary('a1')
eq(rm.length, 1, '删除后剩 1 条')
eq(rm[0].id, 'a2', '剩下的是没删的那条')
eq(loadAnniversaries().length, 1, '已持久化')
eq(removeAnniversary('nope').length, 1, '不存在的 id 原样返回')

console.log('\n[5] buildDefaultAnniversary 纯函数生成默认「认识纪念日」')
const firstSeen = new Date(2026, 7, 22, 10, 0).getTime() // 2026-08-22
const def = buildDefaultAnniversary(firstSeen, now)
eq(def.label, '认识纪念日', '名称是「认识纪念日」')
eq(def.date, '08-22', 'date 取 firstSeen 的 MM-DD')
eq(def.id, `default-08-22-${firstSeen}`, 'id 稳定可复现')
eq(def.createdAt, now, 'createdAt 是生成时刻')

console.log('\n[6] getDefaultAnniversary 首次生成并保存，之后不再重复')
resetStore()
const g1 = getDefaultAnniversary()
ok(g1 != null, '首次（无任何纪念日）生成默认')
eq(g1.label, '认识纪念日', '默认名称是「认识纪念日」')
const todayMM = String(new Date().getMonth() + 1).padStart(2, '0')
const todayDD = String(new Date().getDate()).padStart(2, '0')
eq(g1.date, `${todayMM}-${todayDD}`, 'date 取今天（getFirstSeen 兜底当前时间）的 MM-DD')
eq(loadAnniversaries().length, 1, '默认已保存进 localStorage')
eq(getDefaultAnniversary(), null, '已有数据时不再生成')
removeAnniversary(g1.id)
eq(loadAnniversaries().length, 0, '删光后 localStorage 为空')
eq(getDefaultAnniversary(), null, '用户删光后不自动复活默认')

console.log('\n[7] daysUntil 倒计时')
eq(daysUntil('08-23', now), '今天', '今天 → 今天')
eq(daysUntil('08-24', now), '明天', '明天 → 明天')
eq(daysUntil('08-30', now), '还剩 7 天', '还有 7 天 → 还剩 7 天')
eq(daysUntil('08-20', now), '已过 3 天', '今年已过 3 天 → 已过 3 天')
eq(daysUntil('2026-08-22', now), '已过 1 天', '一次性日期昨天 → 已过 1 天')
eq(daysUntil('2026-12-25', now), '还剩 124 天', '一次性未来日期 → 还剩 124 天')
eq(daysUntil('2027-05-01', now), '还剩 251 天', '跨年一次性未来日期 → 还剩 251 天')
eq(daysUntil('08-99', now), '', '非法日期 → 空串')

console.log('\n[8] formatAnniversaryDate 日期格式化')
eq(formatAnniversaryDate('08-22'), '8月22日', 'MM-DD → 8月22日（每年循环不去年份）')
eq(formatAnniversaryDate('2026-08-22'), '2026年8月22日', 'YYYY-MM-DD → 带完整年')
eq(formatAnniversaryDate(''), '', '空串 → 空串')
eq(formatAnniversaryDate('xx'), '', '非法 → 空串')

console.log('\n[9] isValidAnniversaryDate 校验')
ok(isValidAnniversaryDate('08-22'), 'MM-DD 合法')
ok(isValidAnniversaryDate('8-2'), '个位月/日也合法')
ok(isValidAnniversaryDate('2026-08-22'), 'YYYY-MM-DD 合法')
ok(!isValidAnniversaryDate('08-32'), '不存在 32 日 → 非法')
ok(!isValidAnniversaryDate('13-01'), '不存在 13 月 → 非法')
ok(!isValidAnniversaryDate('2026-08-22 12:00'), '带时间 → 非法')

console.log('\n[10] buildAnniversaryBlock 注入段')
eq(buildAnniversaryBlock([]), '', '无纪念日 → 空串')
eq(
  buildAnniversaryBlock([
    { id: 'a1', label: '认识纪念日', date: '08-22', createdAt: 1 },
    { id: 'a2', label: '生日', date: '03-15', createdAt: 2 },
  ]),
  '【你们的重要日子】认识纪念日：08-22，生日：03-15。这些日子对你们很重要，到了日子要记得。',
  '多条 → 按「名称：日期」用逗号连接'
)
eq(buildAnniversaryBlock([null, { id: 'x', label: '生日', date: '03-15', createdAt: 1 }]), '【你们的重要日子】生日：03-15。这些日子对你们很重要，到了日子要记得。', '非法条目被过滤')
eq(buildAnniversaryBlock([{ id: 'a', label: '  认识纪念日  ', date: ' 08-22 ', createdAt: 1 }]), '【你们的重要日子】认识纪念日：08-22。这些日子对你们很重要，到了日子要记得。', '名称/日期 trim 后再拼')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
