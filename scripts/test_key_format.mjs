// key 格式检测（TASK_B）纯逻辑自测
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_key_format.mjs
// 覆盖：zhipu 遇 sk- 开头 / zhipu 数字格式通过 / deepseek 非 sk- / deepseek sk- 通过 /
//       openai 不检测 / custom 不检测 / 空 key 跳过 / 纯空白跳过

import { keyFormatHint } from '../src/lib/keyFormat.ts'

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

console.log('\n[1] 智谱：sk- / ark- 开头的 key 提示选错服务商')
const zhipuHint = keyFormatHint('zhipu', 'sk-abc123')
eq(zhipuHint, '这个 key 看着像别的平台的，智谱的 key 是数字开头的，是不是服务商选错了？', 'sk- 开头 → 返回智谱提示')
ok(typeof zhipuHint === 'string' && zhipuHint.includes('选错'), '提示文案包含「选错」')
eq(keyFormatHint('zhipu', 'ark-xxx'), zhipuHint, 'ark- 开头 → 同样提示')

console.log('\n[2] 智谱：数字格式的 key 通过（不提示）')
eq(keyFormatHint('zhipu', '1234567890.abcdef'), null, '数字.数字 格式 → null')
eq(keyFormatHint('zhipu', '42.x9'), null, '纯数字开头 → null')
eq(keyFormatHint('zhipu', 'abc'), null, '不以 sk- 开头 → null')

console.log('\n[3] DeepSeek：非 sk- 开头提示')
eq(keyFormatHint('deepseek', 'not-a-key'), 'DeepSeek 的 key 一般以 sk- 开头，确认没选错服务商？', '非 sk- 开头 → 返回 DeepSeek 提示')
eq(keyFormatHint('deepseek', '12345'), 'DeepSeek 的 key 一般以 sk- 开头，确认没选错服务商？', '数字开头 → 同样提示')

console.log('\n[4] DeepSeek：sk- 开头通过')
eq(keyFormatHint('deepseek', 'sk-abc123'), null, 'sk- 开头 → null')

console.log('\n[5] OpenAI / 自定义：不检测')
eq(keyFormatHint('openai', 'anything-here'), null, 'openai 任何 key → null')
eq(keyFormatHint('custom', 'anything-here'), null, 'custom 任何 key → null')

console.log('\n[5b] 火山豆包：ark- 开头通过，非 ark- 提示')
eq(keyFormatHint('volcengine', 'ark-4a958eb6-xxx'), null, 'ark- 开头 → null')
const vHint = keyFormatHint('volcengine', 'sk-abc')
ok(typeof vHint === 'string' && vHint.includes('ark-'), '非 ark- → 提示包含 ark-')
eq(keyFormatHint('volcengine', ''), null, '空串 → null')

console.log('\n[6] 空 key / 纯空白：不提示')
eq(keyFormatHint('zhipu', ''), null, '空串 → null')
eq(keyFormatHint('deepseek', ''), null, '空串 → null')
eq(keyFormatHint('zhipu', '   '), null, '纯空白 → null')
eq(keyFormatHint('deepseek', '  '), null, '纯空白 → null')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
