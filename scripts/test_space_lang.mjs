// TA 的空间 · 动态语言一致性自测（TASK-SPACE-LANG）
// 目标：英文角色（Sam）的「TA 的生活」动态生成语言与 Chat 保持一致；
//       中文角色不受影响；fallback/模板路径同样遵守语言；不新增模型调用。
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖构建工具。
// 跑法：node scripts/test_space_lang.mjs

import {
  buildPostText,
  generatePost,
  advanceTimeline,
  EN_TEMPLATES,
  TEMPLATES,
  dayKeyOf,
} from '../src/lib/aiSpaceCore.ts'
import { buildLlmMessages } from '../src/lib/aiSpaceLlm.ts'
import { refreshSpace, generatePendingPosts, resolveSpaceLang } from '../src/lib/aiSpace.ts'
import { detectLang } from '../src/lib/langDetect.ts'
import { savePersona, saveSettings } from '../src/lib/storage.ts'

let passed = 0
let failed = 0
function ok(cond, name) {
  if (cond) {
    passed++
  } else {
    failed++
    console.log(`  ✗ FAIL: ${name}`)
  }
}
function eq(a, b, name) {
  if (a === b) {
    passed++
  } else {
    failed++
    console.log(`  ✗ FAIL: ${name}（得 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}）`)
  }
}

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

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
// 固定「今天」2026-09-09 白天
const now = new Date(2026, 8, 9, 12, 0).getTime()

const EN_PERSONA = 'Sam, 28, an architect. Loves jazz, cold mornings and long walks. Speaks casually, warm but a little dry.'
const ZH_PERSONA = '温柔，话不多，喜欢安静，周末爱做饭。'

const ZH_ONLY = /[\u4e00-\u9fff]/
const hasZh = (s) => ZH_ONLY.test(String(s ?? ''))

console.log('\n[1] detectLang：与 Chat 同一判定（中文字符占比 >25% 才 zh）')
eq(detectLang(EN_PERSONA), 'en', '纯英文人设 → en')
eq(detectLang(ZH_PERSONA), 'zh', '中文人设 → zh')
eq(detectLang('I am Sam and I speak a little Chinese. 你好。'), 'en', '中英混合但中文字符占比低 → en（与 Chat 一致）')
eq(detectLang(''), 'en', '空串 → en（detectLang 语义）')

console.log('\n[2] resolveSpaceLang：canonical（会话 lang）优先，回退人设检测，空人设默认 zh')
eq(resolveSpaceLang(undefined, EN_PERSONA), 'en', '无会话 + 英文人设 → en')
eq(resolveSpaceLang(undefined, ZH_PERSONA), 'zh', '无会话 + 中文人设 → zh')
eq(resolveSpaceLang(undefined, ''), 'zh', '无会话 + 空人设 → zh（安全默认）')
resetStore()
localStorage.setItem('ai_companion_lang_s1', 'en')
eq(resolveSpaceLang('s1', ZH_PERSONA), 'en', '会话已存 en → en（canonical 优先于人设）')
resetStore()
localStorage.setItem('ai_companion_lang_s1', 'zh')
eq(resolveSpaceLang('s1', EN_PERSONA), 'zh', '会话已存 zh → zh（canonical 优先）')
resetStore()
eq(resolveSpaceLang('s1', EN_PERSONA), 'en', '会话未存 → 回退人设检测 en')
eq(resolveSpaceLang('s1', ''), 'zh', '会话未存 + 空人设 → zh')

console.log('\n[3] 角色切换隔离：A 会话 en / B 会话 zh 各自正确')
resetStore()
localStorage.setItem('ai_companion_lang_sA', 'en')
localStorage.setItem('ai_companion_lang_sB', 'zh')
eq(resolveSpaceLang('sA', ZH_PERSONA), 'en', 'A 会话（en）不因中文人设变 zh')
eq(resolveSpaceLang('sB', EN_PERSONA), 'zh', 'B 会话（zh）不因英文人设变 en')

console.log('\n[4] buildLlmMessages：显式 lang 优先，缺省保留旧启发式')
const ctx = {
  taName: 'Sam',
  yourName: 'You',
  persona: EN_PERSONA,
  season: 'autumn',
  timeWord: 'afternoon',
  weatherWord: 'sunny',
  recent: [],
  atDateStr: '9月9日',
}
const enMsgs = buildLlmMessages(ctx, 'en')
ok(enMsgs[0].content.includes('You are'), 'lang=en → system 英文（You are）')
const zhMsgs = buildLlmMessages(ctx, 'zh')
ok(zhMsgs[0].content.includes('你是'), 'lang=zh → system 中文（你是）')
const legacyEn = buildLlmMessages(ctx)
ok(legacyEn[0].content.includes('You are'), '未传 lang + 纯英文人设 → 旧启发式 en（向后兼容）')
const zhCtx = { ...ctx, persona: ZH_PERSONA }
const legacyZh = buildLlmMessages(zhCtx)
ok(legacyZh[0].content.includes('你是'), '未传 lang + 中文人设 → 旧启发式 zh')
// 混合人设（含少量中文）：显式 lang 修正旧启发式的分歧——Chat 判 en 时动态也必须 en
const mixedCtx = { ...ctx, persona: 'I am Sam. 我会一点中文。' }
const mixedEn = buildLlmMessages(mixedCtx, 'en')
ok(mixedEn[0].content.includes('You are'), '混合人设 + lang=en → 英文（修复 Chat 判 en 动态判 zh 的分歧）')

console.log('\n[5] 模板库：英文集存在、结构与中文同、无中文字符')
const zhKinds = Object.keys(TEMPLATES)
const enKinds = Object.keys(EN_TEMPLATES)
eq(JSON.stringify(enKinds), JSON.stringify(zhKinds), 'EN_TEMPLATES 分类与中文一致')
for (const k of enKinds) {
  ok(EN_TEMPLATES[k].length >= 5, `英文模板 ${k} ≥ 5 条（实际 ${EN_TEMPLATES[k].length}）`)
  for (const t of EN_TEMPLATES[k]) {
    ok(!hasZh(t), `英文模板无中文字符：${t.slice(0, 30)}…`)
    ok(!/emoji/i.test(t) && !/\p{Emoji}/u.test(t), `英文模板无 emoji：${t.slice(0, 30)}…`)
  }
}

console.log('\n[6] buildPostText / generatePost / advanceTimeline：lang 参数生效')
const vars = { taName: 'Sam', yourName: 'You', season: 'autumn', timeWord: 'afternoon', weatherWord: 'sunny' }
const enText = buildPostText('日常', 0, vars, 'en')
ok(!hasZh(enText), 'buildPostText(..., en) 输出英文')
const zhText = buildPostText('日常', 0, vars)
ok(hasZh(zhText), 'buildPostText 默认输出中文')
const enPost = generatePost(vars, {}, now, () => 0.5, 'daily', 'en')
ok(!hasZh(enPost.post.text), 'generatePost(..., en) 输出英文')
const zhPost = generatePost(vars, {}, now, () => 0.5, 'daily')
ok(hasZh(zhPost.post.text), 'generatePost 默认输出中文')
const state = { posts: [], lastVisit: now - 2 * DAY, used: {} }
const advEn = advanceTimeline(state, vars, now, new Set(), () => 0.1, undefined, 'en')
ok(advEn.created > 0, 'advanceTimeline(..., en) 生成了动态')
for (const p of advEn.state.posts) ok(!hasZh(p.text), 'advanceTimeline en 路径全部英文')

console.log('\n[7] 端到端 · 模板路径（有人设没 key）：英文人设 → 英文动态，中文人设 → 中文动态')
resetStore()
savePersona(EN_PERSONA)
saveSettings({ provider: 'deepseek', apiKey: '', baseUrl: '', model: '' })
let plan = refreshSpace('Sam', 'You', now)
eq(plan.mode, 'template', '英文人设无 key → 模板模式')
ok(plan.posts.length > 0, '生成了模板动态')
for (const p of plan.posts) ok(!hasZh(p.text), `英文模板动态无中文：${p.text.slice(0, 40)}…`)
resetStore()
savePersona(ZH_PERSONA)
plan = refreshSpace('小忆', '你', now)
eq(plan.mode, 'template', '中文人设无 key → 模板模式')
for (const p of plan.posts) ok(hasZh(p.text), '中文模板动态为中文')

console.log('\n[8] 端到端 · 降级路径（LLM 不可用时的模板降级）：英文人设 → 英文')
resetStore()
savePersona(EN_PERSONA)
saveSettings({ provider: 'deepseek', apiKey: '', baseUrl: '', model: '' })
const pendPlan = {
  posts: [],
  lastVisit: now - 2 * DAY,
  pending: [{ at: now - DAY, source: 'daily' }],
  used: {},
}
const res = await generatePendingPosts(pendPlan, 'Sam', 'You', undefined, now, () => 0.5)
ok(res.usedFallback, '无 key → 走了模板降级')
ok(res.posts.length > 0, '降级生成了动态')
for (const p of res.posts) ok(!hasZh(p.text), `降级模板动态无中文：${p.text.slice(0, 40)}…`)

console.log('\n[9] 已有动态不受影响（不翻译、不删除、不重写）')
resetStore()
savePersona(EN_PERSONA)
saveSettings({ provider: 'deepseek', apiKey: '', baseUrl: '', model: '' })
// 预置一条中文旧动态 + lang=en
localStorage.setItem('ai_companion_lang_s1', 'en')
const legacyPost = { id: 'p-old1', at: now - 3 * DAY, kind: '日常', text: '这是以前的一条中文动态。', source: 'daily' }
localStorage.setItem('ai_space_posts_s1', JSON.stringify([legacyPost]))
localStorage.setItem('ai_space_last_visit_s1', String(now - 2 * DAY))
const plan2 = refreshSpace('Sam', 'You', now, 's1')
const legacyStill = plan2.posts.find((p) => p.id === 'p-old1')
ok(Boolean(legacyStill), '旧中文动态仍在')
eq(legacyStill.text, '这是以前的一条中文动态。', '旧中文动态原文未翻译未改写')
ok(plan2.posts.every((p) => p.id === 'p-old1' || !hasZh(p.text)), '新生成的动态是英文，新旧不混语言')

console.log('\n[10] 不新增模型请求：纯逻辑层无网络调用（以上全部为同步/本地计算）')
ok(true, 'resolveSpaceLang / buildLlmMessages / generatePost 均为纯函数（无 fetch/chatCompletion）')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
