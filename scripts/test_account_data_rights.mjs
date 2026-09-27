// 账号数据权利自测：注销清理范围 + 导出/注销接口的失败分支（2026-09-27）
// 跑法：node scripts/test_account_data_rights.mjs
//
// 为什么单独测这两块：注销不可逆，清理范围一旦漏（例如只清 ai_companion_ 忘了 ai_space_），
// 用户重新注册时会把旧动态/照片/同意记录带回来；导出是隐私权利，失败必须给得出人话提示。

let passed = 0
let failed = 0
function ok(cond, name) {
  if (cond) passed++
  else { failed++; console.log(`  ✗ FAIL: ${name}`) }
}
function eq(a, b, name) {
  if (a === b) passed++
  else { failed++; console.log(`  ✗ FAIL: ${name}（得 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}）`) }
}

function makeStorage() {
  const store = new Map()
  return {
    get length() { return store.size },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    _dump: () => Object.fromEntries(store),
  }
}

const local = makeStorage()
const sess = makeStorage()
globalThis.localStorage = local
globalThis.sessionStorage = sess

const fetchCalls = []
let fetchImpl = async () => ({ ok: true, status: 200, text: async () => '{}' })
globalThis.fetch = (...args) => { fetchCalls.push(args); return fetchImpl(...args) }

// 导出成功路径会碰 DOM / Blob，这里给最小桩
globalThis.Blob = class Blob { constructor(parts) { this.parts = parts } }
globalThis.URL.createObjectURL = () => 'blob:mock'
globalThis.URL.revokeObjectURL = () => {}
globalThis.document = {
  createElement: () => ({ href: '', download: '', click() {}, remove() {} }),
  body: { appendChild() {} },
}
globalThis.window = { setTimeout: (fn) => setTimeout(fn, 0) }

// 先装好桩，再动态 import（模块顶层会读 localStorage）
const {
  clearLocalCompanionData,
  exportMyData,
  deleteMyAccount,
  LOCAL_DATA_PREFIXES,
  DELETE_CONFIRM_WORD,
} = await import('../src/lib/accountData.ts')

function reset() {
  local.clear()
  sess.clear()
  fetchCalls.length = 0
  fetchImpl = async () => ({ ok: true, status: 200, text: async () => '{}' })
}
function login(token = 'tok-1') {
  local.setItem('ai_companion_account', JSON.stringify({ token, account: 'smoke@test.local' }))
}

// ---------- 1. 注销清理范围 ----------
reset()
login()
local.setItem('ai_companion_msgs_26', '[]')
local.setItem('ai_companion_mem_26', '[]')
local.setItem('ai_companion_theme', 'peach')
local.setItem('ai_space_posts_26', '[]')
local.setItem('ai_space_photos_global', '[]')
local.setItem('ai_space_recent_topic_26', '[]')
local.setItem('eluvin_consent', '{"version":"v1"}')
sess.setItem('eluvin_consent_session', '1')
local.setItem('someone_elses_key', 'keep-me')

const removed = clearLocalCompanionData()
ok(removed >= 8, `清理条数应 >= 8（实际 ${removed}）`)
eq(local.getItem('ai_companion_account'), null, '账号 token 被清')
eq(local.getItem('ai_companion_msgs_26'), null, '会话消息被清')
eq(local.getItem('ai_companion_mem_26'), null, '会话记忆被清')
eq(local.getItem('ai_companion_theme'), null, '外观设置被清')
eq(local.getItem('ai_space_posts_26'), null, 'TA 空间动态被清（ai_space_）')
eq(local.getItem('ai_space_photos_global'), null, 'TA 空间照片被清（ai_space_）')
eq(local.getItem('ai_space_recent_topic_26'), null, '空间话题缓存被清（ai_space_）')
eq(local.getItem('eluvin_consent'), null, '同意记录被清（eluvin_）')
eq(sess.getItem('eluvin_consent_session'), null, '本次进站同意标记被清（sessionStorage）')
eq(local.getItem('someone_elses_key'), 'keep-me', '别人的 key 不被误删')
eq(clearLocalCompanionData(), 0, '已清空后再清一次返回 0（幂等）')

// ---------- 2. 导出 ----------
reset()
const before = fetchCalls.length
let err = null
try { await exportMyData() } catch (e) { err = e }
ok(err !== null && /还没登录/.test(err.message), '未登录导出给出「还没登录」提示')
eq(fetchCalls.length, before, '未登录时不发请求')

reset()
login()
fetchImpl = async () => ({ ok: false, status: 401, text: async () => '' })
err = null
try { await exportMyData() } catch (e) { err = e }
ok(err !== null && /登录已过期/.test(err.message), '导出 401 提示「登录已过期」')

reset()
login()
fetchImpl = async () => ({ ok: true, status: 200, text: async () => '{"exportedAt":"x"}' })
let threw = false
try { await exportMyData() } catch { threw = true }
ok(!threw, '导出成功不抛错')
eq(fetchCalls.length, 1, '导出只发一次请求')
ok(String(fetchCalls[0][0]).endsWith('/api/export'), '导出打到 /api/export')
eq(fetchCalls[0][1].headers.Authorization, 'Bearer tok-1', '导出带 Bearer token')

// ---------- 3. 注销 ----------
reset()
fetchImpl = async () => ({ ok: true, status: 200 })
err = null
try { await deleteMyAccount('whatever') } catch (e) { err = e }
ok(err !== null && /还没登录/.test(err.message), '未登录注销给出提示')
eq(fetchCalls.length, 0, '未登录注销不发请求')

reset()
login()
fetchImpl = async () => ({ ok: false, status: 400 })
err = null
try { await deleteMyAccount('yes') } catch (e) { err = e }
ok(err !== null && /确认词不对/.test(err.message), '确认词写错提示「确认词不对」')

reset()
login()
fetchImpl = async () => ({ ok: false, status: 500 })
err = null
try { await deleteMyAccount(DELETE_CONFIRM_WORD) } catch (e) { err = e }
ok(err !== null && /注销失败/.test(err.message), '注销 500 提示「注销失败」')

reset()
login('tok-9')
fetchImpl = async () => ({ ok: true, status: 200 })
threw = false
try { await deleteMyAccount(DELETE_CONFIRM_WORD) } catch { threw = true }
ok(!threw, '注销成功不抛错')
const [url, opts] = fetchCalls[fetchCalls.length - 1]
ok(String(url).endsWith('/api/account'), '注销打到 /api/account')
eq(opts.method, 'DELETE', '注销用 DELETE')
eq(JSON.parse(opts.body).confirm, DELETE_CONFIRM_WORD, '请求体带确认词')
eq(opts.headers.Authorization, 'Bearer tok-9', '注销带 Bearer token')
eq(DELETE_CONFIRM_WORD, '注销', '确认词是「注销」两个字')

// ---------- 4. 前缀表本身 ----------
ok(LOCAL_DATA_PREFIXES.includes('ai_companion_'), '前缀表含 ai_companion_')
ok(LOCAL_DATA_PREFIXES.includes('ai_space_'), '前缀表含 ai_space_')
ok(LOCAL_DATA_PREFIXES.includes('eluvin_'), '前缀表含 eluvin_')

console.log(`\n账号数据权利：${passed} 通过，${failed} 失败`)
process.exit(failed ? 1 : 0)
