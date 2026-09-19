// 回复卫生自测：时间标签硬过滤（stripTimeLabels）+ 去复读（dropRepeatedReplies）
// 跑法：node scripts/test_reply_hygiene.mjs
// 背景（2026-09-19 生产库实据）：
//   · 2315495967 / 1625638072 两个用户的 TA 回复开头漏出 [3 分钟前]、[此刻]；
//   · 「我正在吃早餐呢，等下还得去图书馆把论文改完，下午可能去湖边坐坐。」09:45/09:46/09:47 原样三连。
import { stripActionMarkers, stripTimeLabels } from '../src/lib/chatPrompts.ts'
import { dropRepeatedReplies, MIN_DUP_LEN } from '../src/lib/replyDedupe.ts'

let pass = 0
let fail = 0
const eq = (name, got, want) => {
  if (got === want) { pass++; return }
  fail++
  console.log(`FAIL ${name}\n  got : ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`)
}
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; return }
  fail++
  console.log(`FAIL ${name} ${extra}`)
}

// ---- stripTimeLabels：开头标签 ----
eq('开头 [3 分钟前]', stripTimeLabels('[3 分钟前] 真要睡就早点。'), '真要睡就早点。')
eq('开头 [此刻]', stripTimeLabels('[此刻] 好了，要不要说说看？'), '好了，要不要说说看？')
eq('开头多个标签', stripTimeLabels('[3 分钟前] [此刻] 嗯。'), '嗯。')
eq('全角括号 【2 小时前】', stripTimeLabels('【2 小时前】刚到家'), '刚到家')
eq('英文 [3 min ago]', stripTimeLabels('[3 min ago] Just got home'), 'Just got home')
eq('英文 [1 hour ago]', stripTimeLabels('[1 hour ago] I was reading'), 'I was reading')
eq('开头无标签不动', stripTimeLabels('刚窝着呢，正看书。'), '刚窝着呢，正看书。')
eq('整条只有标签 → 空', stripTimeLabels('[3 分钟前]'), '')
eq('标签在第二条气泡开头', stripTimeLabels('行，那你先看书。\n[3 分钟前] 我在吃早餐呢。'), '行，那你先看书。\n我在吃早餐呢。')
eq('正文里的方括号不误伤', stripTimeLabels('[图片] 你看这个'), '[图片] 你看这个')
eq('空串安全', stripTimeLabels(''), '')

// ---- stripActionMarkers 现在也带时间标签 ----
eq('动作旁白链同时剥时间标签', stripActionMarkers('（转身）[5 分钟前] 好'), '好')

// ---- dropRepeatedReplies ----
const dupLine = '我正在吃早餐呢，等下还得去图书馆把论文改完，下午可能去湖边坐坐。'
const hist = [
  { role: 'user', content: '今天周末 你打算做什么' },
  { role: 'assistant', content: dupLine },
  { role: 'user', content: '我会吃完午饭再去游泳' },
]
const out1 = dropRepeatedReplies([{ content: dupLine }, { content: '你午饭打算吃什么？' }], hist)
eq('整条重复的气泡被丢掉', out1.length, 1)
eq('留下的是新内容', out1[0].content, '你午饭打算吃什么？')
eq('顺序不变', out1[0].content.startsWith('你午饭'), true)

const out2 = dropRepeatedReplies([{ content: dupLine }], hist)
eq('本轮全是重复 → 原样保留（不吞回复）', out2.length, 1)

const out3 = dropRepeatedReplies([{ content: '嗯。' }, { content: '好' }], hist)
eq('短句不判重', out3.length, 2)

const out4 = dropRepeatedReplies([{ content: dupLine + '。' }], hist)
eq('尾部标点差异也算重复', out4.length, 1)

const out5 = dropRepeatedReplies([{ content: '这是一句全新的话，之前没说过。' }], hist)
eq('新内容不动', out5.length, 1)

const out6 = dropRepeatedReplies([{ content: dupLine }], [])
eq('没有历史时不判重', out6.length, 1)

const out7 = dropRepeatedReplies([{ content: ' ' + dupLine + ' ' }], hist)
eq('空白差异也算重复', out7.length, 1)

ok('MIN_DUP_LEN 是正数', MIN_DUP_LEN > 0)

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass}/${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
