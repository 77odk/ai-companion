// 记忆注入视角转换 + 动作括号过滤 + 无上下文兜底增强（2026-08-23 三件套）
// 跑法：node scripts/test_persona_memory_fix.mjs
import { toPromptPerspective, recallRelevantMemories } from '../src/lib/memory.ts'
import { stripActionMarkers } from '../src/lib/api.ts'

let passed = 0
let failed = 0

function ok(cond, name) {
  if (cond) passed++
  else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}
function eq(actual, expected, name) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  ok(a === b, `${name}（得 ${a}，期望 ${b}）`)
}

console.log('\n[1] toPromptPerspective 人称转换')
eq(toPromptPerspective('我老公是李贝贝'), '对方老公是李贝贝', '我→对方')
eq(toPromptPerspective('我的老公是李贝贝'), '对方的老公是李贝贝', '我的→对方的')
eq(toPromptPerspective('我喜欢喝奶茶'), '对方喜欢喝奶茶', '喜欢类')
eq(toPromptPerspective('我们一起去过海边'), '我们一起去过海边', '我们保留')
eq(toPromptPerspective('我朋友说她是护士'), '对方朋友说她是护士', '我朋友→对方朋友')
eq(toPromptPerspective('我爸妈住武汉'), '对方爸妈住武汉', '我爸妈→对方爸妈')
eq(toPromptPerspective(''), '', '空串')

console.log('\n[2] stripActionMarkers 动作括号过滤')
eq(stripActionMarkers('不是啦（蹭蹭你），我是你男朋友'), '不是啦，我是你男朋友', '全角括号动作删')
eq(stripActionMarkers('*摸头* 乖啦'), '乖啦', '星号动作删')
eq(stripActionMarkers('刚过九点半欸（侧过手机将窗外景象收入画面），天气不错'), '刚过九点半欸，天气不错', '嵌入括号删')
eq(stripActionMarkers('哈哈（转身） 明天见'), '哈哈 明天见', '混合')
eq(stripActionMarkers('(开心) 好的'), '好的', '半角括号删')
eq(stripActionMarkers('没有括号的话'), '没有括号的话', '无括号原样')
eq(stripActionMarkers(''), '', '空串')

console.log('\n[3] recallRelevantMemories 无上下文兜底：pinned + explicit 全量 + 活跃补足')
const items = [
  { id: 'a', text: '喜欢奶茶', createdAt: 100, explicit: false },
  { id: 'b', text: '我老公是李贝贝', createdAt: 200, explicit: true },
  { id: 'c', text: '怕黑', createdAt: 300, pinned: true },
  { id: 'd', text: '喜欢周杰伦', createdAt: 400, explicit: true },
  { id: 'e', text: '工作是客服', createdAt: 500 },
  { id: 'f', text: '养了一只仓鼠叫豆豆', createdAt: 600 },
]
const res = recallRelevantMemories(items, '', { now: 1000 })
const texts = res.map((m) => m.text)
ok(res.length >= 4, `无上下文兜底至少带 4 条（pinned1+explicit2+活跃补，实际 ${res.length}）`)
ok(texts.includes('怕黑'), 'pinned 全量带上')
ok(texts.includes('我老公是李贝贝'), 'explicit 全量带上（用户明说）')
ok(texts.includes('喜欢周杰伦'), 'explicit 全量带上')
ok(res[0].text === '怕黑', 'pinned 恒排最前')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
