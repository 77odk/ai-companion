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
  rolePicker.includes('setSessionsCache(['),
  '新角色创建后立即写本地会话缓存，避免刷新前读到空 persona',
)
ok(
  rolePicker.includes("sessionStorage.setItem(PENDING_PERSONA_REPAIR_KEY"),
  'persona 补写失败后把恢复目标持久到当前浏览器会话',
)
ok(
  rolePicker.includes('readPendingPersonaRepair(account)'),
  '刷新/跳页/401 重登后先读取待修复 session',
)
ok(
  rolePicker.includes('if (!repairedPending.ok)'),
  '待修复 session 未修好前不得继续新建',
)
ok(
  rolePicker.includes('deleteSession(token, createdSession.id)'),
  '补写失败且仍有鉴权时尝试回滚未完成 session',
)
ok(
  rolePicker.indexOf('setActiveSessionId(String(createdSession.id))') >
    rolePicker.indexOf('clearPendingPersonaRepair(account, createdSession.id)'),
  '只有 persona 补写确认后才激活角色',
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
