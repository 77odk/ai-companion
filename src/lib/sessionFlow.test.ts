// 会话流程纯逻辑自测（B2c-2 / B3）
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：npm test（node --test）或直接 node src/lib/sessionFlow.test.ts
// 覆盖：登录后分流（有会话→roles 列表主页 / 空→role）/ 挑最近会话（updatedAt 优先 / created_at 兜底）/ 时间戳兜底 /
//       B3 删会话后选下一个 / 会话标题（模板名 / 自定义摘要 / 兜底「新会话」）

import {
  decideLoginTarget,
  displaySessionName,
  pickMostRecentSession,
  sessionTimestamp,
  sessionTitleFromPersona,
  resolveSessionName,
  resolveSessionTitle,
  pickNextSessionAfterDelete,
} from './sessionFlow.ts'
import type { Session } from './sessionApi.ts'

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

function makeSession(partial: Partial<Session>): Session {
  return { id: 1, title: '', persona: '', created_at: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...partial }
}

console.log('\n[1] decideLoginTarget：有会话→roles（列表主页），空→role')
eq(decideLoginTarget([]), 'role', '空列表 → role')
eq(decideLoginTarget([makeSession({ id: 1 })]), 'roles', '有一条 → roles')
eq(decideLoginTarget([makeSession({ id: 1 }), makeSession({ id: 2 })]), 'roles', '有多条 → roles')
eq(decideLoginTarget(null as never), 'role', '非数组 → role（兜底去选角色）')

console.log('\n[2] sessionTimestamp：updatedAt 优先，缺省用 created_at')
const a = makeSession({ updatedAt: '2026-08-20T00:00:00.000Z', created_at: '2026-08-01T00:00:00.000Z' })
eq(sessionTimestamp(a), Date.parse('2026-08-20T00:00:00.000Z'), '有 updatedAt 用它')
const b = makeSession({ updatedAt: '', created_at: '2026-08-15T00:00:00.000Z' })
eq(sessionTimestamp(b), Date.parse('2026-08-15T00:00:00.000Z'), 'updatedAt 空 → 用 created_at')
const c = makeSession({ updatedAt: '', created_at: '' })
eq(sessionTimestamp(c), 0, '都解析失败 → 0')

console.log('\n[3] pickMostRecentSession：挑最新，空列表返回 null')
eq(pickMostRecentSession([]), null, '空列表 → null')
eq(pickMostRecentSession(null as never), null, '非数组 → null')
const older = makeSession({ id: 1, updatedAt: '2026-08-01T00:00:00.000Z' })
const newer = makeSession({ id: 2, updatedAt: '2026-08-20T00:00:00.000Z' })
eq(pickMostRecentSession([older, newer])?.id, 2, 'updatedAt 最新的选中')
const noUpdated = makeSession({ id: 3, updatedAt: '', created_at: '2026-08-25T00:00:00.000Z' })
eq(pickMostRecentSession([older, noUpdated])?.id, 3, 'updatedAt 缺省时按 created_at 挑')
eq(pickMostRecentSession([newer, noUpdated])?.id, 3, 'created_at 更晚也赢过 updatedAt 较早')

console.log('\n[4] pickNextSessionAfterDelete：删会话后选下一个（剩>0 取最近 / 无则 null）')
const s1 = makeSession({ id: 1, updatedAt: '2026-08-01T00:00:00.000Z', title: 'A' })
const s2 = makeSession({ id: 2, updatedAt: '2026-08-20T00:00:00.000Z', title: 'B' })
eq(pickNextSessionAfterDelete([s1, s2], '2')?.id, 1, '删最近 2 → 剩 1，选它')
eq(pickNextSessionAfterDelete([s1, s2], '1')?.id, 2, '删较旧 1 → 剩 2，选它')
eq(pickNextSessionAfterDelete([s1], '1'), null, '只剩被删的 → null（进选角色页）')
eq(pickNextSessionAfterDelete([], '1'), null, '空列表 → null')
eq(pickNextSessionAfterDelete([s1, s2], '99')?.id, 2, '删的不是列表里的 → 取最近')
eq(pickNextSessionAfterDelete(null as never, '1'), null, '非数组 → null')

console.log('\n[5] sessionTitleFromPersona：自定义人设摘要')
eq(sessionTitleFromPersona('性格特质：温柔理智\n关系背景：多年朋友'), '温柔理智', '取第一行内容，剥掉前缀')
eq(sessionTitleFromPersona('角色昵称：阿温\n性格特质：温柔'), '阿温', '昵称行在前 → 用昵称')
eq(sessionTitleFromPersona('性格特质：温柔理智嘴硬心软相处起来'), '温柔理智嘴硬心软…', '超长 → 截前 8 字')
eq(sessionTitleFromPersona('没有前缀的超长人设文本超过八个字'), '没有前缀的超长人…', '无前缀 → 整段截前 8 字')
eq(sessionTitleFromPersona('   '), '', '全空白 → 空串')
eq(sessionTitleFromPersona(''), '', '空串 → 空串')

console.log('\n[6] resolveSessionTitle：模板名 / 自定义摘要 / 兜底「新会话」')
eq(resolveSessionTitle('gentle-boyfriend', '不管人设'), '温叙相伴', '模板 → 模板名')
eq(resolveSessionTitle('bestie', 'x'), '挚友同频', '模板 → 模板名')
eq(resolveSessionTitle('custom', '性格特质：勇敢'), '勇敢', '自定义 → 摘要')
eq(resolveSessionTitle('custom', '   '), '新会话', '自定义空人设 → 新会话')
eq(resolveSessionTitle(null, ''), '新会话', '无选中且空人设 → 新会话')
eq(resolveSessionTitle('nope', '性格特质：温柔'), '温柔', '未知模板 id → 当自定义摘要')

console.log('\n[7] resolveSessionName（S1 会话人物名）：模板 id → charName / persona 角色昵称行 / 兜底 TA')
eq(resolveSessionName('不管人设', 'gentle-boyfriend'), '阿叙', '模板 → charName')
eq(resolveSessionName('', 'bestie'), '小满', '模板空 persona 也有 charName')
eq(resolveSessionName('不管人设', 'growth-partner'), '阿光', '逐光同行 → 阿光')
eq(resolveSessionName('x', 'custom'), 'TA', 'custom 且无角色昵称 → TA')
eq(resolveSessionName('角色昵称：阿温\n性格特质：温柔'), '阿温', 'persona 含角色昵称行 → 取昵称')
eq(resolveSessionName('性格特质：温柔\n角色昵称：小乖\n关系背景：朋友'), '小乖', '昵称行不在第一行也能命中')
eq(resolveSessionName('  角色昵称：带缩进\n性格特质：温柔'), '带缩进', '昵称行带行首空白也命中')
eq(resolveSessionName('角色昵称：  \n性格特质：温柔'), 'TA', '角色昵称为空白 → TA')
eq(resolveSessionName(''), 'TA', '空 persona 无模板 → TA')
eq(resolveSessionName('性格特质：温柔'), 'TA', '无昵称行 → TA')
eq(resolveSessionName('x', 'nope'), 'TA', '未知模板 id → 兜底（persona 无昵称则 TA）')

console.log('\n[8] displaySessionName（S1 展示名）：非占位标题直接用 / 占位标题从 persona 兜底')
eq(displaySessionName({ title: '阿叙', persona: 'x' }), '阿叙', '有角色名 title 直接用')
eq(displaySessionName({ title: '小乖', persona: 'x' }), '小乖', '改名后的 title 直接用')
eq(displaySessionName({ title: '我们的开始', persona: '角色昵称：阿温' }), '阿温', '迁移占位标题 → persona 昵称兜底')
eq(displaySessionName({ title: '新会话', persona: '角色昵称：小满' }), '小满', '旧默认标题 → persona 昵称兜底')
eq(displaySessionName({ title: '', persona: '' }), 'TA', '全空 → TA')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) throw new Error(`${failed} 个用例失败`)
