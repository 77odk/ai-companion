// #11 角色删除导航：显式默认角色（账号隔离 + Cloud State 接线）回归测试
import { readFileSync } from 'node:fs'

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
}
globalThis.window = new EventTarget()

const {
  getDefaultRoleId,
  setDefaultRoleId,
  clearDefaultRoleId,
  applyDefaultRoleFromCloud,
  deleteDefaultRoleFromCloud,
} = await import('../src/lib/defaultRole.ts')

let passed = 0
let failed = 0
function check(name, cond) {
  if (cond) passed++
  else {
    failed++
    console.log(`  ✗ FAIL: ${name}`)
  }
}

console.log('\n[1] 默认角色按账号隔离')
mem.clear()
check('空账号不返回默认', getDefaultRoleId('') === '')
check('A 可设置默认角色 12', setDefaultRoleId('A@example.com', '12') === true)
check('A 读回 12', getDefaultRoleId('A@example.com') === '12')
check('B 不会读到 A 的默认', getDefaultRoleId('B@example.com') === '')
check('B 可独立设置 88', setDefaultRoleId('B@example.com', '88') === true)
check('A 仍是 12', getDefaultRoleId('A@example.com') === '12')
check('B 是 88', getDefaultRoleId('B@example.com') === '88')

console.log('\n[2] 清除默认只影响当前账号')
clearDefaultRoleId('A@example.com')
check('A 已清空', getDefaultRoleId('A@example.com') === '')
check('B 仍保留 88', getDefaultRoleId('B@example.com') === '88')

console.log('\n[3] Cloud apply/delete 不串账号')
check('cloud apply 接受 sessionId', applyDefaultRoleFromCloud('A@example.com', { sessionId: 42 }) === '42')
check('A cloud apply 后是 42', getDefaultRoleId('A@example.com') === '42')
check('B 未受影响', getDefaultRoleId('B@example.com') === '88')
check('坏 payload 安全忽略', applyDefaultRoleFromCloud('A@example.com', { sessionId: '' }) === '')
deleteDefaultRoleFromCloud('A@example.com')
check('cloud tombstone 只清 A', getDefaultRoleId('A@example.com') === '')
check('B 仍是 88', getDefaultRoleId('B@example.com') === '88')

console.log('\n[4] 源码契约：Cloud State + 角色页')
const cloudSrc = readFileSync(new URL('../src/lib/cloudStateResources.ts', import.meta.url), 'utf8')
const rolesSrc = readFileSync(new URL('../src/components/RolesPage.tsx', import.meta.url), 'utf8')
const appSrc = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
check('Cloud State 注册 default_role adapter', cloudSrc.includes("registerCloudStateAdapter('default_role'"))
check('默认角色变更挂 data-change capture', cloudSrc.includes('addEventListener(ELUVIN_DATA_CHANGE, captureDefaultRole)'))
check('云端 apply 后更新 snapshot 再广播', /defaultRoleSnapshot = sid[\s\S]{0,80}notifyDataChanged\(\)/.test(cloudSrc))
check('角色菜单提供设为默认/取消默认', rolesSrc.includes("'取消默认'") && rolesSrc.includes("'设为默认'"))
check('删除路径使用 resolveSessionAfterDelete', rolesSrc.includes('resolveSessionAfterDelete('))
check('删除当前无默认不再 onNew()', !/handleDelete[\s\S]{0,1600}onNew\(\)/.test(rolesSrc))
check('删除恢复默认后回 TA 首页', appSrc.includes("onSwitch={() => navigate('home')}"))

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
