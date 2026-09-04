// 聊天提示词 · 精简版提示词自测（2026-09-04 豆包版：10层压6层，CHAT_RULES 4句人话）
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_life_moment.mjs
// 覆盖：CHAT_RULES 4 句人话语义 / 有人设分支精简注入 / 无人设分支兜底 / 记忆规则仍在

import { buildSystemPrompt } from '../src/lib/api.ts'

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

console.log('\n[1] 有人设分支：精简注入（人设 + 名字 + CHAT_RULES，无堆砌）')
const withPersona = buildSystemPrompt('你是温柔男友，爱做饭，最近在学一道新菜', '小忆', new Date(2026, 8, 4, 20, 0).getTime())
ok(withPersona.includes('爱做饭，最近在学一道新菜'), '人设原文保留')
ok(withPersona.includes('你的名字叫「小忆」'), '名字注入保留')
ok(withPersona.includes('【聊天规矩】'), '含精简后的聊天规矩')
ok(withPersona.includes('你是活人不是AI'), '规矩1：不承认AI')
ok(withPersona.includes('不知道的事就说不知道'), '规矩1：不编不圆')
ok(withPersona.includes('像真人微信聊天'), '规矩2：像真人说话')
ok(withPersona.includes('你有自己的日子在过'), '规矩3：有自己的生活')
ok(withPersona.includes('带具体细节'), '规矩3：分享带画面')
ok(withPersona.includes('对方冷淡回嗯哦…，就递个有画面的事续话'), '规矩4：冷淡时递钩子')
ok(withPersona.includes('【记忆规则】') || withPersona.includes('记忆规则：'), '记忆规则仍在')
// 精简验证：不该有的堆砌都不在
ok(!withPersona.includes('【你的此刻】'), '无【你的此刻】段')
ok(!withPersona.includes('【按设定说话】'), '无【按设定说话】段')
ok(!withPersona.includes('【底线·永远遵守】'), '无旧【底线】段')
ok(!withPersona.includes('【分寸·像真人一样说话】'), '无旧【分寸】段')
ok(!withPersona.includes('【示范·照这个感觉说话】'), '无示范对话')
ok(!withPersona.includes('不承认、不解释、不科普'), '无旧啰嗦措辞')

console.log('\n[2] 无人设分支：兜底身份 + CHAT_RULES')
const noPersona = buildSystemPrompt('', '小忆', new Date(2026, 8, 4, 20, 0).getTime())
ok(noPersona.includes('你是对方的人'), '无人设兜底身份在')
ok(noPersona.includes('【聊天规矩】'), '无人设也带聊天规矩')
ok(noPersona.includes('对方怎么叫你，你就是谁'), '兜底身份原文')

console.log('\n[3] 认识天数 + 纪念日 + 时间仍在（Node 无 localStorage 时认识天数段为空属正常，函数不崩即可）')
ok(typeof buildSystemPrompt('你是温柔男友', '小忆', new Date(2026, 8, 4, 20, 0).getTime()) === 'string', 'buildSystemPrompt 正常返回字符串')
ok(buildSystemPrompt('你是温柔男友', '小忆', new Date(2026, 8, 4, 20, 0).getTime()).includes('此刻时间'), '时间上下文仍在')
ok(buildSystemPrompt('你是温柔男友', '小忆', new Date(2026, 8, 4, 20, 0).getTime()).length < 1100, `提示词总长 <1100（得 ${buildSystemPrompt('你是温柔男友', '小忆', new Date(2026, 8, 4, 20, 0).getTime()).length}）`)

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
