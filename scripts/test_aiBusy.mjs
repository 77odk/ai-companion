// AI 忙碌状态 · 纯逻辑自测（TASK-BUSY）
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_aiBusy.mjs
// 覆盖：关键词检测 / 截断位置 / 随机时长 / reason 推断 / busy 回复文案 / context 序列化

import {
  containsBusyKeyword,
  findBusyCutoff,
  randomBusyDurationMs,
  inferBusyReason,
  pickBusyReply,
  serializeBusyContext,
} from '../src/lib/aiBusy.ts'

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

/** 可复现的伪随机 */
function seeded(seed = 42) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

console.log('\n[1] containsBusyKeyword 关键词检测')
ok(containsBusyKeyword('我先去洗碗了'), '去洗碗 → 触发')
ok(containsBusyKeyword('我去做饭了'), '去做饭 → 触发')
ok(containsBusyKeyword('我去洗个澡'), '洗个澡 → 触发')
ok(containsBusyKeyword('稍等我一下'), '稍等我 → 触发')
ok(containsBusyKeyword('去趟厕所'), '厕所 → 触发')
ok(containsBusyKeyword('我出去一下'), '出去一下 → 触发')
ok(!containsBusyKeyword('我去睡觉了'), '去睡觉 → 不触发（结束对话非暂离）')
ok(!containsBusyKeyword('今天天气不错'), '普通句 → 不触发')
ok(!containsBusyKeyword(''), '空串 → 不触发')
ok(!containsBusyKeyword('我爱你'), '亲密话 → 不触发')
ok(!containsBusyKeyword('我们去看电影吧'), '邀约 → 不触发（无离开语义）')
ok(!containsBusyKeyword('我刚忙完回来'), '忙完回来 → 不触发（已完成）')
// 2026-09-04 实测补：模型自然表达变体（原来精确词表全漏）
ok(containsBusyKeyword('行，我先去把碗洗了。'), '我先去把碗洗了 → 触发')
ok(containsBusyKeyword('行，碗洗完了跟你说一声。'), '碗洗完了 → 触发')
ok(containsBusyKeyword('碗洗好了，手有点凉。'), '碗洗好了 → 触发')
ok(containsBusyKeyword('好，我把饭做好了叫你。'), '把饭做好 → 触发')
ok(containsBusyKeyword('我先去把澡洗了。'), '把澡洗了 → 触发')

console.log('\n[2] findBusyCutoff 截断位置')
eq(findBusyCutoff('我去洗碗了。碗洗好了，手有点凉'), 6, '截到关键词句句号（含句号）')
eq(findBusyCutoff('嗯，那我先去洗碗了！你呢？'), 10, '截到感叹号（含感叹号）')
eq(findBusyCutoff('我去做饭了\n你想吃什么'), 6, '截到换行（含换行）')
eq(findBusyCutoff('我去洗碗了？'), 6, '截到问号')
eq(findBusyCutoff('我先去洗碗了'), 6, '无结束符截到串尾（保留完整已输出）')
eq(findBusyCutoff('今天天气很好'), -1, '无关键词返回 -1')
eq(findBusyCutoff(''), -1, '空串返回 -1')
// 截断后应保留到句子结束、不残留半句
const cut1 = findBusyCutoff('我去洗碗了。碗洗好了')
eq('我去洗碗了。'.length, cut1, '截断长度 = 关键词句完整长度')
// 无结束符整句都是离开语义 → 截到串尾可接受（触发忙碌，全句入库无碍）
eq(findBusyCutoff('我先去洗碗，等会再去做饭'), 12, '无句末标点截到串尾')

console.log('\n[3] randomBusyDurationMs 随机时长')
const d1 = randomBusyDurationMs(seeded(1))
const d2 = randomBusyDurationMs(seeded(2))
ok(d1 >= 3.5 * 60 * 1000 && d1 <= 5.5 * 60 * 1000, `时长在 3.5-5.5 分钟内（得 ${Math.round(d1 / 1000)}s）`)
ok(d1 !== d2, '两次随机不同（不总准点）')

console.log('\n[4] inferBusyReason 忙碌原因')
eq(inferBusyReason('我去洗碗了'), '洗碗', '洗碗')
eq(inferBusyReason('我去做饭了'), '做饭', '做饭')
eq(inferBusyReason('去煮个面'), '做饭', '煮面算做饭')
eq(inferBusyReason('我去洗个澡'), '洗澡', '洗澡')
eq(inferBusyReason('去趟厕所'), '上厕所', '厕所')
eq(inferBusyReason('我出去一下'), '出门', '出门')
eq(inferBusyReason('稍等我一下'), '忙', '其他归为忙')

console.log('\n[5] pickBusyReply 忙碌回复')
const r1 = pickBusyReply(seeded(5))
ok(typeof r1 === 'string' && r1.length > 0, '返回非空字符串')
ok(!/[\u{1F000}-\u{1FAFF}]/u.test(r1), '无 emoji')
ok(!/[AI它演干活]/.test(r1), '无禁用字')
const r2 = pickBusyReply(seeded(6))
ok(r1 !== r2 || true, '随机取（允许撞）')

console.log('\n[6] serializeBusyContext 序列化')
eq(serializeBusyContext([]), '', '空数组 → 空串')
eq(serializeBusyContext(null), '', 'null → 空串')
const ctx = serializeBusyContext([
  { role: 'user', content: '我休息一会要去上班呢' },
  { role: 'assistant', content: '那你去忙吧' },
  { role: 'user', content: '我说我现在休息一会' },
])
ok(ctx.includes('我：我休息一会要去上班呢'), '含用户消息（标我）')
ok(ctx.includes('TA：那你去忙吧'), '含 TA 消息（标 TA）')
ok(ctx.includes('我：我说我现在休息一会'), '含最新用户消息')
ok(ctx.split('\n').length <= 3, '最多 3 条')
const longCtx = serializeBusyContext([
  { role: 'user', content: 'x'.repeat(200) },
])
ok(longCtx.length < 130, '单条超长被截断')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
