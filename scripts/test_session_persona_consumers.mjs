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
