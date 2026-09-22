// v7 #13 · 身份模式三档 + 模型胶囊 + 空人设生活/语言回归。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const store = new Map()
globalThis.localStorage = {
  getItem: (key) => store.has(key) ? store.get(key) : null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
  key: (index) => [...store.keys()][index] ?? null,
  get length() { return store.size },
}

const {
  resolveCompanionPolicy,
  resolveIdentityMode,
  mergeProfileIdentityField,
  saveIdentityMode,
  allowsEmbodiedLifeContext,
} = await import('../src/lib/companionPolicy.ts')
const { buildSystemPrompt, CHAT_RULES, CHAT_RULES_EN, looksRobotic } = await import('../src/lib/chatPrompts.ts')
const { buildLlmMessages, canUseLlm } = await import('../src/lib/aiSpaceLlm.ts')
const { clearAIProfile, collectAllAIProfiles, loadAIProfile, saveAIProfile } = await import('../src/lib/storage.ts')
const { setSessionsCache } = await import('../src/lib/sessionStore.ts')
const { getOrAdvanceTaRuntime } = await import('../src/lib/taRuntime.ts')

console.log('\n[1] 角色级存储：旧资料默认沉浸，三档隔离且不新增 key')
setSessionsCache([{ id: 'A' }, { id: 'B' }])
saveAIProfile({ nickname: '甲', avatar: '' }, 'A')
saveAIProfile({ nickname: '乙', avatar: '' }, 'B')
assert.equal(resolveIdentityMode('A'), 'immersive')
assert.equal(saveIdentityMode('A', 'natural'), true)
assert.equal(saveIdentityMode('B', 'ai'), true)
assert.equal(resolveIdentityMode('A'), 'natural')
assert.equal(resolveIdentityMode('B'), 'ai')
assert.equal(loadAIProfile('A').nickname, '甲', '切身份不覆盖昵称')
assert.equal(collectAllAIProfiles().A.identityMode, 'natural', '沿用现有 profile 同步实体')
assert.ok([...store.keys()].every((key) => !key.includes('identity_mode')), '没有新增 identity storage key')
localStorage.setItem('ai_companion_ai_profile_A', JSON.stringify({ nickname: '甲', avatar: '', futureField: '保留', identityMode: 'natural' }))
assert.equal(saveIdentityMode('A', 'ai'), true)
assert.equal(JSON.parse(localStorage.getItem('ai_companion_ai_profile_A')).futureField, '保留', '切身份只 merge，不吃未来资料字段')
assert.equal(saveIdentityMode('A', 'natural'), true)
const legacyMerged = mergeProfileIdentityField(
  JSON.stringify({ nickname: '甲', avatar: '', identityMode: 'ai' }),
  { nickname: '旧客户端', avatar: '' },
)
assert.equal(legacyMerged.identityMode, 'ai', '旧客户端缺 identityMode 时不覆盖本机选择')
assert.equal(mergeProfileIdentityField(null, { nickname: '旧角色', avatar: '' }).identityMode, undefined, '无旧选择时保持缺字段语义')

console.log('\n[2] 中央策略：四个维度完整，默认/自然/AI 语义固定')
const natural = resolveCompanionPolicy('A')
const ai = resolveCompanionPolicy('B')
for (const policy of [natural, ai]) {
  for (const field of ['selfModel', 'disclosure', 'lifeExpressionModel', 'realityBoundary']) {
    assert.ok(policy[field], `${policy.mode} 有 ${field}`)
  }
}
assert.equal(natural.disclosure, 'acknowledge-when-asked')
assert.equal(ai.lifeExpressionModel, 'ai-native')
assert.equal(allowsEmbodiedLifeContext('immersive'), true)
assert.equal(allowsEmbodiedLifeContext('natural'), false)
assert.equal(allowsEmbodiedLifeContext('ai'), false)

console.log('\n[3] Chat：公共规则解耦，Identity Soul 按会话切换，语言约束覆盖思考链')
assert.ok(!CHAT_RULES.includes('你是活人不是AI'))
assert.ok(!CHAT_RULES_EN.includes('You are a real person, not an AI'))
const naturalPrompt = buildSystemPrompt('', '甲', Date.now(), 'A', 'zh')
const aiPrompt = buildSystemPrompt('', '乙', Date.now(), 'B', 'zh')
assert.ok(naturalPrompt.includes('【陪伴核心】'))
assert.ok(naturalPrompt.includes('【身份灵魂·自然】'))
assert.ok(naturalPrompt.includes('回复正文和可见的思考过程都使用中文'))
assert.ok(aiPrompt.includes('【身份灵魂·AI】'))
assert.ok(aiPrompt.includes('不扮演真人'))
assert.equal(looksRobotic('我是一个AI。', 'immersive'), true)
assert.equal(looksRobotic('我是一个AI。', 'natural'), false)
assert.equal(looksRobotic('有什么可以帮你的吗', 'ai'), true, 'AI 档仍拦客服腔')

console.log('\n[4] TA Life：空人设可走模型，身份规则控制生活表达与语言')
const ready = { apiKey: 'local-only', baseUrl: 'https://example.invalid/v1', model: 'test' }
assert.equal(canUseLlm('', ready), false, '旧默认仍要求人设')
assert.equal(canUseLlm('', ready, true), true, '#13 空人设入口允许生成')
const baseCtx = {
  taName: '甲', sessionId: 'A', yourName: '你', persona: '', season: '秋', timeWord: '晚上',
  weatherWord: '晴', recent: [], atDateStr: '9月20日',
}
const naturalLife = buildLlmMessages(baseCtx, 'zh').map((m) => m.content).join('\n')
assert.ok(naturalLife.includes('【身份灵魂·自然】'))
assert.ok(naturalLife.includes('不得编造人的现实经历'))
assert.ok(naturalLife.includes('没有补充人设事实'))
const aiLife = buildLlmMessages({ ...baseCtx, sessionId: 'B' }, 'en').map((m) => m.content).join('\n')
assert.ok(aiLife.includes('[Identity Soul — AI]'))
assert.ok(aiLife.includes('[Language] Reply and reason in English'))

console.log('\n[5] Runtime：沉浸用现实活动，自然/AI 只用非身体化状态，切档立即换轨')
const noon = new Date(2026, 8, 20, 12, 0).getTime()
const naturalRuntime = getOrAdvanceTaRuntime('A', '', noon, () => 0)
const aiRuntime = getOrAdvanceTaRuntime('B', '', noon, () => 0)
const aiNative = new Set(['reading_chat', 'organizing_thoughts', 'following_thread', 'quietly_present'])
assert.ok(aiNative.has(naturalRuntime.activityId))
assert.ok(aiNative.has(aiRuntime.activityId))
saveIdentityMode('A', 'immersive')
const immersiveRuntime = getOrAdvanceTaRuntime('A', '', noon + 1, () => 0)
assert.ok(!aiNative.has(immersiveRuntime.activityId), '切回沉浸后不沿用 AI-native Runtime')

console.log('\n[6] 删除与 UI 契约：资料实体清除，胶囊原地切换保存配置')
clearAIProfile('A')
assert.equal(localStorage.getItem('ai_companion_ai_profile_A'), null)
const rolesSource = readFileSync(new URL('../src/components/RolesPage.tsx', import.meta.url), 'utf8')
const controlsSource = readFileSync(new URL('../src/components/ChatCompanionControls.tsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const memorySource = readFileSync(new URL('../src/components/Memory.tsx', import.meta.url), 'utf8')
const chatSource = readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
assert.match(rolesSource, /clearAIProfile\(id\)/)
assert.match(controlsSource, /loadSavedConfigs\(\)/)
assert.match(controlsSource, /saveSettings\(\{/)
assert.match(controlsSource, /saveIdentityMode\(sessionId, mode\)/)
assert.match(appSource, /<ChatCompanionControls sessionId=/)
assert.ok(!memorySource.includes('companionPolicy'), 'Memory 不直接感知身份模式')

console.log('\n[7] Chat 现实生活硬边界：自然 / AI 不再注入实体生活块')
assert.match(chatSource, /const allowEmbodiedLife = allowsEmbodiedLifeContext\(resolveIdentityMode\(activeSessionId \|\| undefined\)\)/)
assert.match(chatSource, /if \(allowEmbodiedLife\) \{[\s\S]{0,300}buildSpacePostsBlock/)
assert.match(chatSource, /if \(allowEmbodiedLife && !personaHasLifeAnchors\(persona\)\)/)
assert.match(chatSource, /if \(allowEmbodiedLife && shouldInjectYourMoment\(recentUserTexts, lang\)\)/)

console.log('\n身份模式 #13：全部通过')
