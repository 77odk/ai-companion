// Space-N1｜TA 的余响专项回归
// 覆盖：新对话对 / 旧数据不迁移 / conversation 第三来源 / planned≠completed / SKIP 真正不落盘。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  collectConversationDays,
  collectConfirmedEventDays,
  collectPlannedDays,
  completeChatTopicPair,
  conversationPairsForDay,
  isConversationMaterialCandidate,
  loadChatTopics,
  recordChatTopic,
} from '../src/lib/chatTopics.ts'
import { dayKeyOf, generationSlotIdFor, planBackfillSlots } from '../src/lib/aiSpaceCore.ts'
import { buildLlmMessages, isSpaceSkipResponse } from '../src/lib/aiSpaceLlm.ts'
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

function reset() {
  store.clear()
  localStorage.setItem('ai_companion_first_seen', String(now - 30 * DAY))
  localStorage.setItem('ai_companion_ai_profile', JSON.stringify({ identityMode: 'natural' }))
  savePersona('性格温柔，认真听对方说话。')
  saveSettings({ provider: 'custom', apiKey: 'k-test', baseUrl: 'https://llm.test/v1', model: 'm-test' })
}

console.log('\n[1] 旧 USER-only 数据不迁移')
reset()
localStorage.setItem('ai_space_recent_topic', JSON.stringify([
  { t: '今天公司开会被夸了', ts: now - HOUR },
]))
const legacy = loadChatTopics()
assert.equal(legacy.length, 1)
assert.equal(legacy[0].pairVersion, undefined)
assert.equal(isConversationMaterialCandidate(legacy[0]), false)
assert.equal(collectConversationDays(legacy, todayKey).size, 0)

console.log('\n[2] 只有 TA 最终回复补齐后，才成为完整对话素材')
reset()
const userTs = now - HOUR
recordChatTopic('今天公司开会被老板夸了，我其实挺开心的', undefined, userTs)
let topics = loadChatTopics()
assert.equal(topics[0].pairVersion, undefined)
assert.equal(collectConversationDays(topics, todayKey).size, 0)
assert.equal(completeChatTopicPair(
  '今天公司开会被老板夸了，我其实挺开心的',
  '你嘴上说得挺平静，但我听得出来你是真的开心。',
  undefined,
  userTs,
  userTs + 30_000,
), true)
topics = loadChatTopics()
assert.equal(topics[0].pairVersion, 1)
assert.equal(topics[0].taText, '你嘴上说得挺平静，但我听得出来你是真的开心。')
assert.deepEqual([...collectConversationDays(topics, todayKey)], [todayKey])
const pairs = conversationPairsForDay(topics, todayKey)
assert.equal(pairs.length, 1)
assert.equal(pairs[0].userText, '今天公司开会被老板夸了，我其实挺开心的')
assert.equal(pairs[0].taText, '你嘴上说得挺平静，但我听得出来你是真的开心。')

console.log('\n[3] 角色隔离：A 的完整对话不能串给 B')
reset()
recordChatTopic('今天和同事开会有点累', 'A', userTs)
assert.equal(completeChatTopicPair('今天和同事开会有点累', '你今天确实撑了很久。', 'A', userTs, userTs + 10_000), true)
assert.equal(loadChatTopics('A').length, 1)
assert.equal(loadChatTopics('B').length, 0)

console.log('\n[4] planned 到期仍只是 conversation，不是 completed event')
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
assert.equal(collectConfirmedEventDays(topics, todayKey).has(todayKey), false)
assert.equal(collectConversationDays(topics, todayKey).has(todayKey), true)
let plannedPairs = conversationPairsForDay(topics, todayKey)
assert.equal(plannedPairs.some((p) => p.plannedForDay), true)
assert.equal(plannedPairs.some((p) => p.confirmedCompletion), false)
const plannedSlots = planBackfillSlots(
  now - DAY,
  now,
  [],
  collectConfirmedEventDays(topics, todayKey),
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

console.log('\n[5] 当天出现真实完成证据后，才升级 confirmed event')
const doneTs = now - 20 * 60 * 1000
recordChatTopic('我们刚看完电影，已经到家了', undefined, doneTs)
assert.equal(completeChatTopicPair(
  '我们刚看完电影，已经到家了',
  '嗯，散场后那股劲还在。',
  undefined,
  doneTs,
  doneTs + 10_000,
), true)
topics = loadChatTopics()
assert.equal(collectConfirmedEventDays(topics, todayKey).has(todayKey), true)
plannedPairs = conversationPairsForDay(topics, todayKey)
assert.equal(plannedPairs.some((p) => p.confirmedCompletion), true)

console.log('\n[6] 提示词同时携带 USER + SELF，且 planned 明确禁止冒充完成')
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
    plannedForDay: true,
    confirmedCompletion: false,
  }],
}, 'zh')[1].content
assert.match(prompt, /\[source=USER\]/)
assert.match(prompt, /\[source=SELF\]/)
assert.match(prompt, /约好了不等于做完了/)
assert.match(prompt, /SKIP/)

console.log('\n[7] SKIP 是正式结果：不落盘、不记账、provisional 可释放')
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
const plan = {
  posts: [],
  mode: 'llm',
  created: 1,
  pending: [slot],
  used: { [marker]: -1 },
}
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: 'SKIP' } }] }),
})
assert.equal(isSpaceSkipResponse('SKIP'), true)
assert.equal(isSpaceSkipResponse('SKIP because nothing happened'), false)
const skipped = await generatePendingPosts(plan, '小忆', '你', undefined, now, () => 0.1)
assert.equal(skipped.created, 0)
assert.equal(loadCurrentPosts().length, 0)
assert.equal(readLedger(undefined, now)[todayKey]?.conversation ?? 0, 0)
const usedAfterSkip = JSON.parse(localStorage.getItem('ai_space_used_templates') ?? '{}')
assert.equal(usedAfterSkip[marker], undefined)

console.log('\n[8] 有真实素材且模型选择发 → source=conversation，每天最多一条')
reset()
recordChatTopic('今天公司开会被老板夸了，我其实挺开心的', undefined, userTs)
completeChatTopicPair(
  '今天公司开会被老板夸了，我其实挺开心的',
  '你嘴上说得挺平静，但我听得出来你是真的开心。',
  undefined,
  userTs,
  userTs + 30_000,
)
const validSlot = { at: now - 5 * 60 * 1000, source: 'conversation', conversationKind: 'trace' }
const validId = generationSlotIdFor(validSlot)
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: '你说起被夸的时候很平静，但那点开心我还记着。' } }] }),
})
const generated = await generatePendingPosts({
  posts: [], mode: 'llm', created: 1, pending: [validSlot], used: { [`__generation_slot__:${validId}`]: -1 },
}, '小忆', '你', undefined, now, () => 0.1)
assert.equal(generated.created, 1)
assert.equal(generated.posts[0].source, 'conversation')
assert.equal(readLedger(undefined, now)[todayKey]?.conversation ?? 0, 1)

console.log('\n[9] Natural / AI 当天总量上限=1：已有 conversation 后 confirmed event 也不能再发第二条')
let extraCalls = 0
globalThis.fetch = async () => {
  extraCalls++
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '第二条不该生成' } }] }) }
}
const eventSlot = { at: now - 2 * 60 * 1000, source: 'event' }
const eventId = generationSlotIdFor(eventSlot)
const capped = await generatePendingPosts({
  posts: generated.posts, mode: 'llm', created: 1, pending: [eventSlot], used: { [`__generation_slot__:${eventId}`]: -1 },
}, '小忆', '你', undefined, now, () => 0.1)
assert.equal(capped.created, 0)
assert.equal(capped.posts.length, 1)
assert.equal(extraCalls, 0)

console.log('\n[10] Natural 无素材：进入 Space 也不日更')
reset()
const emptyPlan = refreshSpace('小忆', '你', now)
assert.equal(emptyPlan.pending.length, 0)
assert.equal(emptyPlan.created, 0)

console.log('\n[10] partial 回复不能补成完整对话对')
const chatSource = readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
assert.match(chatSource, /const spacePairEligibleRef = useRef\(false\)/)
assert.match(chatSource, /if \(spacePairEligibleRef\.current\) \{[\s\S]{0,500}completeChatTopicPair/)
assert.match(chatSource, /const handleStop = \(\) => \{[\s\S]{0,900}spacePairEligibleRef\.current = false/)
assert.match(chatSource, /onError: \(err\) => \{[\s\S]{0,500}spacePairEligibleRef\.current = false/)
assert.match(chatSource, /onModelSettingsChanged = \(\) => \{[\s\S]{0,700}spacePairEligibleRef\.current = false/)
assert.equal((chatSource.match(/spacePairEligibleRef\.current = true/g) ?? []).length >= 2, true)

console.log('\nSpace-N1：全部通过')
