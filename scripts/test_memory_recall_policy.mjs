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

const stomach = M('stomach', '最近总感觉胃不舒服', { topic: '健康' })
assert.equal(shouldTouchMemoryFromUser(stomach, '今天感觉天气不错'), false, '泛化二字词“感觉”不能构成具体重提')
assert.equal(shouldTouchMemoryFromUser(stomach, '我的胃还是不舒服'), true, '具体“胃/不舒服”事实重合仍应 touch')

const hospital = M('hospital', '今天去医院看病', { topic: '健康' })
assert.equal(shouldTouchMemoryFromUser(hospital, '今天去公园散步'), false, '共享时间/动作骨架不能构成具体重提')
assert.equal(shouldTouchMemoryFromUser(hospital, '医院看病排队好久'), true, '具体“医院看病”片段重合应 touch')

const project = M('project', '最近在赶项目', { topic: '工作' })
assert.equal(shouldTouchMemoryFromUser(project, '今天加班赶项目'), true, '直接相关工作内容允许 touch')
assert.equal(shouldTouchMemoryFromUser(project, '今天要开会'), false, '只有同属工作主题但没有具体重合时不应整组 touch')

const cat = M('cat', '养了一只橘猫', { topic: '宠物' })
assert.equal(shouldTouchMemoryFromUser(cat, '猫'), true, '明确短词重新出现也算真实提及')

const dailyWork = M('daily-work', '每天上班都很累', { topic: '工作' })
assert.equal(shouldTouchMemoryFromUser(dailyWork, '每天跑步半小时'), false, '“每天”只是时间骨架，不能构成 exact/touch')

const weekendSleep = M('weekend-sleep', '周末喜欢睡懒觉', { topic: '日子' })
assert.equal(shouldTouchMemoryFromUser(weekendSleep, '周末要去加班'), false, '“周末”只是时间骨架，不能构成 exact/touch')

const mondayWork = M('monday-work', '星期一上班很累', { topic: '工作' })
assert.equal(shouldTouchMemoryFromUser(mondayWork, '星期一跑步半小时'), false, '“星期一”整段时间骨架必须统一剥离')
assert.equal(shouldTouchMemoryFromUser(M('zhouyi-work', '周一上班很累'), '周一跑步半小时'), false, '“周一”时间骨架不能 exact/touch')
assert.equal(shouldTouchMemoryFromUser(M('dated-work', '10月4日上班很累'), '10月4日跑步半小时'), false, '具体月日不能单独构成 exact/touch')
assert.equal(shouldTouchMemoryFromUser(M('iso-date', '2026-10-04上班很累'), '2026-10-04跑步半小时'), false, '数字日期骨架不能 exact/touch')
assert.equal(shouldTouchMemoryFromUser(M('zh-date', '十月四日上班很累'), '十月四日跑步半小时'), false, '中文数字月日不能 exact/touch')
assert.equal(shouldTouchMemoryFromUser(M('zh-full-date', '二〇二六年十月四日上班很累'), '二〇二六年十月四日跑步半小时'), false, '中文数字完整日期不能 exact/touch')
assert.equal(shouldTouchMemoryFromUser(M('monthly-date', '每月一号上班很累'), '每月一号跑步半小时'), false, '每月一号这类周期日期不能 exact/touch')
assert.equal(shouldTouchMemoryFromUser(M('yearly-date', '每年十月四日上班很累'), '每年十月四日跑步很开心'), false, '每年+中文日期整段时间骨架不能 exact/touch')
assert.equal(shouldTouchMemoryFromUser(M('two-hours', '两个小时后上班很累'), '两个小时后跑步很开心'), false, '“两个小时后”不能单独 exact/touch')
assert.equal(shouldTouchMemoryFromUser(M('quarter-hour', '一刻钟后上班很累'), '一刻钟后跑步很开心'), false, '“一刻钟后”不能单独 exact/touch')
assert.equal(shouldTouchMemoryFromUser(M('seconds', '三十秒后上班很累'), '三十秒后跑步很开心'), false, '中文秒级时长不能单独 exact/touch')
assert.equal(shouldTouchMemoryFromUser(M('monday-hospital', '周一去医院看病'), '周一医院看病排队好久'), true, '剥离时间后仍有具体“医院看病”事实证据时应匹配')

const age30 = M('age30', '我今年30岁')
assert.equal(shouldTouchMemoryFromUser(age30, '这个月花了30元'), false, '相同数字 30 不能单独构成事实级命中')
assert.equal(shouldTouchMemoryFromUser(age30, '我今年31岁'), false, '数字冲突时即使单位相同也不能 exact/touch')
assert.equal(shouldTouchMemoryFromUser(age30, '我30岁了'), true, '相同数字 + 相同具体单位可以视为同一事实')

const mimiAge = M('mimi-age', '我有2只猫，咪咪今年3岁', { topic: '宠物' })
assert.equal(shouldTouchMemoryFromUser(mimiAge, '咪咪今年4岁'), true, '数字变化不能否决“咪咪”实体证据，纠正旧事实仍要能命中')

const mimiWeight = M('mimi-weight', '咪咪体重三公斤', { topic: '宠物' })
assert.equal(shouldTouchMemoryFromUser(mimiWeight, '咪咪体重四公斤'), true, '中文数值单位变化后仍保留“咪咪体重”实体证据')
assert.equal(shouldTouchMemoryFromUser(M('weight-three', '体重三公斤'), '三公斤'), false, '属性归属不明确时，数字+单位不能绕过 owner 证据')
assert.equal(shouldTouchMemoryFromUser(M('pure-weight', '三公斤'), '三公斤'), true, '双方都只有同一数字+单位时可作为完整事实锚点')
const myWeight = M('my-weight', '我的体重六十公斤', { topic: '健康' })
assert.equal(shouldTouchMemoryFromUser(myWeight, '咪咪体重四公斤'), false, '裸属性“体重”不能跨所属实体误命中')
assert.equal(shouldTouchMemoryFromUser(myWeight, '咪咪体重六十公斤'), false, '即使数值完全相同，数字+单位也不能跨所属实体误命中')
assert.equal(shouldTouchMemoryFromUser(myWeight, '我的体重六十一公斤'), true, '双方都明确指向“我”时，体重变化仍应命中纠正')
const myHeight = M('my-height', '我的身高一百七十厘米', { topic: '健康' })
assert.equal(shouldTouchMemoryFromUser(myHeight, '小夏身高一百六十厘米'), false, '裸属性“身高”不能跨所属实体误命中')
assert.equal(shouldTouchMemoryFromUser(myHeight, '小夏身高一百七十厘米'), false, '相同身高数值也不能绕过 owner 判断')
const mySalary = M('my-salary', '我的工资五千元', { topic: '工作' })
assert.equal(shouldTouchMemoryFromUser(mySalary, '小夏工资五千元'), false, '任意中文属性都必须经过 owner 兼容判断，不能只覆盖属性白名单')
assert.equal(shouldTouchMemoryFromUser(mySalary, '工资最近涨了'), true, '没有额外实体前缀时，用户隐式继续谈自己的工资仍可命中')

const englishMyWeight = M('english-my-weight', 'my weight is 60 kilograms')
assert.equal(shouldTouchMemoryFromUser(englishMyWeight, "Mimi's weight is 60 kilograms"), false, '英文共享属性词也必须经过 owner 兼容判断')
assert.equal(shouldTouchMemoryFromUser(englishMyWeight, 'weight changed again'), true, '英文没有额外实体前缀时仍可继续命中自己的事实')
const xiaSalary = M('xia-salary', '小夏的工资五千元', { topic: '工作' })
assert.equal(shouldTouchMemoryFromUser(xiaSalary, '小明的工资五千元'), false, '两个不同非用户实体不能因共享工资与数值 exact')
assert.equal(shouldTouchMemoryFromUser(xiaSalary, '小夏工资涨了'), true, '同一中文实体省略“的”后仍应命中')

const mimiWeightEn = M('mimi-weight-en', "Mimi's weight is 60 kilograms")
assert.equal(shouldTouchMemoryFromUser(mimiWeightEn, "Fido's weight is 60 kilograms"), false, '不同英文实体不能因共享 weight 与数值 exact')
assert.equal(shouldTouchMemoryFromUser(M('mimi-weight-postfix', 'weight of Mimi is 60 kilograms'), 'weight of Fido is 60 kilograms'), false, '英文后置 owner 也必须参与兼容判断')
assert.equal(shouldTouchMemoryFromUser(mimiWeightEn, 'Mimi weight changed again'), true, '同一英文实体不同所有格写法仍应命中')

console.log('\n[memory recall 2] 孤立主题标签不能充当事实级 exact')
assert.equal(shouldTouchMemoryFromUser(M('work-topic', '工作，最近很忙', { topic: '工作' }), '工作，今天很顺利'), false, '孤立“工作”只能代表主题，不能 exact/touch')
assert.equal(shouldTouchMemoryFromUser(M('pet-topic', '宠物，最近很闹', { topic: '宠物' }), '宠物，今天很安静'), false, '孤立“宠物”不能 exact/touch')
assert.equal(shouldTouchMemoryFromUser(M('work-project', '工作，星河项目延期', { topic: '工作' }), '星河项目又延期了'), true, '主题词剥离后仍有“星河项目”具体证据时应匹配')

console.log('\n[memory recall 2] pinned 入场优先级高于 exact 洪水')
const pinnedCore = M('pinned-core', '严重过敏事实', { pinned: true })
const catFlood = Array.from({ length: 10 }, (_, i) => M(`cat-${i}`, `第${i}只猫的具体信息`, { explicit: true }))
const pinnedProtected = selectMemoryWorkingSet([pinnedCore, ...catFlood], {
  userText: '猫',
  tokenBudget: 5000,
  maxItems: 10,
})
assert.ok(pinnedProtected.items.some((m) => m.id === 'pinned-core'), 'pinned 必须先于 exact 候选获得入场资格')
assert.equal(pinnedProtected.items.length, 10, '仍遵守 maxItems，不额外扩容')

console.log('\n[memory recall 2] Chat 生产挂载必须传 current user text + 最终 block renderer')
const chatSource = readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
assert.match(chatSource, /selectMemoryWorkingSet\(recalledMemory, \{[\s\S]*userText: text,[\s\S]*renderBlock: \(items\) => buildMemoryBlock\(/)
assert.match(chatSource, /if \(m\.pinned \|\| !shouldTouchMemoryFromUser\(m, text\)\) continue/)

console.log('\nmemory_recall_policy：全部通过')
