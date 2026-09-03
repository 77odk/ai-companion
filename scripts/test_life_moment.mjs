// 聊天提示词 · 生活素材钩子 + 分寸规则自测（2026-09-04 七七拍板：TA 要有自己的生活、会主动分享）
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_life_moment.mjs
// 覆盖：buildLifeMoment 时段锚点 / 有人设分支注入【你的此刻】/ FLOW_RULE 分享升级（不再是"冷场才能说"）

import { buildLifeMoment, buildSystemPrompt } from '../src/lib/api.ts'

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

console.log('\n[1] buildLifeMoment 时段锚点（白天有日子过，深夜有没睡的理由）')
const morning = buildLifeMoment(new Date(2026, 8, 4, 8, 30).getTime())
ok(morning.includes('【你的此刻】'), '含【你的此刻】标题')
ok(morning.includes('一天刚开始') || morning.includes('白天是你的时间'), '早晨给「一天刚开始/白天忙」锚点')
ok(morning.includes('8点30'), '含具体时刻 8点30')
const day = buildLifeMoment(new Date(2026, 8, 4, 14, 5).getTime())
ok(day.includes('白天是你的时间'), '下午给「白天是你的时间」锚点')
const night = buildLifeMoment(new Date(2026, 8, 4, 21, 0).getTime())
ok(night.includes('一天快收尾了'), '晚上给「收尾」锚点')
const late = buildLifeMoment(new Date(2026, 8, 4, 1, 30).getTime())
ok(late.includes('夜深了') && late.includes('没睡的理由'), '深夜给「没睡的理由」锚点')
const late2 = buildLifeMoment(new Date(2026, 8, 4, 23, 45).getTime())
ok(late2.includes('夜深了'), '23:45 也算深夜')
ok(morning.includes('有依据才说'), '红线：共同经历必须有依据才说')
ok(!morning.includes('{'), '无残留占位符')

console.log('\n[2] 有人设分支注入【你的此刻】+ 分享分寸（FLOW_RULE v2）')
const withPersona = buildSystemPrompt('你是温柔男友，爱做饭，最近在学一道新菜', '小忆', new Date(2026, 8, 4, 20, 0).getTime())
ok(withPersona.includes('【你的此刻】'), '有人设时注入【你的此刻】')
ok(withPersona.includes('你也有自己的日子要过'), 'FLOW_RULE v2：分享是日常权利（不再是冷场才说）')
ok(withPersona.includes('对方说加班累，你也能说你刚忙完'), '分寸示例：有来有往的分享')
ok(withPersona.includes('盘问不像真人'), '仍禁止盘问')
ok(withPersona.includes('对方在倾诉'), '对方倾诉时你的故事让路')
ok(withPersona.includes('更不是冷场了才能说'), '明确否定「冷场才能分享」（分享=日常权利）')
ok(withPersona.includes('学一道新菜'), '人设原文保留')

console.log('\n[3] 无人设分支不注入【你的此刻】')
const noPersona = buildSystemPrompt('', '小忆', new Date(2026, 8, 4, 20, 0).getTime())
ok(!noPersona.includes('【你的此刻】'), '无人设时没有生活锚（无从长起，不硬编）')
ok(noPersona.includes('分寸·像真人一样说话'), '无人设仍带分寸框架（FLOW_RULE 两分支都注入）')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
