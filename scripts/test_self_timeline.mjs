// 自我时间线 · 纯逻辑自测（TASK-SELF-TIMELINE）
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_self_timeline.mjs
// 覆盖：formatAgo 时间差 / buildSelfTimelineBlock 引用最近 TA 自己的话 / 清洗 / 截断 / 角色过滤 / 空输入
import { buildSelfTimelineBlock, formatAgo } from '../src/lib/selfTimeline.ts'
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
function has(str, sub, name) {
  ok(str.includes(sub), name)
}
console.log('[1] formatAgo 时间差标注')
ok(formatAgo(undefined, 1000) === '', 'ts 缺失 → 空串')
ok(formatAgo(0, 1000) === '', 'ts 非法 → 空串')
ok(formatAgo(5000, 1000) === '', 'ts 在未来（负差）→ 空串')
ok(formatAgo(1000, 1000) === '刚刚', '0 秒差 → 刚刚')
ok(formatAgo(1000, 59000) === '刚刚', '59 秒差 → 刚刚')
ok(formatAgo(1000, 61000) === '1分钟前', '1 分钟 → N分钟前')
ok(formatAgo(1000, 5 * 60000 + 1000) === '5分钟前', '5 分钟 → 5分钟前')
ok(formatAgo(1000, 59 * 60000 + 1000) === '59分钟前', '59 分钟 → 59分钟前')
ok(formatAgo(1000, 60 * 60000 + 1000) === '1小时前', '1 小时 → N小时前')
ok(formatAgo(1000, 3 * 3600000 + 1000) === '3小时前', '3 小时 → 3小时前')
ok(formatAgo(1000, 25 * 3600000) === '1天前', '25 小时 → 1天前')
console.log('[2] buildSelfTimelineBlock 空输入 / 角色过滤')
ok(buildSelfTimelineBlock([]) === '', '空数组 → 空串')
ok(buildSelfTimelineBlock(undefined) === '', 'undefined → 空串')
ok(
  buildSelfTimelineBlock([{ role: 'user', content: '你去洗碗吧', ts: 1000 }]) === '',
  '只有 user 消息 → 空串（不引用对方的话）',
)
ok(
  buildSelfTimelineBlock([{ role: 'assistant', content: '   ', ts: 1000 }]) === '',
  'assistant 消息全空白 → 空串',
)
console.log('[3] 引用 TA 刚说过的话 + 时间标注')
const now = 10 * 60000 // 第 10 分钟
const msgs = [
  { role: 'user', content: '你去洗碗吧', ts: 0 },
  { role: 'assistant', content: '行，我先去把碗洗了。', ts: 1 * 60000 }, // 9 分钟前
  { role: 'user', content: '好', ts: 2 * 60000 },
  { role: 'assistant', content: '碗洗好了，手有点凉。', ts: 9 * 60000 }, // 1 分钟前
]
const block = buildSelfTimelineBlock(msgs, now)
console.log('  产出：\n' + block)
has(block, '9分钟前', '含 9分钟前 标注')
has(block, '1分钟前', '含 1分钟前 标注')
has(block, '你说过：行，我先去把碗洗了', '原样引用 TA 说过的话（不推断结果）')
has(block, '你说过：碗洗好了，手有点凉', '引用最近一条')
ok(!block.includes('你去洗碗吧'), '不引用 user 的话')
ok(!block.includes('【记忆'), '已清洗记忆标记')
console.log('[4] 只取最近 3 条 TA 自己的话')
const many = []
for (let i = 0; i < 8; i++) {
  many.push({ role: 'assistant', content: `第${i}句`, ts: i * 1000 })
  many.push({ role: 'user', content: `用户${i}`, ts: i * 1000 })
}
const blockMany = buildSelfTimelineBlock(many, 100000)
ok(blockMany.includes('第5句'), '第 5 句在（最近 3 条之一）')
ok(blockMany.includes('第7句'), '第 7 句在（最新）')
ok(!blockMany.includes('第4句'), '第 4 句被挤出（只保留最近 3 条 TA 的话）')
const lineCount = blockMany.split('\n').filter((l) => l.startsWith('- ')).length
ok(lineCount === 3, `恰好 3 行引用（实际 ${lineCount}）`)
console.log('[5] 清洗动作标记 + 截断 60 字')
const dirty = {
  role: 'assistant',
  content: '（心里想着）刚煮了碗面*热气腾腾*，还有一段很长的描述要用来测试截断是否生效超过六十个字符的限制内容继续补足',
  ts: 1000,
}
const blockDirty = buildSelfTimelineBlock([dirty], 100000)
has(blockDirty, '刚煮了碗面', '动作标记（括号/星号）被清洗，正文保留')
for (const line of blockDirty.split('\n').filter((l) => l.startsWith('- '))) {
  const body = line.replace(/^- .*?你说过：/, '')
  ok(body.length <= 60, `引用截断到 60 字内（实际 ${body.length}）`)
}
console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
