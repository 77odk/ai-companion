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
  buildMilestoneAnniversary,
  getDefaultAnniversary,
  nextMilestoneDay,
  isMilestoneAnniversary,
  getAnniversaries,
  daysUntil,
  formatAnniversaryDate,
  isValidAnniversaryDate,
  formatCountdown,
  getMainAnniversaryId,
  setMainAnniversaryId,
  resolveMainAnniversary,
  purgeLegacyMilestones,
  getAnniversariesForPrompt,
  normalizePeriodHistory,
  startPeriod,
  endPeriod,
  getCurrentPeriod,
  updateCurrentPeriodStart,
  localPeriodDate,
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
  key: (i) => [...store.keys()][i] ?? null,
  get length() {
    return store.size
  },
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

console.log('\n[5] buildDefaultAnniversary 纯函数生成默认「认识 TA 的日子」')
const firstSeen = new Date(2026, 7, 22, 10, 0).getTime() // 2026-08-22
const def = buildDefaultAnniversary(firstSeen, now)
eq(def.label, '认识 TA 的日子', '名称是「认识 TA 的日子」')
eq(def.date, '08-22', 'date 取 firstSeen 的 MM-DD')
eq(def.id, `default-08-22-${firstSeen}`, 'id 稳定可复现')
eq(def.createdAt, now, 'createdAt 是生成时刻')

console.log('\n[6] getDefaultAnniversary 首次生成并保存，之后不再重复')
resetStore()
const g1 = getDefaultAnniversary()
ok(g1 != null, '首次（无任何纪念日）生成默认')
eq(g1.label, '认识 TA 的日子', '默认名称是「认识 TA 的日子」')
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

console.log('\n[11] formatCountdown 正计时（forward）')
const fwdBase = { id: 'a1', label: '认识纪念日', date: '08-22', createdAt: 1 }
eq(formatCountdown({ ...fwdBase, date: '08-22' }, now), '已经 1 天', 'MM-DD 今年已过 → 已经 1 天')
eq(formatCountdown({ ...fwdBase, date: '08-24' }, now), '已经 364 天', 'MM-DD 今年还没到 → 按去年那次算（已过则跨年）')
eq(formatCountdown({ ...fwdBase, date: '08-23' }, now), '就是今天', 'MM-DD 今天 → 就是今天')
eq(formatCountdown({ ...fwdBase, date: '2026-08-20' }, now), '已经 3 天', 'YYYY-MM-DD 绝对日期过去 → 已经 3 天')
eq(formatCountdown({ ...fwdBase, date: '2026-08-25' }, now), '还剩 2 天', 'YYYY-MM-DD 未来 → 兜底显示还剩 2 天')
eq(formatCountdown({ ...fwdBase, date: '08-99' }, now), '', '非法日期 → 空串')

console.log('\n[12] formatCountdown 倒计时（countdown）')
eq(formatCountdown({ ...fwdBase, date: '08-30', countMode: 'countdown' }, now), '还剩 7 天', 'MM-DD 还有 7 天 → 还剩 7 天')
eq(formatCountdown({ ...fwdBase, date: '08-24', countMode: 'countdown' }, now), '还剩 1 天', '明天 → 还剩 1 天')
eq(formatCountdown({ ...fwdBase, date: '08-23', countMode: 'countdown' }, now), '就是今天', '今天 → 就是今天')
eq(formatCountdown({ ...fwdBase, date: '08-20', countMode: 'countdown' }, now), '还剩 362 天', 'MM-DD 已过 → 顺延到明年还剩 362 天')
eq(formatCountdown({ ...fwdBase, date: '2026-12-25', countMode: 'countdown' }, now), '还剩 124 天', 'YYYY-MM-DD 未来 → 还剩 124 天')
eq(formatCountdown({ ...fwdBase, date: '2026-08-22', countMode: 'countdown' }, now), '还剩 364 天', 'YYYY-MM-DD 已过（生日带年份）→ 顺延明年还剩 364 天')
eq(formatCountdown({ ...fwdBase, date: '2001-08-05', countMode: 'countdown' }, now), '还剩 347 天', '多年份生日 2001-08-05 → 顺延明年 8/5 还剩 347 天')

console.log('\n[13] formatCountdown 缺省 countMode = forward（兼容旧数据）')
eq(formatCountdown({ ...fwdBase, date: '08-20' }, now), '已经 3 天', '无 countMode → 按正计时显示已经 3 天')
eq(formatCountdown({ ...fwdBase, date: '08-23' }, now), '就是今天', '无 countMode 今天 → 就是今天')

console.log('\n[14] getMainAnniversaryId / setMainAnniversaryId 主展示读写')
resetStore()
eq(getMainAnniversaryId(), null, '默认 null')
setMainAnniversaryId('ann-1')
eq(getMainAnniversaryId(), 'ann-1', '写入后能读回')
setMainAnniversaryId('')
eq(getMainAnniversaryId(), null, '传空串清除 → null')
setMainAnniversaryId('ann-2')
setMainAnniversaryId(null)
eq(getMainAnniversaryId(), null, '传 null 清除 → null')

console.log('\n[15] resolveMainAnniversary 主展示解析')
resetStore()
eq(resolveMainAnniversary([]), null, '空列表 → null')
const listA = [
  { id: 'a1', label: '认识纪念日', date: '08-22', createdAt: 1 },
  { id: 'a2', label: '生日', date: '03-15', createdAt: 2 },
]
eq(resolveMainAnniversary(listA).id, 'a1', '无主展示 → 默认取列表第一条')
setMainAnniversaryId('a2')
eq(resolveMainAnniversary(listA).id, 'a2', '有主展示 → 用主展示那条')
setMainAnniversaryId('ghost')
eq(resolveMainAnniversary(listA).id, 'a1', '主展示 id 已删除 → 回落到第一条')
setMainAnniversaryId(null)

console.log('\n[16] addAnniversary / updateAnniversary 携带 countMode/color')
resetStore()
const added = addAnniversary('在一起纪念日', '08-22', { countMode: 'countdown', color: 'warm-blue' })
eq(added[0].countMode, 'countdown', 'add 可带倒计时')
eq(added[0].color, 'warm-blue', 'add 可带主题色')
const addedFwd = addAnniversary('认识纪念日', '03-15')
ok(addedFwd[0].countMode == null, 'add 不带 countMode → 缺省 forward（不存字段）')
const updItem = updateAnniversary(added[0].id, '在一起的纪念日', '09-01', {
  countMode: 'forward',
  color: 'warm-pink',
}).find((a) => a.id === added[0].id)
eq(updItem.countMode, undefined, 'update 切回 forward → 清掉 countMode')
eq(updItem.color, 'warm-pink', 'update 可改主题色')
const updKeep = updateAnniversary(addedFwd[0].id, '认识纪念日', '03-16')
eq(updKeep.find((a) => a.id === addedFwd[0].id).date, '03-16', 'update 不带 fields → 只改名/日期，字段原样')

console.log('\n[17] getDefaultAnniversary 只生成一次并落盘（删光不复活）')
resetStore()
eq(localStorage.getItem('ai_companion_anniversaries'), null, '一开始没有 key')
const gd = getDefaultAnniversary()
ok(gd != null, '无 key 时生成默认')
ok(localStorage.getItem('ai_companion_anniversaries') != null, '默认已落盘（key 存在）')
localStorage.setItem('ai_companion_anniversaries', '[]')
eq(getDefaultAnniversary(), null, 'key 存在但空数组（删光）→ 不复活')

console.log('\n[18] 里程碑条目：buildMilestoneAnniversary / nextMilestoneDay / isMilestoneAnniversary')
const msFirst = new Date(2026, 7, 1, 12, 0).getTime() // 2026-08-01 认识
const ms100 = buildMilestoneAnniversary(msFirst, 100, now)
eq(ms100.label, '在一起 100 天', 'label 是「在一起 100 天」')
eq(ms100.date, '2026-11-08', 'date = 认识日 + (100-1) 本地日历日（2026-08-01 + 99 天 = 2026-11-08）')
eq(ms100.milestoneDay, 100, '标 milestoneDay=100')
ok(isMilestoneAnniversary(ms100), '有 milestoneDay → isMilestoneAnniversary 为真')
ok(!isMilestoneAnniversary({ id: 'x', label: '生日', date: '03-15', createdAt: 1 }), '普通条目不是里程碑')
ok(!isMilestoneAnniversary(null), 'null 不是里程碑')
eq(nextMilestoneDay(1), 7, '认识第 1 天 → 下一个里程碑 7')
eq(nextMilestoneDay(7), 7, '认识第 7 天 → 就是 7（当天仍展示）')
eq(nextMilestoneDay(8), 30, '认识第 8 天 → 下一个 30')
eq(nextMilestoneDay(30), 30, '认识第 30 天 → 就是 30')
eq(nextMilestoneDay(31), 100, '认识第 31 天 → 下一个 100')
eq(nextMilestoneDay(730), 730, '认识第 730 天 → 就是 730')
eq(nextMilestoneDay(731), null, '认识第 731 天 → 已超过全部里程碑 → null')
eq(formatCountdown(ms100, now), '还剩 77 天', '未来里程碑正计时兜底显示「还剩 77 天」')
eq(formatCountdown(buildMilestoneAnniversary(msFirst, 100, now), new Date(2026, 10, 8, 12, 0).getTime()), '就是今天', '里程碑当天 → 就是今天')

console.log('\n[19] getAnniversaries(会话) 首次读取只自动补齐「认识 TA 的日子」')
resetStore()
localStorage.setItem('ai_companion_sessions_cache', JSON.stringify([{ id: 100, title: '阳阳', persona: '' }]))
localStorage.setItem('ai_companion_first_seen_100', String(Date.now()))
const roleList = getAnniversaries('100')
eq(roleList.some((a) => a.label === '认识 TA 的日子'), true, '自动补「认识 TA 的日子」')
eq(roleList.some((a) => isMilestoneAnniversary(a)), false, '不自动补里程碑条目')
eq(roleList.some((a) => a.kind === 'personal'), false, '无个人节日时列表不含全局个人数据（空全局）')
const again = getAnniversaries('100')
eq(again.some((a) => isMilestoneAnniversary(a)), false, '重复读取也不生成里程碑')
eq(roleList.length, 1, '默认只有认识日 1 条')

console.log('\n[20] getAnniversaries(会话) 清理旧里程碑及其主展示引用')
resetStore()
localStorage.setItem('ai_companion_anniversaries_200', JSON.stringify([
  { id: 'ordinary', label: '生日', date: '03-15', createdAt: 1 },
  { id: 'old-milestone', label: '在一起 100 天', date: '2026-11-08', createdAt: 2, countMode: 'forward', milestoneDay: 100 },
]))
localStorage.setItem('ai_companion_main_anniversary_200', 'old-milestone')
const cleaned = getAnniversaries('200')
eq(cleaned.map((a) => a.id), ['ordinary'], '读取后删除旧里程碑并保留普通纪念日')
eq(getMainAnniversaryId('200'), null, '主展示指向旧里程碑时清除 stale 引用')
const cleanedAgain = getAnniversaries('200')
eq(cleanedAgain.map((a) => a.id), ['ordinary'], '再次读取不复活里程碑且普通纪念日仍保留')

console.log('\n[21] purgeLegacyMilestones：清全局 + 所有角色 key 里的旧里程碑（别的条目一律不动）')
resetStore()
localStorage.setItem('ai_companion_anniversaries', JSON.stringify([
  { id: 'g-birth', label: '我的生日', date: '08-05', createdAt: 1, kind: 'personal' },
  { id: 'g-couple-old', label: '在一起的纪念日', date: '2026-08-24', createdAt: 2 },
  { id: 'g-milestone', label: '在一起 7 天', date: '2026-09-11', createdAt: 3, countMode: 'forward', milestoneDay: 7 },
]))
localStorage.setItem('ai_companion_main_anniversary', 'g-milestone')
localStorage.setItem('ai_companion_anniversaries_24', JSON.stringify([
  { id: 'r-known', label: '认识 TA 的日子', date: '08-24', createdAt: 4 },
  { id: 'r-milestone', label: '在一起 30 天', date: '2026-10-04', createdAt: 5, countMode: 'forward', milestoneDay: 30 },
]))
localStorage.setItem('ai_companion_main_anniversary_24', 'r-milestone')
eq(purgeLegacyMilestones(), 2, '删掉 2 条里程碑（全局 1 条 + 角色 1 条）')
eq(JSON.parse(localStorage.getItem('ai_companion_anniversaries')).map((a) => a.id), ['g-birth', 'g-couple-old'], '全局：个人节日与手写条目都留着，只掉里程碑')
eq(JSON.parse(localStorage.getItem('ai_companion_anniversaries_24')).map((a) => a.id), ['r-known'], '角色 key：只掉里程碑，认识日留着')
eq(getMainAnniversaryId(), null, '全局主展示指向被删里程碑 → 清掉引用')
eq(getMainAnniversaryId('24'), null, '角色主展示指向被删里程碑 → 清掉引用')
eq(purgeLegacyMilestones(), 0, '再跑一次删 0 条（幂等）')

console.log('\n[22] getAnniversariesForPrompt：全局只喂个人节日，别的角色的数据不再串进注入')
resetStore()
localStorage.setItem('ai_companion_sessions_cache', JSON.stringify([{ id: 300, title: '测试角色', persona: '' }]))
localStorage.setItem('ai_companion_first_seen_300', String(Date.now()))
localStorage.setItem('ai_companion_anniv_migrated', '1')
localStorage.setItem('ai_companion_anniversaries', JSON.stringify([
  { id: 'p-birth', label: '我的生日', date: '08-05', createdAt: 1, kind: 'personal' },
  { id: 'g-legacy-couple', label: '别的角色的纪念日', date: '2026-08-24', createdAt: 2 },
]))
localStorage.setItem('ai_companion_anniversaries_300', JSON.stringify([
  { id: 'own-known', label: '认识 TA 的日子', date: '09-05', createdAt: 3 },
  { id: 'own-milestone', label: '在一起 7 天', date: '2026-09-11', createdAt: 4, countMode: 'forward', milestoneDay: 7 },
]))
const forPrompt = getAnniversariesForPrompt('300')
eq(forPrompt.some((a) => a.id === 'g-legacy-couple'), false, '全局里遗留的双人条目不进注入（不再串给每个角色）')
eq(forPrompt.some((a) => a.id === 'own-milestone'), false, '里程碑残留不下发给 TA')
eq(forPrompt.map((a) => a.id).sort(), ['own-known', 'p-birth'], '个人节日 + 本角色自己的纪念日照常下发')
eq(getAnniversaries('300').some((a) => a.id === 'p-birth'), true, 'UI 读取仍能看到全局个人节日')

console.log('\n[23] Period State Machine：历史 / 当前状态 / 忘记结束自动收口')
const periodNow = new Date(2026, 8, 18, 12, 0).getTime() // 本地 2026-09-18
const legacyPeriod = { id: 'p0', label: '生理期', date: '2026-09-15', createdAt: 1, kind: 'personal', periodDays: 31 }
eq(getCurrentPeriod(legacyPeriod, periodNow), null, '旧数据没有 history → 不推断正在经期')
eq(localPeriodDate(periodNow), '2026-09-18', '当前本地日历日格式稳定')

const started = startPeriod(undefined, '2026-09-17')
eq(started, [{ start: '2026-09-17' }], '第一次开始 → 新增 open history')
eq(getCurrentPeriod({ ...legacyPeriod, periodHistory: started }, periodNow), { start: '2026-09-17', day: 2 }, '第 N 天 = today - start + 1')

const missedEnd = startPeriod([{ start: '2026-08-20' }], '2026-09-17')
eq(missedEnd, [
  { start: '2026-08-20', end: '2026-09-16' },
  { start: '2026-09-17' },
], '上一轮忘记结束 → 新开始时自动补 end=新 start 前一天')

const corrected = updateCurrentPeriodStart(missedEnd, '2026-09-16')
eq(corrected.at(-1), { start: '2026-09-16' }, '进行中 start 可补记为更早日期')
const ended = endPeriod(corrected, '2026-09-18')
eq(ended.at(-1), { start: '2026-09-16', end: '2026-09-18' }, '结束 → 给最后一条 open 补 end')
eq(getCurrentPeriod({ ...legacyPeriod, periodHistory: ended }, periodNow), null, '结束后不再是进行中')

const seven = normalizePeriodHistory([
  { start: '2026-01-01', end: '2026-01-04' },
  { start: '2026-02-01', end: '2026-02-04' },
  { start: '2026-03-01', end: '2026-03-04' },
  { start: '2026-04-01', end: '2026-04-04' },
  { start: '2026-05-01', end: '2026-05-04' },
  { start: '2026-06-01', end: '2026-06-04' },
  { start: '2026-07-01', end: '2026-07-04' },
])
eq(seven.length, 6, 'history 最多保留最近 6 次')
eq(seven[0].start, '2026-02-01', '超过 6 次时丢最早一条')
eq(normalizePeriodHistory([{ start: '2026-09-20' }, { start: '2026-09-01', end: '2026-08-31' }]), [
  { start: '2026-09-01' },
  { start: '2026-09-20' },
], 'history 按 start 升序；end 早于 start 时忽略 end')

console.log('\n[24] Period State Machine：periodHistory 随现有 personal 对象读写，不新增 key')
resetStore()
const pAdded = addAnniversary('生理期', '2026-09-17', {
  kind: 'personal',
  periodDays: 31,
  periodHistory: [{ start: '2026-09-17' }],
})
eq(pAdded[0].periodHistory, [{ start: '2026-09-17' }], 'addAnniversary 可把 history 写进同一 personal 对象')
eq([...store.keys()].filter((key) => key.includes('period')).length, 0, '没有新增 period 专用 storage key')
const pUpdated = updateAnniversary(pAdded[0].id, '生理期', '2026-09-17', {
  kind: 'personal',
  periodDays: 31,
  periodHistory: [{ start: '2026-09-17', end: '2026-09-18' }],
})
eq(pUpdated[0].periodHistory, [{ start: '2026-09-17', end: '2026-09-18' }], 'updateAnniversary 可更新 history 且留在原对象')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
