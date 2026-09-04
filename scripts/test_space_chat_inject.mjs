// TA 空间动态 → 聊天注入 · 纯逻辑自测（TASK-SPACE-CHAT）
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_space_chat_inject.mjs
// 覆盖：动态注入块格式化 / 生活基线判断

import { buildSpacePostsBlock, personaHasLifeAnchors, LIFE_BASELINE } from '../src/lib/spaceChatInject.ts'

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

/** 造一条动态（text 必填，其他字段补默认） */
function post(text, at = 1000) {
  return { id: `p${at}`, at, kind: '日常', text, art: 0 }
}

console.log('\n[1] buildSpacePostsBlock 动态注入块')
eq(buildSpacePostsBlock([]), '', '空列表 → 空串')
eq(buildSpacePostsBlock(null), '', 'null → 空串')
eq(buildSpacePostsBlock([post('')]), '', '空 text → 空串（跳过注入）')
const block = buildSpacePostsBlock([
  post('早餐店的豆浆油条，绝了'),
  post('煮了碗面，加了俩蛋'),
  post('楼下散步，天气不错'),
])
ok(block.startsWith('你最近发过的动态：'), '以「你最近发过的动态」开头')
ok(block.includes('- 早餐店的豆浆油条，绝了'), '含第一条（最新）')
ok(block.includes('- 煮了碗面，加了俩蛋'), '含第二条')
ok(block.includes('- 楼下散步，天气不错'), '含第三条')
ok(block.includes('这是你自己发过的生活记录，对方提起时照实接'), '带被动引用说明（别当成实时经历）')
ok(!block.includes('现在正在发生'), '不带「现在正在发生」误表述')

// limit 截断
const five = buildSpacePostsBlock(
  [1, 2, 3, 4, 5, 6].map((n) => post(`动态${n}`)),
  5,
)
ok(five.includes('- 动态1') && !five.includes('- 动态6'), 'limit=5 只取前 5 条（最新在前）')

// text 空白过滤
const mixed = buildSpacePostsBlock([post('  有内容的  '), post('   ')])
ok(mixed.includes('有内容的') && !mixed.includes('  '), 'text 去空白，空行不占位')

console.log('\n[2] personaHasLifeAnchors 生活基线判断')
ok(personaHasLifeAnchors('你是一个医生，工作很忙'), '含职业 → true（不补基线）')
ok(personaHasLifeAnchors('你是大学生，住校'), '含身份/住处 → true')
ok(personaHasLifeAnchors('你是个程序员，住在上海'), '含职业+住处 → true')
ok(personaHasLifeAnchors('你开了一家书店'), '含开店 → true')
ok(!personaHasLifeAnchors('你是对方的恋人，性格温柔有耐心'), '纯性格 → false（补中性基线）')
ok(!personaHasLifeAnchors(''), '空人设 → false（补基线）')
ok(!personaHasLifeAnchors(null), 'null → false')
ok(!personaHasLifeAnchors('你说话总是很温柔，喜欢照顾人'), '无生活信息 → false（补基线）')

console.log('\n[3] LIFE_BASELINE 内容检查')
ok(typeof LIFE_BASELINE === 'string' && LIFE_BASELINE.length > 0, '基线非空')
ok(!/[\u{1F000}-\u{1FAFF}]/u.test(LIFE_BASELINE), '无 emoji')
ok(/自己做饭|看看书/.test(LIFE_BASELINE), '含中性生活细节（做饭/看书）')
ok(!/医生|程序员|老师/.test(LIFE_BASELINE), '不含具体职业（不编造身份）')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
