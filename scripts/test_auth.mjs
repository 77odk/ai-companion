// 登录墙纯逻辑自测（TASK_B2b）
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_auth.mjs
// 覆盖：getToken 空/非空 token / isLoggedIn 判定 / isPublicView 游客可看 view 集合 /
//       logout 清 token 并广播登录状态变化

import { ELUVIN_AUTH_CHANGE } from '../src/lib/dataChange.ts'
import { getToken, isLoggedIn, isPublicView, logout } from '../src/lib/auth.ts'
import { setAccount, clearAccount } from '../src/lib/sync.ts'

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

// 简易 localStorage mock（Node 无 localStorage；各读写函数导入不触发）
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}
function resetStore() {
  store.clear()
}

// window mock：只验证 logout 是否广播登录状态变化
const windowListeners = {}
let authEvents = 0
globalThis.window = {
  addEventListener: (name, fn) => {
    windowListeners[name] = fn
  },
  removeEventListener: (name) => {
    delete windowListeners[name]
  },
  dispatchEvent: (ev) => {
    if (ev.type === ELUVIN_AUTH_CHANGE) authEvents++
    const fn = windowListeners[ev.type]
    if (fn) fn(ev)
    return true
  },
}

console.log('\n[1] getToken / isLoggedIn：空 token 判定')
resetStore()
eq(getToken(), '', '无账号 → token 空串')
ok(!isLoggedIn(), '无账号 → 未登录')
localStorage.setItem('ai_companion_account', 'not-json')
eq(getToken(), '', '损坏 JSON → token 空串')
ok(!isLoggedIn(), '损坏 JSON → 未登录')
localStorage.setItem('ai_companion_account', JSON.stringify({ token: '', account: 'a@b.com' }))
eq(getToken(), '', '空 token → token 空串')
ok(!isLoggedIn(), '空 token → 未登录')

console.log('\n[2] getToken / isLoggedIn：非空 token 判定')
resetStore()
setAccount({ token: 'tok-123', account: 'a@b.com' })
eq(getToken(), 'tok-123', '有 token → 读出原样')
ok(isLoggedIn(), '有 token → 已登录')
clearAccount()
eq(getToken(), '', '清除账号 → token 空串')
ok(!isLoggedIn(), '清除账号 → 未登录')

console.log('\n[3] isPublicView：游客可看集合')
for (const v of ['welcome', 'role', 'guide']) {
  ok(isPublicView(v), `${v} = true（游客可看）`)
}
for (const v of ['chat', 'memory', 'work', 'settings', 'aispace', 'anniversary']) {
  ok(!isPublicView(v), `${v} = false（需登录）`)
}
ok(!isPublicView('unknown'), '未知 view = false')
ok(!isPublicView(''), '空串 = false')

console.log('\n[4] logout：清 token 并广播登录状态变化')
resetStore()
setAccount({ token: 'tok', account: 'a@b.com' })
ok(isLoggedIn(), '前置：已登录')
authEvents = 0
logout()
ok(!isLoggedIn(), '登出后 → 未登录')
eq(getToken(), '', '登出后 → token 空串')
eq(localStorage.getItem('ai_companion_account'), null, '登出后 → 账号 key 已清')
eq(authEvents, 1, '登出广播 1 次登录状态变化')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
