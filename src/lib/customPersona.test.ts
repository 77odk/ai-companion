// 自定义人设拼接逻辑自测（纯函数，Node 可直接跑）
// 跑法：node src/lib/customPersona.test.ts
import { buildCustomPersona, extractOpeningLine, isCustomPersonaValid } from './customPersona.ts'

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

console.log('\n[1] buildCustomPersona 四项全填 → 四行齐全')
eq(
  buildCustomPersona({
    nickname: '小乔',
    personality: '温柔理智、嘴硬心软',
    background: '我们是青梅竹马，从小一起长大',
    opening: '嗨，终于等到你',
  }),
  '角色昵称：小乔\n性格特质：温柔理智、嘴硬心软\n关系背景：我们是青梅竹马，从小一起长大\n初次见面开场白：嗨，终于等到你',
  '四项全填 → 四行齐全、顺序固定',
)

console.log('\n[2] buildCustomPersona 部分为空 → 对应行删掉')
eq(
  buildCustomPersona({ personality: '毒舌但关心人' }),
  '性格特质：毒舌但关心人',
  '只填性格 → 只有性格行',
)
eq(
  buildCustomPersona({ nickname: '阿乔', personality: '话少' }),
  '角色昵称：阿乔\n性格特质：话少',
  '昵称+性格 → 两行，其余行删掉',
)
eq(
  buildCustomPersona({ personality: '温柔', opening: '你好呀' }),
  '性格特质：温柔\n初次见面开场白：你好呀',
  '性格+开场白 → 两行，关系背景行删掉',
)
eq(
  buildCustomPersona({ nickname: '   ', personality: '  温柔  ', background: '  ', opening: '你好' }),
  '性格特质：温柔\n初次见面开场白：你好',
  '全空格条目不写入，内容自动 trim',
)

console.log('\n[3] buildCustomPersona 全空 → 空串，不抛错（校验交给 UI 层）')
eq(buildCustomPersona({ personality: '' }), '', '性格空 → 空串')
eq(buildCustomPersona({ personality: '', nickname: '', background: '', opening: '' }), '', '四项全空 → 空串')

console.log('\n[4] extractOpeningLine 开场白解析')
eq(
  extractOpeningLine('性格特质：温柔\n初次见面开场白：嗨，我是阿乔\n关系背景：同事'),
  '嗨，我是阿乔',
  '有开场白行 → 返回内容',
)
eq(extractOpeningLine('性格特质：温柔\n关系背景：同事'), '', '无开场白行 → 空串')
eq(extractOpeningLine(''), '', '空 persona → 空串')
eq(extractOpeningLine('初次见面开场白：'), '', '标签在但内容为空 → 空串')
eq(extractOpeningLine(' 初次见面开场白：你好 '), '你好', '行首空白也算整行，内容 trim')
eq(extractOpeningLine('这段话中间夹着初次见面开场白：你好，但不在行首'), '', '不在行首不命中')

console.log('\n[5] isCustomPersonaValid 性格必填校验')
eq(isCustomPersonaValid({ personality: '' }), false, '性格空 → false')
eq(isCustomPersonaValid({ personality: '   ' }), false, '性格纯空格 → false')
eq(isCustomPersonaValid({ personality: '温柔' }), true, '性格有内容 → true')
eq(isCustomPersonaValid({}), false, '缺性格字段 → false')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) throw new Error(`customPersona.test 失败：${failed} 项未通过`)
