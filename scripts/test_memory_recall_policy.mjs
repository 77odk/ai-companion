import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MEMORY_WORKING_SET_MAX_ITEMS,
  MEMORY_WORKING_SET_TOKEN_BUDGET,
  selectMemoryWorkingSet,
  shouldTouchMemoryFromUser,
} from '../src/lib/memoryRecallPolicy.ts'
import { buildMemoryBlock } from '../src/lib/chatPrompts.ts'
import { estimateToken } from '../src/lib/token.ts'

function M(id, text, opts = {}) {
  return { id, text, createdAt: Date.now(), ...opts }
}

console.log('\n[memory recall 2] explicit fallback / topic flood 受 working-set 上限')
const manyExplicit = Array.from({ length: 30 }, (_, i) =>
  M(`e-${i}`, `用户明确说过的稳定事实第${i}条：喜欢某种很具体的东西`, { explicit: true }),
)
const capped = selectMemoryWorkingSet(manyExplicit)
assert.ok(capped.items.length > 0, '仍应保留一组可用记忆')
assert.ok(capped.items.length <= MEMORY_WORKING_SET_MAX_ITEMS, 'item 数量不能超过 working-set 上限')
assert.ok(capped.items.length < manyExplicit.length, 'explicit fallback 不再允许整库全量注入')
assert.ok(capped.estimatedTokens <= MEMORY_WORKING_SET_TOKEN_BUDGET, 'working set 必须受 token budget 约束')
assert.equal(capped.truncated, true, '发生裁剪时必须可观测')

console.log('\n[memory recall 2] 保持现有召回排序，不在治理层重新洗牌')
const ordered = [
  M('pin', '最重要的关系核心', { pinned: true }),
  M('explicit', '用户明确说过的稳定事实', { explicit: true }),
  M('recent', '最近相关的一条普通记忆'),
]
const preserved = selectMemoryWorkingSet(ordered, { tokenBudget: 1000, maxItems: 10 })
assert.deepEqual(preserved.items.map((m) => m.id), ['pin', 'explicit', 'recent'])

console.log('\n[memory recall 2] 单条过大候选可以跳过，后续较小候选仍可进入预算')
const mixed = selectMemoryWorkingSet(
  [
    M('huge', '超'.repeat(2000), { explicit: true }),
    M('small', '喜欢咖啡', { explicit: true }),
  ],
  { tokenBudget: 180, maxItems: 10 },
)
assert.deepEqual(mixed.items.map((m) => m.id), ['small'])
assert.ok(mixed.estimatedTokens <= 180)

console.log('\n[memory recall 2] 当前用户精确提到的旧记忆先拿入场资格，但最终顺序仍沿用原召回顺序')
const crowdedTopic = [
  ...Array.from({ length: 10 }, (_, i) => M(`food-${i}`, `最近的饮食记忆 ${i}：爱吃第${i}种菜`, { topic: '饮食', explicit: true })),
  M('peanut', '吃花生会严重过敏', { topic: '饮食', explicit: true }),
]
const protectedExact = selectMemoryWorkingSet(crowdedTopic, {
  userText: '我吃花生会过敏吗',
  tokenBudget: 5000,
  maxItems: 10,
})
assert.equal(protectedExact.items.length, 10)
assert.ok(protectedExact.items.some((m) => m.id === 'peanut'), '第 11 位的精确命中不能被主题洪水挤掉')
assert.equal(protectedExact.items.at(-1)?.id, 'peanut', '入场后仍按原召回顺序输出，不重排现有信任规则')

console.log('\n[memory recall 2] 生产预算按最终渲染块计费')
const englishExpansion = Array.from({ length: 12 }, (_, i) =>
  M(`we-${i}`, `we we we we we we remember coffee detail ${i}`, { explicit: true }),
)
const renderedBudget = 420
const renderedSelection = selectMemoryWorkingSet(englishExpansion, {
  tokenBudget: renderedBudget,
  maxItems: 12,
  renderBlock: (items) => buildMemoryBlock(items, 'en'),
})
const renderedBlock = buildMemoryBlock(renderedSelection.items, 'en') ?? ''
assert.ok(estimateToken(renderedBlock) <= renderedBudget, '最终真正发送的 Memory block 必须在预算内')
assert.equal(renderedSelection.estimatedTokens, estimateToken(renderedBlock), 'reported token 必须等于最终渲染块 token')

console.log('\n[memory recall 2] 系统召回本身不能 touch；必须用户真的提到具体事实')
const coffee = M('coffee', '用户喜欢喝咖啡', { topic: '饮食' })
assert.equal(shouldTouchMemoryFromUser(coffee, '今天有点累'), false, '无关用户消息不能因为系统召回而 touch')
assert.equal(shouldTouchMemoryFromUser(coffee, '我今天想喝咖啡'), true, '用户真实再次提到咖啡时允许 touch')
assert.equal(shouldTouchMemoryFromUser(coffee, '我喜欢今天的天气'), false, '只有通用词“喜欢”重合不能 touch 咖啡记忆')

const englishCoffee = M('english-coffee', 'the user drinks coffee every morning')
assert.equal(shouldTouchMemoryFromUser(englishCoffee, 'the weather is nice today'), false, '英文通用词 the/today 重合不能 touch')

const project = M('project', '最近在赶项目', { topic: '工作' })
assert.equal(shouldTouchMemoryFromUser(project, '今天加班赶项目'), true, '直接相关工作内容允许 touch')
assert.equal(shouldTouchMemoryFromUser(project, '今天要开会'), false, '只有同属工作主题但没有具体重合时不应整组 touch')

const cat = M('cat', '养了一只橘猫', { topic: '宠物' })
assert.equal(shouldTouchMemoryFromUser(cat, '猫'), true, '明确短词重新出现也算真实提及')

console.log('\n[memory recall 2] Chat 生产挂载必须传 current user text + 最终 block renderer')
const chatSource = readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
assert.match(chatSource, /selectMemoryWorkingSet\(recalledMemory, \{[\s\S]*userText: text,[\s\S]*renderBlock: \(items\) => buildMemoryBlock\(/)
assert.match(chatSource, /if \(m\.pinned \|\| !shouldTouchMemoryFromUser\(m, text\)\) continue/)

console.log('\nmemory_recall_policy：全部通过')
