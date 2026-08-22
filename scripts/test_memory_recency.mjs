// 记忆活跃度排序（遗忘曲线）纯逻辑自测
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_memory_recency.mjs
// 覆盖：空/单条 / pinned 恒前 / 最近提起靠前 / 无 lastMentionedAt 兜底 createdAt / 稳定保序 / 未来时间戳钳制 / 非法条目过滤

import { getMemoryRecencyRank } from '../src/lib/memory.ts'

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

// 固定一个「今天」：2026-08-22，各条时间戳从它往过去推
const now = new Date(2026, 7, 22, 12, 0).getTime()
const DAY = 86400000
const tRecent = now - 1 * DAY // 1 天前
const tMid = now - 10 * DAY // 10 天前
const tOld = now - 40 * DAY // 40 天前
const tVeryOld = now - 90 * DAY // 90 天前

/** 造一条记忆：ts=createdAt，opts 里可带 pinned / lastMentionedAt / topic 等 */
function M(id, text, ts, opts = {}) {
  return {
    id,
    text,
    ...(ts != null ? { createdAt: ts } : {}),
    ...opts,
  }
}

console.log('\n[1] 空 / 单条 / 非法 / 不改输入')
eq(getMemoryRecencyRank([], now), [], '空数组')
eq(getMemoryRecencyRank(null, now), [], 'null 兜底为空')
eq(getMemoryRecencyRank([null, undefined, { id: 'x' }], now), [], '非法条目被过滤')
eq(getMemoryRecencyRank([M('a', '爱吃辣', tMid)], now), [M('a', '爱吃辣', tMid)], '单条无标记')
eq(getMemoryRecencyRank([M('a', '爱吃辣', tMid, { pinned: true })], now), [M('a', '爱吃辣', tMid, { pinned: true })], '单条 pinned')
const inputArr = [M('n1', 'A', tMid), M('n2', 'B', tRecent)]
ok(getMemoryRecencyRank(inputArr, now) !== inputArr, '返回新数组，不改动输入数组')

console.log('\n[2] 重要记忆（pinned）恒排最前')
const pinA = M('a', '爱吃辣', tOld, { pinned: true })
const pinB = M('b', '养猫', tMid, { pinned: true })
const c = M('c', '怕黑', tRecent)
eq(getMemoryRecencyRank([c, pinA, pinB], now), [pinA, pinB, c], 'pinned 全部在非 pinned 前')
eq(getMemoryRecencyRank([pinB, pinA, c], now), [pinB, pinA, c], '多个 pinned 保持原顺序')
const oldPin = M('d', '喜欢雨天', tVeryOld, { pinned: true, lastMentionedAt: tVeryOld })
const fresh = M('e', '刚记的新事', tRecent, { lastMentionedAt: tRecent })
eq(getMemoryRecencyRank([fresh, oldPin], now), [oldPin, fresh], 'pinned 即使很久没提也恒在最前')

console.log('\n[3] 最近提起/想起的靠前')
const x1 = M('x1', '记得 A', tVeryOld, { lastMentionedAt: tOld })
const x2 = M('x2', '记得 B', tVeryOld, { lastMentionedAt: tMid })
const x3 = M('x3', '记得 C', tVeryOld, { lastMentionedAt: tRecent })
eq(getMemoryRecencyRank([x1, x2, x3], now), [x3, x2, x1], '按 lastMentionedAt 降序')
eq(getMemoryRecencyRank([x3, x1, x2], now), [x3, x2, x1], '与输入顺序无关，仍按活跃度排')

console.log('\n[4] 没有 lastMentionedAt 的按 createdAt 降序兜底')
const y1 = M('y1', '记得 D', tOld)
const y2 = M('y2', '记得 E', tRecent)
const y3 = M('y3', '记得 F', tMid)
eq(getMemoryRecencyRank([y1, y2, y3], now), [y2, y3, y1], '按 createdAt 降序')

console.log('\n[5] 混合排序：最近提起 > 首次记录兜底')
const z1 = M('z1', '提起过的事', tVeryOld, { lastMentionedAt: tMid })
const z2 = M('z2', '没提起过的新事', tRecent)
const z3 = M('z3', '更早没提起的', tOld)
eq(getMemoryRecencyRank([z1, z2, z3], now), [z2, z1, z3], '有最近提起的与 createdAt 兜底混排')

console.log('\n[6] 没有任何时间戳的沉底')
const w1 = M('w1', '有时间戳', tOld)
const w2 = M('w2', '完全没有时间戳')
eq(getMemoryRecencyRank([w1, w2], now), [w1, w2], '有时间戳的在前面')
eq(getMemoryRecencyRank([w2, w1], now), [w1, w2], '无论输入顺序，无时间戳的沉底')

console.log('\n[7] 相同活跃度保持输入顺序（稳定排序）')
const v1 = M('v1', '同批提起 A', tOld, { lastMentionedAt: tMid })
const v2 = M('v2', '同批提起 B', tOld, { lastMentionedAt: tMid })
const v3 = M('v3', '同批提起 C', tOld, { lastMentionedAt: tMid })
eq(getMemoryRecencyRank([v1, v2, v3], now), [v1, v2, v3], '输入序 v1,v2,v3 → 输出不变')
eq(getMemoryRecencyRank([v3, v2, v1], now), [v3, v2, v1], '输入序 v3,v2,v1 → 输出不变')

console.log('\n[8] 未来时间戳钳到 now，不插队')
const u1 = M('u1', '刚刚被提起', tMid, { lastMentionedAt: now })
const u2 = M('u2', '未来时间戳', tMid, { lastMentionedAt: now + DAY * 5 })
eq(getMemoryRecencyRank([u1, u2], now), [u1, u2], '未来时间戳不会排到最前（与 now 打平）')
eq(getMemoryRecencyRank([u2, u1], now), [u2, u1], '未来时间戳与 now 打平后保持输入顺序')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
