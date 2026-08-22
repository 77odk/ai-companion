// 按需召回（recallRelevantMemories）纯逻辑自测
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_memory_recall.mjs
// 覆盖：pinned 恒在 / 主题命中 / 关键词命中 / 无命中兜底前5 / 空数组 / contextText 为空 / 命中排序 / 不修改输入数组
//      / 双源信任 explicit 排序 / 手动添加 explicit=true / setMemoryExplicit 切换

import { addMemoryItem, recallRelevantMemories, setMemoryExplicit } from '../src/lib/memory.ts'

// localStorage / window mock：Node 没有这两样，addMemoryItem / setMemoryExplicit 会用
// memory.ts 只在函数体内引用它们，import 之后、任何调用之前挂上即可
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

// 固定一个「今天」：2026-08-22，各条时间戳从今天往过去推
const now = new Date(2026, 7, 22, 12, 0).getTime()
const DAY = 86400000
const tRecent = now - 1 * DAY // 1 天前
const tMid = now - 10 * DAY // 10 天前
const tOld = now - 40 * DAY // 40 天前
const tVeryOld = now - 90 * DAY // 90 天前

/** 造一条记忆：ts=createdAt，opts 里可带 pinned / topic 等 */
function M(id, text, ts, opts = {}) {
  return {
    id,
    text,
    ...(ts != null ? { createdAt: ts } : {}),
    ...opts,
  }
}

console.log('\n[1] pinned 恒全量包含，且排最前')
const pin1 = M('pin1', '喜欢喝咖啡', tOld, { pinned: true })
const pin2 = M('pin2', '怕打雷', tVeryOld, { pinned: true })
const d1 = M('d1', '爱吃辣', tRecent, { topic: '饮食' })
const pet1 = M('pet1', '养猫', tMid, { topic: '宠物' })
const res1 = recallRelevantMemories([d1, pet1, pin1, pin2], '今天天气怎么样', { now })
ok(res1.some((m) => m.id === 'pin1') && res1.some((m) => m.id === 'pin2'), '无关话题下 pinned 也全量带上')
eq(ids(res1.slice(0, 2)), ['pin1', 'pin2'], 'pinned 恒排最前（组内保持原顺序）')
eq(ids(res1), ['pin1', 'pin2', 'd1', 'pet1'], '无关话题走兜底：pinned + 最活跃补齐')

console.log('\n[2] 主题命中：context 出现主题词 → 该主题全部记忆带上')
const res2 = recallRelevantMemories(
  [M('d1', '爱吃辣', tRecent, { topic: '饮食' }), M('pet1', '养猫', tRecent, { topic: '宠物' })],
  '今晚想吃点辣的',
  { now },
)
eq(ids(res2), ['d1'], '「吃/辣」命中饮食主题，只带饮食记忆')
const res2b = recallRelevantMemories(
  [M('d1', '爱吃辣', tRecent, { topic: '饮食' }), M('pet1', '养猫', tRecent, { topic: '宠物' })],
  '想给猫买猫粮',
  { now },
)
eq(ids(res2b), ['pet1'], '「猫」命中宠物主题，只带宠物记忆')

console.log('\n[3] 主题命中对无 topic 字段的旧数据也生效（inferTopic 推断）')
const res3 = recallRelevantMemories([M('d1', '爱吃辣', tRecent)], '今晚吃什么', { now })
eq(ids(res3), ['d1'], '旧数据没写主题，也能按内容推断出饮食并命中')

console.log('\n[4] 关键词命中：共同实词')
const res4 = recallRelevantMemories([M('o1', '怕黑，晚上不敢关灯', tMid, { topic: '其他' })], '晚上停电了吗', { now })
eq(ids(res4), ['o1'], '「晚上」共同实词命中')
const res4b = recallRelevantMemories([M('o1', '养了一只橘猫', tRecent, { topic: '其他' })], '猫', { now })
eq(ids(res4b), ['o1'], '单字实词「猫」也命中')

console.log('\n[5] 无共同实词不召回（相关命中时排除无关）')
const res5 = recallRelevantMemories(
  [M('wk1', '最近在赶项目', tRecent, { topic: '工作' }), M('o1', '喜欢雨天', tOld, { topic: '其他' })],
  '今天加班到很晚',
  { now },
)
eq(ids(res5), ['wk1'], '「加班」命中工作主题，「喜欢雨天」无关不带')

console.log('\n[6] 无命中兜底：最活跃的前 5 条')
const six = [
  M('a', '爱下雨', tOld, { topic: '其他' }),
  M('b', '怕黑', tMid, { topic: '其他' }),
  M('c', '养猫', tRecent, { topic: '其他' }),
  M('d', '吃辣', tVeryOld, { topic: '其他' }),
  M('e', '跑步', tRecent, { topic: '其他' }),
  M('f', '睡觉', tRecent, { topic: '其他' }),
]
const res6 = recallRelevantMemories(six, '好的呀', { now })
eq(ids(res6), ['c', 'e', 'f', 'b', 'a'], '一条没命中 → 取最活跃前 5（最旧的 d 被裁掉）')
const res6b = recallRelevantMemories(six, '好的呀', { now, fallbackCount: 2 })
eq(ids(res6b), ['c', 'e'], 'fallbackCount 可配置')

console.log('\n[7] contextText 为空 → 兜底')
const seven = [M('a', '爱下雨', tRecent, { topic: '其他' }), M('b', '怕黑', tMid, { topic: '其他' })]
eq(ids(recallRelevantMemories(seven, '', { now })), ['a', 'b'], '空 context 退化为最活跃前 N')

console.log('\n[8] 命中排序：pinned 最前 → 命中的按活跃度')
const pinA = M('pinA', '喜欢咖啡', tOld, { pinned: true })
const h1 = M('h1', '爱吃辣', tRecent, { topic: '饮食' })
const h2 = M('h2', '不吃香菜', tMid, { topic: '饮食' })
const h3 = M('h3', '爱喝奶茶', tVeryOld, { topic: '饮食' })
const res8 = recallRelevantMemories([h3, h1, pinA, h2], '今晚吃什么', { now })
eq(ids(res8), ['pinA', 'h1', 'h2', 'h3'], 'pinned 最前，命中的饮食记忆按活跃度降序')
const res8b = recallRelevantMemories([h3, h1, h2], '今晚吃什么', { now })
eq(ids(res8b), ['h1', 'h2', 'h3'], '无 pinned 时命中之间也按活跃度')

console.log('\n[9] 空 / 非法输入')
eq(recallRelevantMemories([], '今天吃什么', { now }), [], '空数组返回空')
eq(recallRelevantMemories(null, '今天吃什么', { now }), [], 'null 兜底为空')
eq(recallRelevantMemories([null, { id: 'x' }], '今天吃什么', { now }), [], '非法条目被过滤')

console.log('\n[10] 不修改输入数组')
const inputArr = [M('a', '爱吃辣', tRecent, { topic: '饮食' }), M('b', '养猫', tMid, { topic: '宠物' })]
const snapshot = JSON.stringify(inputArr)
const res10 = recallRelevantMemories(inputArr, '今晚吃什么', { now })
ok(res10 !== inputArr, '返回新数组，不是原引用')
ok(JSON.stringify(inputArr) === snapshot, '输入数组内容未被改动')

console.log('\n[11] pinned 数量超过兜底条数仍全量')
const pins = [1, 2, 3, 4, 5, 6].map((n) => M(`p${n}`, `记${n}`, tOld, { pinned: true }))
const res11 = recallRelevantMemories(pins, '随便聊聊', { now, fallbackCount: 2 })
eq(ids(res11), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], '6 条 pinned 全带，不被兜底条数截断')

console.log('\n[12] 双源信任：explicit（用户明说的）排非 pinned 前')
// 主题命中路径：explicit 与非 explicit 都命中 → explicit 靠前（即使非 explicit 更活跃）
const eA = M('eA', '养猫', tMid, { topic: '宠物', explicit: true })
const rA = M('rA', '养狗', tRecent, { topic: '宠物' })
eq(ids(recallRelevantMemories([rA, eA], '想养猫', { now })), ['eA', 'rA'], '主题命中时 explicit 在非 pinned 前')
// 兜底路径：pinned 恒前 → explicit 次之 → 其余按活跃度
const pinX = M('pinX', '怕黑', tOld, { pinned: true })
eq(ids(recallRelevantMemories([rA, eA, pinX], '随便聊聊', { now })), ['pinX', 'eA', 'rA'], '兜底：pinned → explicit → 其余按活跃度')
// 无 pinned 时 explicit 仍靠前，非 explicit 靠后
eq(ids(recallRelevantMemories([rA, eA], '随便聊聊', { now })), ['eA', 'rA'], '无 pinned 时 explicit 仍排前，非 explicit 靠后')
// explicit 之间仍按活跃度
const eB = M('eB', '爱喝奶茶', tRecent, { topic: '饮食', explicit: true })
const eC = M('eC', '不吃香菜', tOld, { topic: '饮食', explicit: true })
eq(ids(recallRelevantMemories([eC, eB], '今晚吃什么', { now })), ['eB', 'eC'], 'explicit 之间仍按活跃度降序')

console.log('\n[13] 手动添加 explicit=true / setMemoryExplicit 切换')
memStore.clear()
let list = addMemoryItem('我不吃香菜', '饮食', true)
eq(list.length, 1, '手动添加（带 explicit=true）返回一条')
eq(list[0].explicit, true, '手动添加自动带 explicit=true')
eq(list[0].topic, '饮食', '主题保留')
eq(list[0].text, '我不吃香菜', '内容保留')
memStore.clear()
const auto = addMemoryItem('TA 从聊天里推断的', '其他')
eq(auto[0].explicit ?? false, false, '不带 explicit 参数 = 缺省推断（不标 explicit）')
memStore.clear()
list = addMemoryItem('我叫小七', '其他', true)
list = setMemoryExplicit(list[0].id, false)
eq(list[0].explicit ?? false, false, 'setMemoryExplicit 可把来源切回 TA 推断')
eq(list.length, 1, 'setMemoryExplicit 不改动条数')
list = setMemoryExplicit(list[0].id, true)
eq(list[0].explicit, true, 'setMemoryExplicit 可再切回用户明说')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
