// Space-N1｜TA 的余响专项回归
// 核心原则：本地只做机械候选/证据编号校验；conversation vs event 的语义由同一次 Space LLM 生成决定。
// 覆盖：新对话对 / 旧数据不迁移 / planned≠completed / SKIP / EVENT[n] 证据绑定 / partial 不配对 / 配额。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  collectConversationDays,
  collectPlannedDays,
  completeChatTopicPair,
  hasConcreteTopicInfo,
  conversationPairsForDay,
  isConversationMaterialCandidate,
  loadChatTopics,
  recordChatTopic,
} from '../src/lib/chatTopics.ts'
import { dayKeyOf, generationSlotIdFor, planBackfillSlots } from '../src/lib/aiSpaceCore.ts'
import {
  buildLlmMessages,
  isSpaceSkipResponse,
  parseSpaceGenerationDecision,
} from '../src/lib/aiSpaceLlm.ts'
import { generatePendingPosts, loadCurrentPosts, readLedger, refreshSpace } from '../src/lib/aiSpace.ts'
import { savePersona, saveSettings } from '../src/lib/storage.ts'

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const now = new Date(2026, 8, 28, 15, 0).getTime()
const todayKey = dayKeyOf(now)

function reset(mode = 'natural') {
  store.clear()
  localStorage.setItem('ai_companion_first_seen', String(now - 30 * DAY))
  localStorage.setItem('ai_companion_ai_profile', JSON.stringify({ identityMode: mode }))
  savePersona('性格温柔，认真听对方说话。')
  saveSettings({ provider: 'custom', apiKey: 'k-test', baseUrl: 'https://llm.test/v1', model: 'm-test' })
}

console.log('\n[1] 旧 USER-only 数据不迁移')
reset()
localStorage.setItem('ai_space_recent_topic', JSON.stringify([
  { t: '今天公司开会被夸了', ts: now - HOUR },
]))
let topics = loadChatTopics()
assert.equal(topics.length, 1)
assert.equal(isConversationMaterialCandidate(topics[0]), false)
assert.equal(conversationPairsForDay(topics, todayKey).length, 0)

console.log('\n[2] 新聊天只有最终真实回复落库后才成为完整对话对')
reset()
const userTs = now - HOUR
recordChatTopic('今天公司开会被老板夸了，我其实挺开心的', undefined, userTs)
topics = loadChatTopics()
assert.equal(isConversationMaterialCandidate(topics[0]), false)
assert.equal(completeChatTopicPair(
  '今天公司开会被老板夸了，我其实挺开心的',
  '你嘴上说得平静，但我听得出来你是真的开心。',
  undefined,
  userTs,
  userTs + 30_000,
), true)
topics = loadChatTopics()
assert.equal(isConversationMaterialCandidate(topics[0]), true)
assert.equal(topics[0].pairVersion, 1)

console.log('\n[3] 粗筛只做机械信息密度，不做中英文事件词表')
assert.equal(hasConcreteTopicInfo('哈哈哈哈哈哈哈哈'), false)
assert.equal(hasConcreteTopicInfo('好的好的好的'), false)
assert.equal(hasConcreteTopicInfo('在吗，我跟你说个事'), true)
assert.equal(hasConcreteTopicInfo('I had a rough meeting at work today'), true)

console.log('\n[4] 对话对严格按 session 隔离')
reset()
recordChatTopic('今天和同事开会有点累', 'A', userTs)
assert.equal(completeChatTopicPair('今天和同事开会有点累', '你今天确实撑了很久。', 'A', userTs, userTs + 10_000), true)
assert.equal(loadChatTopics('A').length, 1)
assert.equal(loadChatTopics('B').length, 0)

console.log('\n[5] planned 到期只规划 conversation，不在本地升级 event')
reset()
const planTs = now - 3 * DAY
localStorage.setItem('ai_space_recent_topic', JSON.stringify([
  {
    t: '周一一起看电影吧',
    ts: planTs,
    futureDay: todayKey,
    taText: '好，到那天我们再一起看。',
    taTs: planTs + 10_000,
    pairVersion: 1,
  },
]))
topics = loadChatTopics()
assert.deepEqual([...collectPlannedDays(topics, todayKey)], [todayKey])
assert.equal(collectConversationDays(topics, todayKey).has(todayKey), true)
let pairs = conversationPairsForDay(topics, todayKey)
assert.equal(pairs.length, 1)
assert.equal(pairs[0].plannedForDay, true)
assert.equal(pairs[0].sameDay, false)
const plannedSlots = planBackfillSlots(
  now - DAY,
  now,
  [],
  new Set(),
  () => 0.1,
  undefined,
  now - 30 * DAY,
  undefined,
  collectConversationDays(topics, todayKey),
  undefined,
  collectPlannedDays(topics, todayKey),
)
assert.equal(plannedSlots.some((s) => s.source === 'event'), false)
assert.equal(plannedSlots.some((s) => s.source === 'conversation' && s.conversationKind === 'planned'), true)

console.log('\n[6] prompt 让同一次生成决定 SKIP / CONVERSATION / EVENT[n]')
const prompt = buildLlmMessages({
  taName: '小忆',
  yourName: '你',
  persona: '认真听人说话。',
  season: '秋',
  timeWord: '下午',
  weatherWord: '晴',
  recent: [],
  atDateStr: '9月28日',
  postSource: 'conversation',
  conversationKind: 'planned',
  conversationPairs: [{
    userText: '周一一起看电影吧',
    taText: '好，到那天我们再一起看。',
    sameDay: false,
    plannedForDay: true,
  }],
}, 'zh')[1].content
assert.match(prompt, /\[source=USER\]/)
assert.match(prompt, /\[source=SELF\]/)
assert.match(prompt, /EVENT\[n\]/)
assert.match(prompt, /PLANNED/)
assert.match(prompt, /SKIP/)

console.log('\n[7] EVENT 必须引用当天非 planned 对话编号；否则机械降级 conversation')
const plannedOnly = [{ sameDay: false, plannedForDay: true }]
assert.deepEqual(
  parseSpaceGenerationDecision('EVENT[1]: 今天终于做了', 'conversation', plannedOnly),
  { kind: 'skip' },
)
const sameDayDialogue = [{ sameDay: true, plannedForDay: false }]
assert.deepEqual(
  parseSpaceGenerationDecision('EVENT[1]: 这件事真的发生了', 'conversation', sameDayDialogue),
  { kind: 'post', source: 'event', text: '这件事真的发生了' },
)
assert.deepEqual(
  parseSpaceGenerationDecision('EVENT[9]: 越界编号', 'conversation', sameDayDialogue),
  { kind: 'skip' },
)
assert.deepEqual(
  parseSpaceGenerationDecision('没有遵守协议的普通正文', 'conversation', sameDayDialogue),
  { kind: 'skip' },
)

console.log('\n[8] 运行模块不再存在本地“完成/共同”语义判定 API')
const topicSource = readFileSync(new URL('../src/lib/chatTopics.ts', import.meta.url), 'utf8')
assert.equal(topicSource.includes('hasCompletionEvidence'), false)
assert.equal(topicSource.includes('hasSharedCompletionSubject'), false)
assert.equal(topicSource.includes('collectConfirmedEventDays'), false)

console.log('\n[9] SKIP 是正式结果：不落盘、不记账、provisional 可释放')
reset()
recordChatTopic('今天公司开会被老板夸了，我其实挺开心的', undefined, userTs)
completeChatTopicPair(
  '今天公司开会被老板夸了，我其实挺开心的',
  '你嘴上说得挺平静，但我听得出来你是真的开心。',
  undefined,
  userTs,
  userTs + 30_000,
)
const slot = { at: now - 5 * 60 * 1000, source: 'conversation', conversationKind: 'trace' }
const slotId = generationSlotIdFor(slot)
const marker = `__generation_slot__:${slotId}`
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: 'SKIP' } }] }),
})
assert.equal(isSpaceSkipResponse('SKIP'), true)
const skipped = await generatePendingPosts({
  posts: [], mode: 'llm', created: 1, pending: [slot], used: { [marker]: -1 },
}, '小忆', '你', undefined, now, () => 0.1)
assert.equal(skipped.created, 0)
assert.equal(loadCurrentPosts().length, 0)
assert.equal(readLedger(undefined, now)[todayKey]?.conversation ?? 0, 0)
assert.equal(JSON.parse(localStorage.getItem('ai_space_used_templates') ?? '{}')[marker], undefined)

console.log('\n[10] 单次生成返回 CONVERSATION → source=conversation')
reset()
recordChatTopic('今天公司开会被老板夸了，我其实挺开心的', undefined, userTs)
completeChatTopicPair(
  '今天公司开会被老板夸了，我其实挺开心的',
  '你嘴上说得挺平静，但我听得出来你是真的开心。',
  undefined,
  userTs,
  userTs + 30_000,
)
const convSlot = { at: now - 5 * 60 * 1000, source: 'conversation', conversationKind: 'trace' }
const convId = generationSlotIdFor(convSlot)
let calls = 0
globalThis.fetch = async () => {
  calls++
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: 'CONVERSATION: 你说起被夸的时候很平静，但那点开心我还记着。' } }] }),
  }
}
const conv = await generatePendingPosts({
  posts: [], mode: 'llm', created: 1, pending: [convSlot], used: { [`__generation_slot__:${convId}`]: -1 },
}, '小忆', '你', undefined, now, () => 0.1)
assert.equal(calls, 1)
assert.equal(conv.created, 1)
assert.equal(conv.posts[0].source, 'conversation')
assert.equal(readLedger(undefined, now)[todayKey]?.conversation ?? 0, 1)

console.log('\n[11] 同一次生成可把 conversation 候选升级为 event，不增加第二次模型调用')
reset()
const oldPlanTs = now - 2 * DAY
recordChatTopic('周日一起看电影吧', undefined, oldPlanTs)
completeChatTopicPair('周日一起看电影吧', '好，到那天一起看。', undefined, oldPlanTs, oldPlanTs + 10_000)
const doneTs = now - HOUR
recordChatTopic('我们刚看完电影，已经到家了', undefined, doneTs)
completeChatTopicPair('我们刚看完电影，已经到家了', '嗯，散场后那股劲还在。', undefined, doneTs, doneTs + 10_000)
localStorage.setItem('ai_space_last_visit', String(now - DAY))
const eventPlan = refreshSpace('小忆', '你', now)
assert.equal(eventPlan.pending.length, 1)
assert.equal(eventPlan.pending[0].source, 'conversation')
pairs = conversationPairsForDay(loadChatTopics(), todayKey)
const eventEvidenceIndex = pairs.findIndex((p) => p.sameDay && !p.plannedForDay)
assert.ok(eventEvidenceIndex >= 0)
calls = 0
globalThis.fetch = async () => {
  calls++
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: `EVENT[${eventEvidenceIndex + 1}]: 散场以后，那段电影还在脑子里转。` } }] }),
  }
}
const eventResult = await generatePendingPosts(eventPlan, '小忆', '你', undefined, now, () => 0.1)
assert.equal(calls, 1)
assert.equal(eventResult.created, 1)
assert.equal(eventResult.posts[0].source, 'event')
assert.equal(readLedger(undefined, now)[todayKey]?.event ?? 0, 1)
assert.equal(readLedger(undefined, now)[todayKey]?.conversation ?? 0, 0)

console.log('\n[12] Natural / AI 一天总量上限仍为 1')
let extraCalls = 0
globalThis.fetch = async () => {
  extraCalls++
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'CONVERSATION: 第二条不该生成' } }] }) }
}
const extraSlot = { at: now - 2 * 60 * 1000, source: 'conversation', conversationKind: 'trace' }
const extraId = generationSlotIdFor(extraSlot)
const capped = await generatePendingPosts({
  posts: eventResult.posts,
  mode: 'llm',
  created: 1,
  pending: [extraSlot],
  used: { [`__generation_slot__:${extraId}`]: -1 },
}, '小忆', '你', undefined, now, () => 0.1)
assert.equal(capped.created, 0)
assert.equal(extraCalls, 0)

console.log('\n[13] Natural 无素材：进入 Space 不日更')
reset()
const emptyPlan = refreshSpace('小忆', '你', now)
assert.equal(emptyPlan.pending.length, 0)
assert.equal(emptyPlan.created, 0)

console.log('\n[14] partial 回复不能补成完整对话对')
const chatSource = readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
assert.match(chatSource, /const spacePairEligibleRef = useRef\(false\)/)
assert.match(chatSource, /if \(spacePairEligibleRef\.current\) \{[\s\S]{0,500}completeChatTopicPair/)
assert.match(chatSource, /const handleStop = \(\) => \{[\s\S]{0,900}spacePairEligibleRef\.current = false/)
assert.match(chatSource, /onError: \(err\) => \{[\s\S]{0,500}spacePairEligibleRef\.current = false/)
assert.match(chatSource, /onModelSettingsChanged = \(\) => \{[\s\S]{0,700}spacePairEligibleRef\.current = false/)

console.log('\n[15] planned 对话在最多 3 组素材里必须保留，供模型做语义关联')
const manyTopics = [
  { t: '周日一起看电影吧', ts: oldPlanTs, futureDay: todayKey, taText: '好，到那天一起看。', taTs: oldPlanTs + 1000, pairVersion: 1 },
  { t: '今天工作有点累', ts: now - 40 * 60 * 1000, taText: '我知道。', taTs: now - 39 * 60 * 1000, pairVersion: 1 },
  { t: '今天中午吃了面', ts: now - 30 * 60 * 1000, taText: '听起来还行。', taTs: now - 29 * 60 * 1000, pairVersion: 1 },
  { t: '今晚有点困了', ts: now - 20 * 60 * 1000, taText: '那就早点休息。', taTs: now - 19 * 60 * 1000, pairVersion: 1 },
]
const limited = conversationPairsForDay(manyTopics, todayKey, 3)
assert.equal(limited.length, 3)
assert.equal(limited.some((p) => p.plannedForDay), true)

console.log('\n[16] Immersive 明确 SKIP 不模板补位；非-SKIP失败仍可安全 daily fallback')
reset('immersive')
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: 'SKIP' } }] }),
})
const dailySlot = { at: now - 5 * 60 * 1000, source: 'daily' }
const dailyId = generationSlotIdFor(dailySlot)
const immersiveSkipped = await generatePendingPosts({
  posts: [], mode: 'llm', created: 1, pending: [dailySlot], used: { [`__generation_slot__:${dailyId}`]: -1 },
}, '小忆', '你', undefined, now, () => 0.1)
assert.equal(immersiveSkipped.created, 0)
assert.equal(immersiveSkipped.usedFallback, false)

reset('immersive')
globalThis.fetch = async () => { throw new Error('network down') }
const fallback = await generatePendingPosts({
  posts: [], mode: 'llm', created: 1, pending: [dailySlot], used: { [`__generation_slot__:${dailyId}`]: -1 },
}, '小忆', '你', undefined, now, () => 0.1)
assert.equal(fallback.created, 1)
assert.equal(fallback.usedFallback, true)
assert.equal(fallback.posts[0].source, 'daily')

console.log('\nSpace-N1：全部通过')
