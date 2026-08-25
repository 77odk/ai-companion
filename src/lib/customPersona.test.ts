// 自定义人设拼接逻辑自测（纯函数，Node 可直接跑）
// 跑法：node src/lib/customPersona.test.ts
import {
  buildCustomPersona,
  extractOpeningLine,
  isCustomPersonaValid,
  extractPersonality,
  extractBackgroundLine,
  applyPersonaEdits,
} from './customPersona.ts'

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

console.log('\n[6] extractPersonality / extractBackgroundLine（资料卡显示用）')
eq(extractPersonality('性格特质：温柔\n关系背景：同事'), '温柔', '结构化 → 取性格行内容')
eq(extractPersonality('角色昵称：阿温\n性格特质：温柔理智\n关系背景：同事\n初次见面开场白：嗨'), '温柔理智', '自定义四行 → 只取性格行')
eq(
  extractPersonality('你是对方的恋人，性格温柔。\n关系背景：同事\n初次见面开场白：嗨'),
  '你是对方的恋人，性格温柔。',
  '模板原文 → 去掉附加的背景/开场白行后的主体',
)
eq(extractPersonality(''), '', '空 persona → 空串')
eq(extractBackgroundLine('性格特质：温柔\n关系背景：同事'), '同事', '有背景行 → 内容')
eq(extractBackgroundLine('性格特质：温柔'), '', '无背景行 → 空串')

console.log('\n[7] applyPersonaEdits 结构化人设（自定义）')
const custom = '角色昵称：阿温\n性格特质：温柔\n关系背景：同事\n初次见面开场白：嗨'
eq(
  applyPersonaEdits(custom, { personality: '嘴硬心软' }),
  '角色昵称：阿温\n性格特质：嘴硬心软\n关系背景：同事\n初次见面开场白：嗨',
  '改性格 → 替换性格行，其余保留',
)
eq(
  applyPersonaEdits(custom, { background: '青梅竹马' }),
  '角色昵称：阿温\n性格特质：温柔\n关系背景：青梅竹马\n初次见面开场白：嗨',
  '改背景 → 替换背景行',
)
eq(
  applyPersonaEdits(custom, { opening: '' }),
  '角色昵称：阿温\n性格特质：温柔\n关系背景：同事',
  '删开场白 → 对应行消失',
)
eq(
  applyPersonaEdits('性格特质：温柔', { background: '老同学', opening: '好久不见' }),
  '性格特质：温柔\n关系背景：老同学\n初次见面开场白：好久不见',
  '无昵称行 → 只拼性格+新增行',
)

console.log('\n[8] applyPersonaEdits 自由文本（模板原文）')
const template = '你是对方的恋人，性格温柔。'
eq(
  applyPersonaEdits(template, { background: '我们是同事' }),
  '你是对方的恋人，性格温柔。\n关系背景：我们是同事',
  '模板加背景 → 原文主体 + 背景行',
)
eq(
  applyPersonaEdits(template, { personality: '你性格活泼' }),
  '你性格活泼',
  '模板改性格 → 替换整个主体',
)
eq(
  applyPersonaEdits(template + '\n关系背景：旧背景', { background: '新背景' }),
  '你是对方的恋人，性格温柔。\n关系背景：新背景',
  '模板已有背景行 → 主体保留，背景替换',
)
eq(
  applyPersonaEdits(template + '\n关系背景：旧背景', { opening: '你好呀' }),
  '你是对方的恋人，性格温柔。\n关系背景：旧背景\n初次见面开场白：你好呀',
  '只加开场白 → 背景保留，追加开场白行',
)

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) throw new Error(`customPersona.test 失败：${failed} 项未通过`)
