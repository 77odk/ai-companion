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
  allowsBusyState,
  buildIdentityBoundaryRepair,
} = await import('../src/lib/companionPolicy.ts')
const { buildSystemPrompt, CHAT_RULES, CHAT_RULES_EN, looksEmbodiedSelfClaim, looksRobotic } = await import('../src/lib/chatPrompts.ts')
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
assert.equal(allowsBusyState('immersive'), true, '真人忙碌只属于沉浸档')
assert.equal(allowsBusyState('natural'), false, '自然档不进入 BusyState')
assert.equal(allowsBusyState('ai'), false, 'AI 本体不进入 BusyState')

console.log('\n[3] Chat：公共规则解耦，Identity Soul 按会话切换，语言约束覆盖思考链')
assert.ok(!CHAT_RULES.includes('你是活人不是AI'))
assert.ok(!CHAT_RULES_EN.includes('You are a real person, not an AI'))
assert.ok(!CHAT_RULES.includes('你有自己的日子在过'), '公共规则不再偷偷绑定沉浸式现实生活')
assert.ok(!CHAT_RULES.includes('正在忙什么'), '公共规则不再要求实体生活细节')
assert.ok(!CHAT_RULES.includes('像真人微信聊天'), '公共规则只约束自然聊天风格，不定义身份')
assert.ok(CHAT_RULES.includes('具体怎样表达必须服从当前身份模式'))
assert.ok(CHAT_RULES_EN.includes('must follow the current identity mode'))
const naturalPrompt = buildSystemPrompt('', '甲', Date.now(), 'A', 'zh')
const aiPrompt = buildSystemPrompt('', '乙', Date.now(), 'B', 'zh')
const naturalCustomPrompt = buildSystemPrompt('性格温柔，喜欢认真听人说话。', '甲', Date.now(), 'A', 'zh')
assert.ok(naturalPrompt.includes('【陪伴核心】'))
assert.ok(naturalCustomPrompt.includes('【你的资料与关系背景·重要】'))
assert.ok(!naturalCustomPrompt.includes('这是你亲身体验的'), '自定义 persona 头部不再把所有设定强行解释成现实经历')
assert.ok(naturalPrompt.includes('【身份灵魂·自然】'))
assert.ok(naturalPrompt.includes('回复正文和可见的思考过程都使用中文'))
assert.ok(aiPrompt.includes('【身份灵魂·AI】'))
assert.ok(aiPrompt.includes('不扮演真人'))
assert.ok(naturalPrompt.includes('注意力、想法、情绪色彩'), '自然档由模型生成非身体化人的状态感')
assert.ok(naturalPrompt.includes('刚才还在想着你前面那句话'), '自然档有极短行为示例，不是模板池')
assert.ok(aiPrompt.includes('AI 原生体验'), 'AI 本体以数字存在为自我来源')
assert.ok(aiPrompt.includes('重新梳理我们聊到这里的脉络'), 'AI 本体有极短行为示例')
assert.ok(naturalPrompt.includes('不要让对方等你去忙、离开或稍后回来'), '自然档提示词明确无真人 Busy')
assert.ok(aiPrompt.includes('不要让对方等你去忙、离开或稍后回来'), 'AI 本体提示词明确无真人 Busy')
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

console.log('\n[7] Chat 现实生活边界：模型主导，硬编码实体生活与真人 Busy 只给沉浸')
assert.match(chatSource, /const identityMode = resolveIdentityMode\(activeSessionId \|\| undefined\)/, '身份模式提前解析供 busy 与生活边界共用')
assert.match(chatSource, /const allowEmbodiedLife = allowsEmbodiedLifeContext\(identityMode\)/, 'allowEmbodiedLife 从同一 identityMode 派生')
assert.match(chatSource, /const liveAllowBusy = allowsBusyState\(resolveIdentityMode\(activeSessionId \|\| undefined\)\)/, 'Busy 能力从当前 identityMode 实时派生（生成中切模式不沿用闭包）')
assert.match(chatSource, /if \(allowEmbodiedLife\) \{\s*const spaceBlock = buildSpacePostsBlock/s, 'Space 历史只在沉浸档作为 SELF 事实注入')
assert.match(chatSource, /if \(allowEmbodiedLife && !personaHasLifeAnchors\(persona\)\)/, 'LIFE_BASELINE 仅沉浸')
assert.match(chatSource, /if \(allowEmbodiedLife && shouldInjectYourMoment\(recentUserTexts, lang\)\)/, 'YourMoment 物理模板仅沉浸')
assert.ok(!chatSource.includes('pickBusyReply'), '真人 Busy 期间不再用本地话术假装即时回复')
assert.ok(!chatSource.includes('busyReplyText'), '真人 Busy 期间保持真正的短暂不回复')

console.log('\n[8] 弱模型护栏：只判明显 SELF 物理越界，正常状态感不误伤')
assert.equal(looksEmbodiedSelfClaim('我刚洗完澡，准备躺床上。', 'natural'), true)
assert.equal(looksEmbodiedSelfClaim('我刚下班回到家。', 'ai'), true)
assert.equal(looksEmbodiedSelfClaim('刚才还在想着你前面那句话。', 'natural'), false)
assert.equal(looksEmbodiedSelfClaim('我刚才在重新梳理这段对话。', 'ai'), false)
assert.equal(looksEmbodiedSelfClaim('你去吃饭吧，别饿着。', 'natural'), false, '对 USER 的建议不能误判成 SELF')
assert.equal(looksEmbodiedSelfClaim('我觉得你该去吃饭了。', 'natural'), false, 'SELF 只表达看法时，USER 的物理动作不能算 SELF')
assert.equal(looksEmbodiedSelfClaim('如果我有身体，可能会想出去散步。', 'ai'), false, '假设句不误判')
assert.equal(looksEmbodiedSelfClaim('如果你累了就休息，我刚下班回家。', 'natural'), true, '条件前缀不能豁免后半句真实 SELF 越界')
assert.equal(looksEmbodiedSelfClaim('I just got home from work.', 'natural'), true)
assert.equal(looksEmbodiedSelfClaim('I hear you. I just got home.', 'natural'), true, '英文句号切分后，后句明确 SELF 越界仍要识别')
assert.equal(looksEmbodiedSelfClaim("I'm glad you're eating dinner.", 'natural'), false, 'USER 的 physical predicate 不能因 I'm 共现而误判')
assert.equal(looksEmbodiedSelfClaim('I would tell you more, but I just got home from work.', 'ai'), true, 'hypothetical preamble cannot hide later SELF claim')
assert.equal(looksEmbodiedSelfClaim('I was still thinking about what you said earlier.', 'natural'), false)
assert.equal(looksEmbodiedSelfClaim('我刚洗完澡。', 'natural'), true, '常见完成体也要识别')
assert.equal(looksEmbodiedSelfClaim('我在吃饭。', 'natural'), true, '裸「我在…」进行式要识别')
assert.equal(looksEmbodiedSelfClaim('我在吃晚饭。', 'ai'), true, '裸「我在…」+具体餐次要识别')
assert.equal(looksEmbodiedSelfClaim('我去开会了，等我一下。', 'natural'), true, '实体工作活动 + busy 话术必须先被身份 guard 看见')
assert.equal(looksEmbodiedSelfClaim('我先去忙一会儿，等我。', 'natural'), false, '非实体 busy 不能被身份 guard 误伤')
assert.equal(looksEmbodiedSelfClaim('我去开会了，等我一下。', 'immersive'), false, '沉浸档保持不拦')
assert.equal(looksEmbodiedSelfClaim('我在家人看来一直比较安静。', 'natural'), false, '「在家」不能吞掉「家人」这个更长名词')
assert.equal(looksEmbodiedSelfClaim('我在运动方面更喜欢跑步。', 'natural'), false, '「运动」作为话题前缀不能误判成当前实体活动')
assert.equal(looksEmbodiedSelfClaim('I just took a shower.', 'natural'), true, '普通英语过去时洗澡要识别')
assert.equal(looksEmbodiedSelfClaim('I slept badly last night.', 'ai'), true, '普通英语过去时睡觉要识别')
assert.equal(looksEmbodiedSelfClaim('I went to work this morning.', 'natural'), true, '普通英语过去时上班要识别')
assert.equal(looksEmbodiedSelfClaim('I went to work on your message.', 'ai'), false, 'work on 任务语义不能误判成现实上班')
assert.match(buildIdentityBoundaryRepair('natural', 'zh'), /注意力、想法、情绪色彩/)
assert.match(buildIdentityBoundaryRepair('ai', 'zh'), /AI 原生体验/)
assert.match(chatSource, /const liveIdentityMode = resolveIdentityMode\(activeSessionId \|\| undefined\)/, 'finalize 重新读取当前身份，不能沿用请求开始时闭包')
assert.match(chatSource, /looksEmbodiedSelfClaim\(cleaned, liveIdentityMode\)/)
assert.match(chatSource, /looksEmbodiedSelfClaim\(retryCleaned, retryIdentityMode\)/)
assert.ok(chatSource.includes("if (liveAllowBusy && !busyTriggeredRef.current && raw && availability.state === 'unavailable'"), '非流式 Busy 按 finalize 时当前身份判定')
assert.match(chatSource, /const liveAllowBusy = allowsBusyState\(resolveIdentityMode\(activeSessionId \|\| undefined\)\)/, '流式 token 拦截也重新读取当前身份')
assert.ok(chatSource.includes("if (liveAllowBusy && !busyTriggeredRef.current && availability.state === 'unavailable'"), '流式 Busy 按 token 到达时当前身份判定')
assert.match(chatSource, /const unavailableIdentityProblem = Boolean\(/, '自然 / AI 的离开话术转身份 repair，不进入 Busy')
assert.match(chatSource, /!liveAllowBusy && cleanedAvailability\?\.state === 'unavailable'/, '自然 / AI finalize 拦截不可用声明')
assert.match(chatSource, /!retryAllowBusy && retryAvailability\?\.state === 'unavailable'/, 'repair 后按当前身份再次校验，不放行离开话术')
assert.match(chatSource, /if \(cleaned && identityProblem && retriedRef\.current\) \{\s*commitFinal\(\[\.\.\.messages, userMsg\]\)/s, '用户 Stop 命中身份问题时不落违规 partial，也不再发模型请求')
assert.match(chatSource, /looksEmbodiedSelfClaim\(text, liveIdentityMode\)/, 'pagehide / hidden partial 落库前也必须检查当前身份边界')
assert.match(chatSource, /if \(identityProblem\) return\s*const partialReplyLength/s, '违规 partial 不得进入 commitPartialReply / pending upload')
assert.match(chatSource, /else if \(retryAllowBusy && retryAvailability\?\.state === 'unavailable' && retryAvailability\.owner === 'SELF'\)/, 'repair 期间切回沉浸后，SELF 离开话术必须真正进入 Busy')
assert.match(chatSource, /enterBusyRef\.current\(busyText, retryAvailability\)/, '沉浸 repair 的 unavailable 回复必须建立 Busy/Return 周期')
assert.ok(chatSource.includes('repair 失败/超时也绝不把原违规文本重新放行'), 'repair 失败路径必须保留安全 fallback')
assert.ok(!chatSource.includes("content: cleaned, ts: assistantTs }]\n            commitFinal(final)\n          })\n        return"), 'repair catch 不能重新提交 rejected cleaned')

console.log('\n身份模式 #13：全部通过')
