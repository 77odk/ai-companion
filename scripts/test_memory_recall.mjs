// B19 记忆关键词激活：只有命中触发词的条目进入上下文；无命中不兜底。
import {
  addMemoryItem,
  deriveMemoryTriggerWords,
  recallRelevantMemories,
  setMemoryExplicit,
} from '../src/lib/memory.ts'
import { buildMemoryBlock } from '../src/lib/chatPrompts.ts'

const memStore = new Map()
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: (k) => memStore.delete(k),
}
globalThis.window = { dispatchEvent: () => {} }

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
function ids(items) {
  return items.map((m) => m.id)
}

const now = new Date(2026, 7, 22, 12, 0).getTime()
const DAY = 86400000
const recent = now - DAY
const mid = now - 10 * DAY
const old = now - 40 * DAY

function M(id, text, ts, opts = {}) {
  return { id, text, createdAt: ts, ...opts }
}

console.log('\n[B19-1] 无命中时不再兜底，pinned / explicit 也不能绕过激活门')
const unrelated = [
  M('p', '喜欢咖啡', old, { pinned: true, triggerWords: ['咖啡'] }),
  M('e', '养了一只猫', recent, { explicit: true, triggerWords: ['猫'] }),
]
eq(ids(recallRelevantMemories(unrelated, '今天天气怎么样', { now })), [], '无触发词命中 = 0 条注入')
eq(ids(recallRelevantMemories(unrelated, '', { now })), [], '空上下文 = 0 条注入')

console.log('\n[B19-2] 显式触发词命中才进入上下文')
const items = [
  M('coffee', '喜欢手冲咖啡', old, { pinned: true, triggerWords: ['手冲', '咖啡'] }),
  M('cat', '家里有一只橘猫', recent, { explicit: true, triggerWords: ['橘猫', '猫'] }),
  M('work', '最近在做新项目', mid, { triggerWords: ['项目'] }),
]
eq(ids(recallRelevantMemories(items, '那只橘猫今天怎么样', { now })), ['cat'], '只激活猫相关记忆')
eq(ids(recallRelevantMemories(items, '手冲咖啡怎么喝', { now })), ['coffee'], 'pinned 只有命中后才进入')
eq(ids(recallRelevantMemories(items, '项目现在做到哪了', { now })), ['work'], '普通条目命中触发词可进入')

console.log('\n[B19-3] 多条命中仍按 pinned → explicit → 活跃度排序')
const ranked = [
  M('normal', '和咖啡有关的普通记忆', recent, { triggerWords: ['咖啡'] }),
  M('explicit', '用户明确说喜欢咖啡', old, { explicit: true, triggerWords: ['咖啡'] }),
  M('pinned', '重要咖啡记忆', old, { pinned: true, triggerWords: ['咖啡'] }),
]
eq(ids(recallRelevantMemories(ranked, '咖啡', { now })), ['pinned', 'explicit', 'normal'], '命中后沿用双源排序')

console.log('\n[B19-4] 旧数据没有 triggerWords 时本地派生，不调模型')
const derived = deriveMemoryTriggerWords('家里养了一只橘猫', '宠物')
ok(derived.length > 0 && derived.includes('宠物'), '旧条目能派生轻量触发词')
const legacy = M('legacy', '晚上怕黑会开灯', recent)
ok(recallRelevantMemories([legacy], '晚上关灯会害怕吗', { now }).length === 1, '旧条目仍可由文本派生触发')
const longUnthemed = M('color', '用户最喜欢的颜色是蓝色', recent)
ok(
  recallRelevantMemories([longUnthemed], '蓝色', { now }).some((item) => item.id === 'color'),
  '长句句尾关键实体不会被触发词截断丢失',
)

console.log('\n[B19-5] 不修改输入数组 / 非法输入安全')
const input = [
  M('a', '爱吃辣', recent, { triggerWords: ['辣'] }),
  M('b', '养猫', mid, { triggerWords: ['猫'] }),
]
const snapshot = JSON.stringify(input)
const result = recallRelevantMemories(input, '辣', { now })
ok(result !== input, '返回新数组')
ok(JSON.stringify(input) === snapshot, '输入数组未修改')
eq(recallRelevantMemories([], '猫', { now }), [], '空数组返回空')
eq(recallRelevantMemories(null, '猫', { now }), [], 'null 输入返回空')

console.log('\n[B19-6] 手动添加 explicit / 来源切换保持兼容')
memStore.clear()
let list = addMemoryItem('我不吃香菜', '饮食', true)
eq(list.length, 1, '手动添加一条')
eq(list[0].explicit, true, '手动添加可标 explicit=true')
eq(list[0].topic, '饮食', '主题保留')
list = setMemoryExplicit(list[0].id, false)
eq(list[0].explicit ?? false, false, '可切回推断来源')
list = setMemoryExplicit(list[0].id, true)
eq(list[0].explicit, true, '可再切回用户明说')

console.log('\n[记忆注入块] 日期与 USER 来源格式保持兼容')
const created = Date.parse('2026-09-17T17:29:23.000Z')
const blockItems = [
  { id: 'a', text: '对方已婚', createdAt: created, lastMentionedAt: created, explicit: true },
  { id: 'b', text: '对方没老公，未婚', createdAt: created + 5 * 60 * 1000, explicit: true },
]
const zhBlock = buildMemoryBlock(blockItems, 'zh')
const local = new Date(created)
const zhDate = `${local.getMonth() + 1}月${local.getDate()}日`
ok(!!zhBlock && zhBlock.includes(zhDate), '每条按运行环境本地时区展示记录日期')
ok(!!zhBlock && zhBlock.includes('每条附记录/最近提及日期'), '块首保留日期证据说明')
ok(!!zhBlock && zhBlock.includes('日期更新') && zhBlock.includes('来源更明确'), '冲突说明保留日期与来源证据')
ok(!!zhBlock && zhBlock.includes('[source=USER]'), '显式记忆标注 USER 来源')
ok(!zhBlock.includes('【') && !zhBlock.includes('你是'), '注入块无 marker / 人设规则口吻')
const undefinedDateBlock = buildMemoryBlock([{ id: 'c', text: '没有时间戳的记忆' }], 'zh')
ok(undefinedDateBlock.includes('（日期未知）'), '缺时间戳不编日期')
const enBlock = buildMemoryBlock([{ id: 'd', text: 'they like tea', createdAt: created }], 'en')
const yyyy = local.getFullYear()
const mm = String(local.getMonth() + 1).padStart(2, '0')
const dd = String(local.getDate()).padStart(2, '0')
ok(enBlock.includes(`${yyyy}-${mm}-${dd}`) && enBlock.includes('prefer the newer date'), '英文日期按运行环境本地时区')
ok(buildMemoryBlock([], 'zh') === null && buildMemoryBlock(null, 'zh') === null, '空列表不产出注入块')
ok(buildMemoryBlock([{ id: 'e', text: '   ' }], 'zh') === null, '全空白记忆不产出注入块')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
