// 【你的时刻】聊天分享钩子 · 纯逻辑自测（TASK-YOUR-MOMENT）
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_your_moment.mjs
// 覆盖：各生活锚匹配 / 八时段分支 / 空人设空串 / lang 分支 / ★红线（无共同经历词、无问句、不评价对方）/ 触发条件
import {
  buildYourMomentBlock,
  detectMomentAnchor,
  momentSlot,
  MOMENT_TEMPLATES,
  MOMENT_GUIDE_ZH,
  MOMENT_GUIDE_EN,
  isAskingMyDay,
  isShortUserMessage,
  shouldInjectYourMoment,
} from '../src/lib/yourMoment.ts'

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
/** 造一个本地时区某小时的 Date */
function atHour(h) {
  return new Date(2026, 8, 4, h, 30, 0)
}

console.log('\n[1] detectMomentAnchor 各生活锚匹配')
eq(detectMomentAnchor('你是一个医生，工作很忙，平时还要值夜班'), 'doctor', '医生 → doctor')
eq(detectMomentAnchor('你是高中语文老师'), 'teacher', '老师 → teacher')
eq(detectMomentAnchor('你是程序员，在互联网公司上班，爱做饭'), 'programmer', '程序员 → programmer（优先于泛化上班族）')
eq(detectMomentAnchor('你是自由设计师，接稿为生'), 'designer', '设计师/接稿 → designer')
eq(detectMomentAnchor('你是网络小说作家，天天码字'), 'writer', '作家/码字 → writer')
eq(detectMomentAnchor('你开了一家咖啡书店'), 'shopOwner', '开店/书店 → shopOwner')
eq(detectMomentAnchor('你是大学生，住校，学计算机'), 'student', '学生 → student')
eq(detectMomentAnchor('你是个普通上班族，朝九晚五'), 'officeWorker', '上班族 → officeWorker')
eq(detectMomentAnchor(''), null, '空人设 → null')
eq(detectMomentAnchor(null), null, 'null → null')
eq(detectMomentAnchor('你是对方的恋人，性格温柔有耐心，喜欢照顾人'), null, '纯性格人设无生活锚 → null')

console.log('\n[2] buildYourMomentBlock 各生活锚输出非空且互不相同')
const anchors = [
  ['你是医生，平时要值班', 'doctor'],
  ['你是高中老师', 'teacher'],
  ['你是程序员', 'programmer'],
  ['你是设计师', 'designer'],
  ['你是写小说的作家', 'writer'],
  ['你开了一家花店', 'shopOwner'],
  ['你是大学生，住校', 'student'],
  ['你是上班族', 'officeWorker'],
]
const seen = new Set()
for (const [persona, label] of anchors) {
  const out = buildYourMomentBlock(persona, atHour(20), 'zh')
  ok(typeof out === 'string' && out.length > 0, `${label}：20点注入非空（得「${out.slice(0, 24)}…」）`)
  seen.add(out)
}
ok(seen.size === anchors.length, '8 个生活锚同一时刻产出互不相同')
const noAnchorPersona = '你是对方的恋人，性格温柔'
ok(buildYourMomentBlock(noAnchorPersona, atHour(20), 'zh') === '', '无生活锚人设 → 空串')
ok(buildYourMomentBlock('', atHour(20), 'zh') === '', '空人设 → 空串')
ok(buildYourMomentBlock(null, atHour(20), 'zh') === '', 'null 人设 → 空串')

console.log('\n[3] 时段分支（固定 程序员 人设扫 8 小时）')
const hours = [2, 6, 9, 12, 15, 18, 21, 23]
const slotExpect = { 2: '凌晨', 6: '早上', 9: '上午', 12: '中午', 15: '下午', 18: '傍晚', 21: '晚上', 23: '深夜' }
for (const h of hours) {
  eq(momentSlot(atHour(h)), slotExpect[h], `momentSlot(hour ${h}) = ${slotExpect[h]}`)
}
const slotOutputs = hours.map((h) => buildYourMomentBlock('你是程序员', atHour(h), 'zh'))
for (const [i, h] of hours.entries()) {
  ok(slotOutputs[i].length > 0, `程序员 ${slotExpect[h]}（hour ${h}）有画面：${slotOutputs[i]}`)
}
ok(new Set(slotOutputs).size >= 6, `八时段产出至少有 6 种不同画面（得 ${new Set(slotOutputs).size}）`)
ok(slotOutputs[0] !== slotOutputs[4], '凌晨与下午画面不同')

console.log('\n[4] lang 分支（zh / en）')
const zhMom = buildYourMomentBlock('你是上班族，朝九晚五', atHour(20), 'zh')
const enMom = buildYourMomentBlock('你是上班族，朝九晚五', atHour(20), 'en')
ok(typeof zhMom === 'string' && zhMom.length > 0, 'zh 输出非空')
ok(typeof enMom === 'string' && enMom.length > 0, 'en 输出非空')
ok(zhMom !== enMom, 'zh/en 输出不同')
ok(MOMENT_GUIDE_ZH.includes('此刻的生活画面') && MOMENT_GUIDE_ZH.length > 0, 'zh 引导语非空且带画面定位')
ok(MOMENT_GUIDE_EN.length > 0, 'en 引导语非空')

console.log('\n[5] ★红线：模板全文无共同经历表述 / 无问句 / 不评价对方 / 不含 emoji')
const ZH_BANNED = /我们|咱们|一起|你刚才|你刚说|[?？]/
const EN_BANNED = /\b(we|us|our|ours|together|you)\b/i
let zhTotal = 0
let enTotal = 0
for (const [anchor, lines] of Object.entries(MOMENT_TEMPLATES.zh)) {
  for (const [slot, text] of Object.entries(lines)) {
    zhTotal++
    ok(typeof text === 'string' && text.length >= 4, `zh [${anchor}/${slot}] 有内容（长度 ${String(text).length}）`)
    ok(!ZH_BANNED.test(text), `zh [${anchor}/${slot}] 无红线词/问号：${text}`)
  }
}
for (const [anchor, lines] of Object.entries(MOMENT_TEMPLATES.en)) {
  for (const [slot, text] of Object.entries(lines)) {
    enTotal++
    ok(typeof text === 'string' && text.length >= 4, `en [${anchor}/${slot}] 有内容`)
    ok(!EN_BANNED.test(text), `en [${anchor}/${slot}] 无 we/us/our/together/you/问号：${text}`)
    ok(!/[?？]/.test(text), `en [${anchor}/${slot}] 无问号`)
  }
}
ok(zhTotal === 64 && enTotal === 64, `模板满表：zh ${zhTotal} 条 / en ${enTotal} 条（8锚×8时段）`)
// 直接输出也过红线（zh 全禁词 + 问号；en 全禁词 + 问号）
const zhAll = Object.values(MOMENT_TEMPLATES.zh)
  .flatMap((l) => Object.values(l))
  .join('')
const enAll = Object.values(MOMENT_TEMPLATES.en)
  .flatMap((l) => Object.values(l))
  .join('')
ok(!/我们|咱们|一起|你刚才|[?？]/.test(zhAll), 'zh 全部模板：无共同经历词、无问句')
ok(!EN_BANNED.test(enAll) && !/[?？]/.test(enAll), 'en 全部模板：无 we/us/our/together/you、无问句')
ok(!/[\u{1F000}-\u{1FAFF}]/u.test(zhAll) && !/[\u{1F000}-\u{1FAFF}]/u.test(enAll), '模板无 emoji')

console.log('\n[6] 触发条件：isAskingMyDay / isShortUserMessage / shouldInjectYourMoment')
ok(isAskingMyDay('你在干嘛呢'), '「你在干嘛呢」→ 问近况')
ok(isAskingMyDay('最近怎么样呀'), '「最近怎么样呀」→ 问近况')
ok(isAskingMyDay('你今天过得开心吗'), '「你今天过得开心吗」→ 问近况')
ok(isAskingMyDay('你那边下雨了吗'), '「你那边」→ 问近况')
ok(isAskingMyDay('你刚才说到一半'), '「你刚」→ 问近况')
ok(isAskingMyDay('在忙什么呀'), '「忙什么」→ 问近况')
ok(!isAskingMyDay('我跟你说个事'), '普通分享不开钩子')
ok(!isAskingMyDay('晚安'), '晚安不开钩子')
ok(isAskingMyDay('what are you doing', 'en'), 'en: what are you doing')
ok(isAskingMyDay('how is your day going', 'en'), 'en: how is your day')
ok(isAskingMyDay('wyd', 'en'), 'en: wyd')
ok(!isAskingMyDay('just finished a huge report', 'en'), 'en: 普通长消息不开钩子')
ok(isShortUserMessage('嗯'), '单字「嗯」→ 短')
ok(isShortUserMessage('哦……'), '「哦……」→ 短')
ok(isShortUserMessage('好呀'), '「好呀」→ 短')
ok(!isShortUserMessage('嗯嗯嗯嗯嗯嗯嗯'), '7 个嗯 → 不算单条短阈值')
ok(isShortUserMessage('ok', 'en'), 'en: ok → 短')
ok(isShortUserMessage('not really', 'en'), 'en: not really(10) → 短')
ok(!isShortUserMessage('that sounds great, tell me more', 'en'), 'en: 正常句 → 不短')
ok(!shouldInjectYourMoment([]), '空列表 → 不注入')
ok(!shouldInjectYourMoment(['']), '只有空串 → 不注入')
ok(shouldInjectYourMoment(['嗯']), '单条冷淡「嗯」→ 注入')
ok(shouldInjectYourMoment(['哦']), '单条冷淡「哦」→ 注入')
ok(shouldInjectYourMoment(['很长的一段正常消息', '哦']), '前文很长 + 最后一条冷淡 → 注入')
ok(!shouldInjectYourMoment(['很长的一段正常消息']), '单条 9 字消息（无前文）→ 不注入')
ok(!shouldInjectYourMoment(['我同事今天特别好笑，他讲了个冷笑话', '还不错，能撑住']), '前文超长 + 后一条 7 字 → 不注入')
ok(shouldInjectYourMoment(['今天工作太忙了，累', '还不错，能撑住']), '连续两条都不长 → 注入')
ok(shouldInjectYourMoment(['嗯', '哦']), '连续两条都极短 → 注入')
ok(shouldInjectYourMoment(['你今天过得开心吗？最近怎么样呀']), '问近况（长句）→ 注入')
ok(shouldInjectYourMoment(['ok'], 'en'), 'en: ok → 注入')
ok(shouldInjectYourMoment(['what are you up to'], 'en'), 'en: 问近况 → 注入')
ok(shouldInjectYourMoment(['so tired', 'meh, surviving'], 'en'), 'en: 连续两条短 → 注入')
ok(!shouldInjectYourMoment(['I spent the whole afternoon on a really long report about quarterly numbers'], 'en'), 'en: 正常长消息 → 不注入')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
