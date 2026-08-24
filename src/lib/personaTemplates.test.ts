// 角色模板数据自测（纯数据，Node 可直接跑）
// 跑法：node src/lib/personaTemplates.test.ts
import { ROLE_TEMPLATES } from './personaTemplates.ts'
import { stripEmoji } from './api.ts'

let passed = 0
let failed = 0

function ok(cond: boolean, name: string): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}

function eq(actual: unknown, expected: unknown, name: string): void {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  ok(a === b, `${name}（得 ${a}，期望 ${b}）`)
}

console.log('\n[1] ROLE_TEMPLATES 基础结构')
eq(ROLE_TEMPLATES.length, 5, '恰好 5 套模板')
const ids = ROLE_TEMPLATES.map((t) => t.id)
ok(new Set(ids).size === ids.length, 'id 唯一')
ok(ids.every((id) => id.trim() !== ''), 'id 非空')

console.log('\n[2] 每项字段非空')
for (const t of ROLE_TEMPLATES) {
  ok(t.name.trim() !== '', `${t.id}.name 非空`)
  ok(t.tagline.trim() !== '', `${t.id}.tagline 非空`)
  ok(t.persona.trim() !== '', `${t.id}.persona 非空`)
}

console.log('\n[3] persona 不包含 emoji / 「演」 / 绝对指令词')
const ABSOLUTE_WORDS = ['必须', '永远', '从不', '禁止', '绝不']
for (const t of ROLE_TEMPLATES) {
  ok(stripEmoji(t.persona) === t.persona, `${t.id} 无 emoji`)
  ok(!t.persona.includes('演'), `${t.id} 无「演」`)
  for (const w of ABSOLUTE_WORDS) {
    ok(!t.persona.includes(w), `${t.id} 无绝对词「${w}」`)
  }
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) throw new Error(`personaTemplates.test 失败：${failed} 项未通过`)
