// 当前角色资料解析纯逻辑自测（S1-2）
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：npm test（node --test）或直接 node src/lib/sessionProfile.test.ts
// 覆盖：按 id 找会话 / 取当前角色名（有会话取会话、无会话兜底全局）/
//       取当前角色人设（有会话取会话、无会话兜底全局）/ 首字头像（禁 emoji）/ 改名/人设后合并回列表

import {
  findSessionById,
  resolveRoleName,
  resolveRolePersona,
  roleInitial,
  patchSessionInList,
} from './sessionProfile.ts'
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

const sessions = [
  makeSession({ id: 1, title: '阿叙', persona: '阿叙的人设' }),
  makeSession({ id: 2, title: '小乖', persona: '角色昵称：小乖' }),
  makeSession({ id: 3, title: '我们的开始', persona: '角色昵称：阿温' }),
]

console.log('\n[1] findSessionById：按 id 找会话（字符串/数字兼容）')
eq(findSessionById(sessions, '1')?.title, '阿叙', '字符串 id 命中')
eq(findSessionById(sessions, 2)?.title, '小乖', '数字 id 命中')
eq(findSessionById(sessions, '99'), null, '未命中 → null')
eq(findSessionById([], '1'), null, '空列表 → null')
eq(findSessionById(null as never, '1'), null, '非数组 → null')
eq(findSessionById(sessions, ''), null, '空 id → null')

console.log('\n[2] resolveRoleName：有会话取会话名，无会话兜底全局昵称')
eq(resolveRoleName('1', sessions, '全局名'), '阿叙', '有会话 → 会话 title')
eq(resolveRoleName('3', sessions, '全局名'), '阿温', '占位标题 → persona 昵称兜底')
eq(resolveRoleName('2', sessions, '全局名'), '小乖', '自定义昵称 title 直接用')
eq(resolveRoleName('', sessions, '全局名'), '全局名', '无会话 → 全局昵称')
eq(resolveRoleName('99', sessions, '全局名'), '全局名', '会话未命中 → 全局昵称')
eq(resolveRoleName('', sessions, ''), 'TA', '无会话且全局为空 → TA')
eq(resolveRoleName('', [], '   '), 'TA', '全局空白 → TA')

console.log('\n[3] resolveRolePersona：有会话取会话 persona，无会话兜底全局')
eq(resolveRolePersona('1', sessions, 'g'), '阿叙的人设', '有会话 → 会话 persona')
eq(resolveRolePersona('', sessions, 'g'), 'g', '无会话 → 全局 persona')
eq(resolveRolePersona('99', sessions, 'g'), 'g', '会话未命中 → 全局 persona')
eq(resolveRolePersona('', sessions, ''), '', '全局空 → 空串')

console.log('\n[4] roleInitial：角色首字头像的字（禁 emoji）')
eq(roleInitial('阿叙'), '阿', '取首字')
eq(roleInitial('TA'), 'T', '英文首字')
eq(roleInitial(''), 'TA', '空 → TA')
eq(roleInitial('  小满  '), '小', '带空白 → 首字')
eq(roleInitial('😊阿叙'), '阿', 'emoji 开头 → 跳过 emoji 取首字')
eq(roleInitial('🐱'), 'TA', '整名是 emoji → 兜底 TA（禁 emoji 图标）')

console.log('\n[5] patchSessionInList：改名/改人设后合并回列表')
const renamed = patchSessionInList(sessions, '1', { title: '新名' })
eq(renamed[0].title, '新名', '命中 → 改 title')
eq(renamed[0].persona, '阿叙的人设', '不改其他字段')
eq(renamed[1].title, '小乖', '未命中不改')
const personaPatched = patchSessionInList(sessions, 3, { persona: '新 persona' })
eq(personaPatched[2].persona, '新 persona', '数字 id 命中 → 改 persona')
eq(personaPatched[2].title, '我们的开始', '只改传入字段')
eq(patchSessionInList([], '1', { title: 'x' }), [], '空列表 → 空列表')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) throw new Error(`${failed} 个用例失败`)
