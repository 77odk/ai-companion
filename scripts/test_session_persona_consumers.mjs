// BUG-03 回归：Space / Runtime / 周记统一使用 resolveRolePersona，不再用真值判断覆盖 Natural 空人设。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
let failed = 0

function ok(condition, name) {
  if (condition) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}

function source(path) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
}

const rolePicker = source('../src/components/RolePicker.tsx')
const personaRepair = source('../src/lib/personaRepair.ts')
const app = source('../src/App.tsx')
const rolesPage = source('../src/components/RolesPage.tsx')
const settings = source('../src/components/Settings.tsx')
const storage = source('../src/lib/storage.ts')

console.log('\n[BUG-CUSTOM-PERSONA] 自定义角色创建后必须校验 persona 持久化')
ok(
  rolePicker.includes('needsPersonaPersistenceRepair(persona, createdSession.persona)'),
  'RolePicker 检查 createSession 返回的人设是否完整',
)
ok(
  rolePicker.includes('patchSession(token, createdSession.id, { persona, title })'),
  'RolePicker 在创建结果丢 persona 时立即 PATCH 补写',
)
ok(
  rolePicker.includes('newPersonaRepairTransactionId()'),
  '每次创建流程有独立 transactionId，旧标签页可识别同一事务',
)
ok(
  rolePicker.includes('attemptPendingPersonaRepair(token, account, repairTransactionId)'),
  '再次提交前先按 transactionId 复用/修复原 session',
)
ok(
  rolePicker.includes('personaRepairTransactionRef.current = pendingRepair.pending.transactionId'),
  '接手旧 pending 后继承原 transactionId，后续可识别其它标签完成的事务',
)
ok(
  rolePicker.includes('transactionId: repairTransactionId'),
  '首次补写前把 transactionId 写入角色自己的 repair 元数据',
)
ok(
  rolePicker.includes('rememberCompletedPersonaRepair'),
  '补写成功后保留 completed transaction，旧标签页不得再次 POST',
)
ok(
  rolePicker.includes("patchSession(token, pendingRepair.session.id, { persona, title })"),
  '重试前草稿有变化时更新原 session，不再 POST 新角色',
)
ok(
  personaRepair.includes("loadLocalPersonaRepair(String(session.id))"),
  'repair 状态从 session 自己的本地 profile 读取',
)
ok(
  personaRepair.includes("saveLocalPersonaRepair(String(session.id)"),
  'repair 状态写入 session 自己的本地 profile',
)
ok(
  !personaRepair.includes('sessionStorage'),
  '不依赖 tab 级 sessionStorage',
)
ok(
  !personaRepair.includes("localStorage.setItem("),
  'personaRepair 本身不新增 localStorage key',
)
ok(
  storage.includes('__personaRepair'),
  'storage 只在既有 ai_profile_<sessionId> 中保存本地 repair 元数据',
)
ok(
  storage.includes("collectAllAIProfiles"),
  '角色资料仍走既有 Cloud State 汇总路径',
)
ok(
  personaRepair.includes("repaired.status === 404"),
  '后端已不存在的 pending session 会清理过期事务',
)
ok(
  personaRepair.includes("marker.state === 'pending'"),
  '只有 pending 事务会被正常 UI / Chat 隐藏',
)
ok(
  personaRepair.includes("findRepairSession(sessions, account, transactionId, 'repaired')"),
  '已完成事务可被旧标签页按 transactionId 复用',
)
ok(
  app.includes('attemptPendingPersonaRepair(token, account, undefined, sessions)'),
  'App 用当前账号刚拉到的 server sessions 在正常路由前修复 pending persona',
)
ok(
  app.includes("sessions = sessions.filter((session) => session.id !== personaRepair.pending.id)"),
  '启动对账失败时从本次路由候选排除 pending session',
)
ok(
  app.includes("if (personaRepair.status === 401 || !isLoggedIn())"),
  '401 后停止正常路由，由现有登录墙接管',
)
ok(
  rolesPage.includes('filterPendingPersonaRepairSession'),
  '角色管理列表不会展示未完成 persona session',
)
ok(
  settings.includes('filterPendingPersonaRepairSession'),
  'TA 资料列表不会展示未完成 persona session',
)

const consumers = [
  ['aiSpace', source('../src/lib/aiSpace.ts')],
  ['taRuntime', source('../src/lib/taRuntime.ts')],
  ['WeeklyPage', source('../src/components/WeeklyPage.tsx')],
]

console.log('\n[BUG-03] persona consumer 统一解析')
for (const [name, code] of consumers) {
  ok(code.includes('resolveRolePersona('), `${name} 调用 resolveRolePersona`)
  ok(!/sessionPersona\s*\|\|\s*loadPersona\(\)/.test(code), `${name} 不用 || 覆盖会话空 persona`)
  ok(!/persona\.trim\(\)\)\s*return\s+[^\n]*persona/.test(code), `${name} 不用 trim 判断会话 persona 是否存在`)
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) throw new Error(`${failed} 个用例失败`)
