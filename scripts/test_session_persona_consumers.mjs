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
  rolePicker.includes('writePendingPersonaRepair({ account, id: createdSession.id, persona, title })'),
  'PATCH 前先写临时恢复事务',
)
ok(
  rolePicker.includes('attemptPendingPersonaRepair(token, account)'),
  '再次提交前先修复上次未完成 session，避免重复 POST',
)
ok(
  rolePicker.indexOf('setActiveSessionId(String(createdSession.id))') >
    rolePicker.indexOf('clearPendingPersonaRepair(account, createdSession.id)'),
  '只有 persona 补写确认后才激活角色',
)
ok(
  personaRepair.includes("sessionStorage.setItem(PENDING_PERSONA_REPAIR_KEY"),
  '恢复目标持久到当前浏览器会话，刷新/跳页不丢',
)
ok(
  personaRepair.includes("repaired.status === 404"),
  '后端已不存在的 pending session 会清理过期事务',
)
ok(
  personaRepair.includes("kind: 'blocked'"),
  '修复未确认时明确返回 blocked，不允许当正常角色使用',
)
ok(
  personaRepair.includes('filterPendingPersonaRepairSession'),
  '提供统一过滤器，把未完成 session 排除在角色列表外',
)
ok(
  app.indexOf('await attemptPendingPersonaRepair(token, account)') <
    app.indexOf('const active = resolveActiveSession('),
  'App 在正常 session 路由前先修复 pending persona',
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
