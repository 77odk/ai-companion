// 人设模板数据自测（纯数据，Node 可直接跑）
// 跑法：node src/lib/personaTemplates.test.ts
import { applyRoleTemplatePersonality, ROLE_TEMPLATES } from './personaTemplates.ts'
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
ok(ROLE_TEMPLATES.length >= 8 && ROLE_TEMPLATES.length <= 15, '模板总数在 8–15 个之间')
eq(ROLE_TEMPLATES.length, 12, '当前首发 12 套模板')
const ids = ROLE_TEMPLATES.map((t) => t.id)
ok(new Set(ids).size === ids.length, 'id 唯一')
ok(ids.every((id) => id.trim() !== ''), 'id 非空')
eq(ROLE_TEMPLATES.filter((t) => t.featured).map((t) => t.id), ['general'], '仅通用模板标记为推荐')

console.log('\n[1b] 旧 5 张兼容元数据仍保留，但新模板库不会应用它们')
const expectedChars: Record<string, string> = {
  'gentle-boyfriend': '阿叙',
  bestie: '小满',
  'growth-partner': '阿光',
  'tsundere-cat': '阿凛',
  'energetic-partner': '阳阳',
}
const expectedGenders: Record<string, string> = {
  'gentle-boyfriend': 'male',
  bestie: 'female',
  'growth-partner': 'male',
  'tsundere-cat': 'male',
  'energetic-partner': 'male',
}
for (const [id, charName] of Object.entries(expectedChars)) {
  const t = ROLE_TEMPLATES.find((item) => item.id === id)
  ok(Boolean(t), `${id} 仍存在`)
  eq(t?.charName, charName, `${id}.charName 兼容旧流程`)
  eq(t?.gender, expectedGenders[id], `${id}.gender 兼容旧流程`)
}

console.log('\n[2] 每项展示字段与 persona 非空')
for (const t of ROLE_TEMPLATES) {
  ok(t.name.trim() !== '', `${t.id}.name 非空`)
  ok(t.tagline.trim() !== '', `${t.id}.tagline 非空`)
  ok(t.persona.trim() !== '', `${t.id}.persona 非空`)
}

console.log('\n[3] persona 红线与职责边界')
const ABSOLUTE_WORDS = ['必须', '永远', '从不', '禁止', '绝不']
const BASE_ONLY_WORDS = ['客服', '讨好', '鸡汤', '共同经历', '编造']
for (const t of ROLE_TEMPLATES) {
  ok(stripEmoji(t.persona) === t.persona, `${t.id} 无 emoji`)
  ok(!t.persona.includes('演'), `${t.id} 无「演」`)
  ok(!/^你是/m.test(t.persona), `${t.id} 不用「你是…」包装`)
  for (const w of ABSOLUTE_WORDS) {
    ok(!t.persona.includes(w), `${t.id} 无绝对词「${w}」`)
  }
  for (const w of BASE_ONLY_WORDS) {
    ok(!t.persona.includes(w), `${t.id} 不重复 Companion Base 规则「${w}」`)
  }
}

console.log('\n[4] 应用模板只替换 personality')
const original = {
  avatar: 'data:image/mock',
  nickname: '小七',
  remark: '只叫这个称呼',
  gender: 'female',
  personality: '原来的性格',
  background: '原来的关系背景',
  opening: '原来的开场第一句',
}
const picked = ROLE_TEMPLATES.find((t) => t.id === 'slow-burn')
ok(Boolean(picked), 'slow-burn 模板存在')
if (picked) {
  const applied = applyRoleTemplatePersonality(original, picked)
  eq(applied.personality, picked.persona, '只替换 personality')
  eq(applied.avatar, original.avatar, '头像不变')
  eq(applied.nickname, original.nickname, '姓名不变')
  eq(applied.remark, original.remark, '备注不变')
  eq(applied.gender, original.gender, '性别不变')
  eq(applied.background, original.background, '关系背景不变')
  eq(applied.opening, original.opening, '开场白不变')
  eq(original.personality, '原来的性格', '不修改原对象')
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) throw new Error(`personaTemplates.test 失败：${failed} 项未通过`)
