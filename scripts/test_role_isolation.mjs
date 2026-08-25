// 忆文数据隔离（TASK-UI2）纯逻辑自测
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_role_isolation.mjs
// 覆盖：纪念日/周记/TA 的生活 按会话分 key 读写 + 角色切换互不可见 + 无会话回落全局 +
//       老全局数据首次按会话读取迁到第一个会话 + 组合读取（全局记忆共享、当前会话私有、绝不串读）

import {
  getAnniversaries,
  loadAnniversaries,
  addAnniversary,
  collectAllAnniversaries,
} from '../src/lib/anniversary.ts'
import { getWeeklyReviews, saveWeeklyReviews } from '../src/lib/weeklyReview.ts'
import { refreshSpace, loadCurrentPosts, collectAllSpacePosts } from '../src/lib/aiSpace.ts'
import {
  getDefaultSessionId,
  getSessionsCache,
  recallSessionMemories,
  saveMemoriesCache,
  setSessionsCache,
} from '../src/lib/sessionStore.ts'

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

// 简易 localStorage mock（Node 无 localStorage；各模块在无 window 时静默跳过广播）
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

/** 两个会话：100（默认角色，迁移目标）、200（另一个角色） */
function seedTwoSessions() {
  setSessionsCache([
    { id: 100, title: '阿叙', persona: '' },
    { id: 200, title: '阿温', persona: '' },
  ])
}

console.log('\n[1] getDefaultSessionId：无会话 / 有会话取第一个')
resetStore()
eq(getDefaultSessionId(), '', '无会话 → 空串')
seedTwoSessions()
eq(getDefaultSessionId(), '100', '有会话 → 第一个会话 id 字符串')
eq(getSessionsCache().length, 2, '会话缓存可读')

console.log('\n[2] 纪念日 会话隔离：couple 进会话 key、personal 进全局 key')
resetStore()
seedTwoSessions()
addAnniversary('在一起纪念日', '09-01', { kind: 'couple' }, '100')
ok(store.has('ai_companion_anniversaries_100'), '双人纪念日写进会话 key')
ok(!store.has('ai_companion_anniversaries'), '双人纪念日不写全局 key')
addAnniversary('我的生日', '03-15', { kind: 'personal' }, '100')
ok(store.has('ai_companion_anniversaries'), '个人节日写进全局 key')
const both = getAnniversaries('100')
eq(both.some((a) => a.label === '在一起纪念日'), true, '会话读取 = 个人 + 当前角色双人（双人在）')
eq(both.some((a) => a.label === '我的生日'), true, '会话读取 = 个人 + 当前角色双人（个人在）')

console.log('\n[3] 纪念日 角色切换：会话 A 的双人读不到会话 B，个人所有角色共享')
const viewB = getAnniversaries('200')
eq(viewB.some((a) => a.label === '在一起纪念日'), false, '会话 B 读不到会话 A 的双人纪念日')
eq(viewB.some((a) => a.label === '我的生日'), true, '会话 B 能看到个人节日（全局共享）')

console.log('\n[4] 纪念日 无会话回落：getAnniversaries()/loadAnniversaries() 只读全局')
resetStore()
localStorage.setItem('ai_companion_anniversaries', JSON.stringify([{ id: 'g1', label: '认识纪念日', date: '08-22', createdAt: 1 }]))
eq(loadAnniversaries().length, 1, '无会话 loadAnniversaries 读全局')
eq(getAnniversaries().length, 1, '无会话 getAnniversaries 读全局')
eq(getAnniversaries('').length, 1, '空串 sessionId 也回落全局')
eq(collectAllAnniversaries().length, 1, '同步汇总含全局数据')

console.log('\n[5] 纪念日 老全局迁移：首次按会话读取迁到第一个会话 + 打标记 + 清全局')
resetStore()
seedTwoSessions()
localStorage.setItem(
  'ai_companion_anniversaries',
  JSON.stringify([{ id: 'old1', label: '在一起的纪念日', date: '09-01', createdAt: 5 }]),
)
const migrated = getAnniversaries('100')
eq(migrated.some((a) => a.id === 'old1'), true, '默认角色能读到迁移过来的老数据')
eq(JSON.parse(store.get('ai_companion_anniversaries') ?? '[]').length, 0, '老全局双人迁走，全局只剩个人节日（本例无 → 空数组）')
eq(store.get('ai_companion_anniv_migrated'), '1', '迁移标记已打，防重复迁移')
eq(getAnniversaries('200').some((a) => a.id === 'old1'), false, '迁移只落到默认角色，其他角色不串读')
const after = getAnniversaries('100')
eq(after.filter((a) => a.id === 'old1').length, 1, '重复按会话读取不重复迁移（幂等）')

console.log('\n[6] 纪念日 迁移时 personal 留在全局、couple 进默认角色')
resetStore()
seedTwoSessions()
localStorage.setItem(
  'ai_companion_anniversaries',
  JSON.stringify([
    { id: 'p1', label: '我的生日', date: '03-15', createdAt: 3, kind: 'personal' },
    { id: 'c1', label: '在一起', date: '09-01', createdAt: 2 },
  ]),
)
const v100 = getAnniversaries('100')
eq(v100.some((a) => a.id === 'p1'), true, '默认角色读到个人节日')
eq(v100.some((a) => a.id === 'c1'), true, '默认角色读到迁移的双人节日')
const globalLeft = JSON.parse(store.get('ai_companion_anniversaries') ?? '[]')
eq(globalLeft.some((a) => a.id === 'p1'), true, '个人节日留在全局')
eq(globalLeft.some((a) => a.id === 'c1'), false, '双人节日已从全局挪走')
const v200 = getAnniversaries('200')
eq(v200.some((a) => a.id === 'p1'), true, '其他角色仍共享个人节日')
eq(v200.some((a) => a.id === 'c1'), false, '其他角色读不到默认角色的双人')

console.log('\n[7] 周记 会话读写 + 角色隔离 + 无会话回落')
resetStore()
seedTwoSessions()
const wr = [{ id: 'w1', weekLabel: '第 1 周 · 8月1日-8月7日', title: '开头', content: '这一周', createdAt: 1 }]
saveWeeklyReviews(wr, '100')
ok(store.has('ai_companion_weekly_reviews_100'), '周记写进会话 key')
ok(!store.has('ai_companion_weekly_reviews'), '周记不写全局 key')
eq(getWeeklyReviews('100').length, 1, '会话 100 读到自己的周记')
eq(getWeeklyReviews('200').length, 0, '会话 200 读不到会话 100 的周记')
localStorage.setItem('ai_companion_weekly_reviews', JSON.stringify([{ ...wr[0], id: 'g-w', createdAt: 2 }]))
eq(getWeeklyReviews().length, 1, '无会话 getWeeklyReviews 读全局')

console.log('\n[8] 周记 老全局迁移：首次按会话读取迁到第一个会话')
resetStore()
seedTwoSessions()
localStorage.setItem(
  'ai_companion_weekly_reviews',
  JSON.stringify([{ id: 'old-w', weekLabel: '第 9 周 · 8月18日-8月24日', title: '旧周记', content: '…', createdAt: 5 }]),
)
eq(getWeeklyReviews('100').length, 1, '默认角色读到迁移过来的老周记')
ok(!store.has('ai_companion_weekly_reviews'), '老全局周记 key 已清空')
eq(store.get('ai_companion_weekly_migrated'), '1', '周记迁移标记已打')
eq(getWeeklyReviews('200').length, 0, '迁移只落到默认角色')

console.log('\n[9] TA 的生活 会话读写 + 角色隔离')
resetStore()
seedTwoSessions()
localStorage.setItem('ai_companion_persona', '') // 空人设 → 模板兜底生成，不走 LLM
const plan100 = refreshSpace('阿叙', '你', new Date(2026, 7, 23, 12).getTime(), '100')
eq(plan100.posts.length > 0, true, '会话 100 刷新生成动态')
ok(store.has('ai_space_posts_100'), '动态写进会话 key')
eq(loadCurrentPosts('100').length, plan100.posts.length, '会话 100 能读回自己的动态')
eq(loadCurrentPosts('200').length, 0, '会话 200 读不到会话 100 的动态')
localStorage.setItem('ai_space_posts', JSON.stringify([{ ...plan100.posts[0], id: 'g-post', at: 1 }]))
eq(loadCurrentPosts().length, 1, '无会话 loadCurrentPosts 读全局')

console.log('\n[10] TA 的生活 老全局迁移：posts + lastVisit + used 迁到第一个会话')
resetStore()
seedTwoSessions()
localStorage.setItem('ai_space_posts', JSON.stringify([{ id: 'old-p', at: 5, kind: '日常', text: '旧动态', art: 0 }]))
localStorage.setItem('ai_space_last_visit', '123')
localStorage.setItem('ai_space_used_templates', '{"tpl-a": 123}')
eq(loadCurrentPosts('100').some((p) => p.id === 'old-p'), true, '默认角色读到迁移过来的老动态')
ok(!store.has('ai_space_posts'), '老全局动态 key 已清空')
eq(store.get('ai_space_migrated'), '1', '动态迁移标记已打')
eq(loadCurrentPosts('200').length, 0, '迁移只落到默认角色')
eq(store.get('ai_space_last_visit_100'), '123', 'lastVisit 跟着迁到默认角色')
eq(store.get('ai_space_used_templates_100'), '{"tpl-a": 123}', 'used 模板跟着迁到默认角色')
eq(collectAllSpacePosts().some((p) => p.id === 'old-p'), true, '同步汇总含迁移后的动态')

console.log('\n[11] 组合读取：全局记忆共享、当前会话私有、绝不串读')
resetStore()
setSessionsCache([
  { id: 7, title: '阿叙', persona: '' },
  { id: 8, title: '阿温', persona: '' },
])
localStorage.setItem('ai_companion_memory', JSON.stringify([{ id: 'g1', text: '对方不爱吃香菜', createdAt: 1, topic: '饮食' }]))
saveMemoriesCache('7', [{ id: 's7', text: '对方喜欢猫', createdAt: 2, topic: '宠物' }])
saveMemoriesCache('8', [{ id: 's8', text: '对方在公司加班', createdAt: 3, topic: '工作' }])
// 语境同时命中 饮食/宠物/工作 三个主题：全局记忆 + 各自会话记忆都能召回，串读与否才看得清
const r7 = recallSessionMemories('7', '猫吃辣加班吗', { now: 1000 })
eq(r7.some((m) => m.id === 's7'), true, '会话 7 召回自己的记忆')
eq(r7.some((m) => m.id === 's8'), false, '会话 7 绝不读会话 8 的记忆')
eq(r7.some((m) => m.id === 'g1'), true, '会话 7 共享全局记忆')
const r8 = recallSessionMemories('8', '猫吃辣加班吗', { now: 1000 })
eq(r8.some((m) => m.id === 's8'), true, '会话 8 召回自己的记忆')
eq(r8.some((m) => m.id === 's7'), false, '会话 8 绝不读会话 7 的记忆')
eq(r8.some((m) => m.id === 'g1'), true, '会话 8 共享全局记忆')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) throw new Error(`${failed} 个用例失败`)
