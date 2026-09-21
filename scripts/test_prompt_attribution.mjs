import assert from 'node:assert/strict'

const store = new Map()
globalThis.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
  key: (index) => [...store.keys()][index] ?? null,
  get length() { return store.size },
}
globalThis.window = { dispatchEvent() {} }
globalThis.CustomEvent = class CustomEvent { constructor(type) { this.type = type } }

const {
  buildAttributionLegend,
  cleanAttributionArtifacts,
  cleanStreamingAttributionArtifacts,
  formatAttributedLine,
  hasAttributionLeak,
} = await import('../src/lib/promptAttribution.ts')
const { buildMemoryBlock, buildSystemPrompt } = await import('../src/lib/chatPrompts.ts')
const { buildLlmMessages, buildReplyMessages, cleanLlmText } = await import('../src/lib/aiSpaceLlm.ts')
const { buildSummaryMessages, cleanSummaryText } = await import('../src/lib/memorySummary.ts')
const { buildFutureAgendaBlock } = await import('../src/lib/futureAgenda.ts')
const { buildSelfTimelineBlock } = await import('../src/lib/selfTimeline.ts')
const { buildSpacePostsBlock } = await import('../src/lib/spaceChatInject.ts')
const { buildTaRuntimeContext } = await import('../src/lib/taRuntime.ts')
const { serializeBusyContext } = await import('../src/lib/aiBusy.ts')
const { buildAttributedWeeklyPrompt, formatAttributedWeeklyMessage } = await import('../src/lib/weeklyPromptAttribution.ts')

let passed = 0
function ok(value, name) {
  assert.ok(value, name)
  passed += 1
}
function eq(actual, expected, name) {
  assert.equal(actual, expected, name)
  passed += 1
}

console.log('\n[1] 中文来源归一与旧数据幂等')
eq(formatAttributedLine('我喜欢吃巧克力', 'USER', 'zh'), '[source=USER] USER 喜欢吃巧克力', 'USER 的“我”归 USER')
eq(formatAttributedLine('对方在上班呀', 'USER', 'zh'), '[source=USER] USER 在上班呀', '旧“对方”归一且不叠加')
eq(formatAttributedLine('你是我老公', 'USER', 'zh'), '[source=USER] SELF 是 USER 的老公', '关系事实同时保留 SELF/USER')
eq(formatAttributedLine('我们周五一起看电影', 'USER', 'zh'), '[source=USER] USER 与 SELF 周五一起看电影', '我们展开为双方')
eq(formatAttributedLine('我下班后买了杯咖啡', 'SELF', 'zh'), '[source=SELF] SELF 下班后买了杯咖啡', 'SELF 的“我”归 SELF')
const once = formatAttributedLine('对方喜欢巧克力', 'USER', 'zh')
eq(formatAttributedLine(once, 'USER', 'zh'), once, '重复归一结果不变')

console.log('\n[2] 引号与嵌套转述保护')
eq(formatAttributedLine('朋友说「我不去了」', 'USER', 'zh'), '[source=USER] 朋友说「我不去了」', '中文引号内第三方“我”不改')
eq(formatAttributedLine('She said “I am leaving”, but I stayed', 'USER', 'en'), '[source=USER] She said “I am leaving”, but USER stayed', '英文引号内 I 不改、外层 I 归 USER')

console.log('\n[3] 英文第一、第二人称')
eq(formatAttributedLine('I like chocolate and you know my taste', 'USER', 'en'), "[source=USER] USER like chocolate and SELF know USER's taste", '英文 USER I/you/my 归属')
eq(formatAttributedLine('I bought coffee after work', 'SELF', 'en'), '[source=SELF] SELF bought coffee after work', '英文 SELF I 归属')
eq(formatAttributedLine("I'm tired but you're here", 'USER', 'en'), '[source=USER] USER is tired but SELF is here', '英文缩写不会变成 USER\'m/SELF\'re')
eq(formatAttributedLine("We're ready", 'SHARED', 'en', 'USER'), '[source=SHARED] USER and SELF are ready', '英文共同主体缩写归 SHARED 双方')

console.log('\n[4] 出站净化与流式前缀缓冲')
eq(cleanAttributionArtifacts('[source=SELF] SELF 下班了，USER 早点睡', 'zh'), '我下班了，你早点睡', '中文标记转自然自称')
eq(cleanAttributionArtifacts("[source=SELF] SELF finished work; USER's turn", 'en'), 'I finished work; your turn', '英文标记转自然自称')
ok(hasAttributionLeak('[USER] text'), '能识别完整标记泄漏')
ok(!hasAttributionLeak('我下班了，你早点睡'), '自然正文不误报')
for (const partial of ['[', '[U', '[USER', '[source=', '[source=SE']) {
  eq(cleanStreamingAttributionArtifacts(partial, 'zh'), '', `流式前缀不闪现：${partial}`)
}
eq(cleanStreamingAttributionArtifacts('你好\n[source=SE', 'zh'), '你好', '正文后的残缺标记也不闪现')
eq(cleanStreamingAttributionArtifacts('hello U', 'en'), 'hello', '正文后的裸归因词前缀也不闪现')
eq(cleanStreamingAttributionArtifacts('hello [source=se', 'en'), 'hello', '小写残缺标记也不闪现')
eq(cleanStreamingAttributionArtifacts('[source=SELF] SELF 下班了', 'zh'), '我下班了', '标记收齐后只展示正文')
ok(hasAttributionLeak('[source=SE'), '能识别残缺 source 标记')
ok(hasAttributionLeak('【来源说明】USER 是用户'), '能识别来源说明整段泄漏')

console.log('\n[5] 聊天记忆、未来约定、自我时间线、Runtime、忙碌上下文')
const memoryZh = buildMemoryBlock([{ id: 'm1', text: '我喜欢巧克力', createdAt: Date.now() }], 'zh') ?? ''
ok(memoryZh.includes('[source=USER] USER 喜欢巧克力'), '中文记忆统一标 USER')
const memoryEn = buildMemoryBlock([{ id: 'm2', text: 'I like tea', createdAt: Date.now() }], 'en') ?? ''
ok(memoryEn.includes('[source=USER] USER like tea'), '英文记忆 I 不再裸注入')
const agenda = buildFutureAgendaBlock([{ t: '周五我陪你看电影', ts: 1, futureDay: '2099-01-01' }], new Date('2026-09-21'), 'zh')
ok(agenda.includes('[source=USER] 周五 USER 陪 SELF 看电影'), '未来约定保留用户来源')
const timeline = buildSelfTimelineBlock([{ role: 'assistant', content: '我去买咖啡', ts: Date.now() }], Date.now(), 'zh')
ok(timeline.includes('[source=SELF] SELF 去买咖啡'), '自我时间线归 SELF')
const runtime = buildTaRuntimeContext({ activityId: 'reading', label: '我在看书', startedAt: 1, plannedUntil: Date.now() + 60000, updatedAt: 1, source: 'routine' }, 'zh')
ok(runtime.includes('[source=SELF] SELF 在看书') && !runtime.includes('你（TA）'), 'Runtime 归 SELF 且移除你（TA）')
const busy = serializeBusyContext([{ role: 'user', content: '我先休息' }, { role: 'assistant', content: '我去开会' }])
ok(busy.includes('[source=USER] USER 先休息') && busy.includes('[source=SELF] SELF 去开会'), '忙碌上下文沿用统一协议')

console.log('\n[6] 动态、评论、周记、TA 眼中的你')
const space = buildLlmMessages({
  taName: '黎深', sessionId: 's1', yourName: '七七', persona: '你是医生', season: '秋', timeWord: '晚上',
  weatherWord: '晴', atDateStr: '9月21日', recent: ['我刚下班'], chatTopics: ['我今天上班很累'],
}, 'zh').map((m) => m.content).join('\n')
ok(space.includes(buildAttributionLegend('zh')), '动态生成带统一来源说明')
ok(space.includes('[source=USER] USER 今天上班很累'), '动态用户话题归 USER')
ok(space.includes('[source=SELF] SELF 刚下班'), '历史动态归 SELF')
const reply = buildReplyMessages({ taName: '黎深', sessionId: 's1', yourName: '七七', persona: '你是医生', postText: '我刚下班', commentText: '我也刚下班' }, 'zh').map((m) => m.content).join('\n')
ok(reply.includes('[source=SELF] SELF 刚下班') && reply.includes('[source=USER] USER 也刚下班'), '动态评论双方来源分开')
const posts = buildSpacePostsBlock([{ id: 'p1', at: 1, kind: '日常', text: '我刚下班', comments: [{ id: 'c1', at: 2, from: 'user', text: '我也下班了' }] }], 5, 'zh')
ok(posts.includes('[source=SELF] SELF 刚下班') && posts.includes('[source=USER] USER 也下班了'), '动态回注聊天保持来源')
const weeklyLineUser = formatAttributedWeeklyMessage({ role: 'user', content: '我喜欢巧克力', ts: Date.now() })
const weeklyLineSelf = formatAttributedWeeklyMessage({ role: 'assistant', content: '我去买咖啡', ts: Date.now() })
const weekly = buildAttributedWeeklyPrompt({
  weekLabel: '第 1 周', summaryLines: [weeklyLineUser, weeklyLineSelf], newMemories: ['对方在上班'], daysKnown: 7,
  weekPosts: ['我刚下班'], weekAgenda: ['我们周五看电影'], weekEvents: ['我们第一次把话说开'],
})
ok(weekly.includes('[source=USER] USER 喜欢巧克力') && weekly.includes('[source=SELF] SELF 去买咖啡'), '周记聊天摘要统一来源')
ok(weekly.includes('[source=USER] USER 在上班') && weekly.includes('[source=SELF] SELF 刚下班'), '周记记忆与动态统一来源')
ok(weekly.includes('[source=SHARED] USER 与 SELF 第一次把话说开'), '周记 Event 归 SHARED')
ok(!weekly.includes('「对方」= 收信的人') && !weekly.includes('是「我」发的'), '周记不再保留第三套人称说明')
const summary = buildSummaryMessages('黎深', '七七', '你是医生', [{ id: 'm', text: '我喜欢巧克力', createdAt: 1 }]).map((m) => m.content).join('\n')
ok(summary.includes('[source=USER] USER 喜欢巧克力'), 'TA 眼中的你不再裸塞记忆')

console.log('\n[7] 出站清理覆盖可见产物')
eq(cleanLlmText('[source=SELF] SELF 刚下班'), '我刚下班', '动态正文落库前清理')
eq(cleanSummaryText('[source=SELF] SELF 一直惦记 USER'), '我一直惦记你', '心里话落库前清理')

console.log('\n[8] 三档身份均携带同一来源协议')
for (const mode of ['immersive', 'natural', 'ai']) {
  store.set(`ai_companion_ai_profile_${mode}`, JSON.stringify({ identityMode: mode }))
  const prompt = buildSystemPrompt('', '黎深', Date.now(), mode, 'zh')
  ok(prompt.includes(buildAttributionLegend('zh')), `${mode} 聊天带来源说明`)
  const life = buildLlmMessages({
    taName: '黎深', sessionId: mode, yourName: '七七', persona: '', season: '秋', timeWord: '晚上',
    weatherWord: '晴', atDateStr: '9月21日', recent: [], chatTopics: ['我喜欢巧克力'],
  }, 'zh').map((m) => m.content).join('\n')
  ok(life.includes('[source=USER] USER 喜欢巧克力'), `${mode} 动态归属一致`)
}

console.log(`\n结果：${passed} 通过，0 失败`)
