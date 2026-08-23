// 账号与云端同步（TASK_A）纯逻辑自测
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_sync.mjs
// 覆盖：账号存取 / collectData 剔除 apiKey / messages 按 ts 去重 / memory 按 id 去重 /
//       合并策略分支（新设备用云端、老设备本地优先）/ 设置 apiKey 不上云 / 登录注册 / syncNow 先拉后推 /
//       数据变更事件防抖自动上传

import { ELUVIN_DATA_CHANGE } from '../src/lib/dataChange.ts'
import {
  getAccount,
  setAccount,
  clearAccount,
  collectData,
  mergeMessages,
  mergeMemory,
  applyData,
  login,
  register,
  syncNow,
  initSyncListener,
} from '../src/lib/sync.ts'

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

// fetch mock：记录调用，handler 按测试配置返回
let fetchCalls = []
let fetchHandler = null
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body ?? null })
  if (!fetchHandler) throw new TypeError('测试未配置 fetch 响应')
  return fetchHandler(String(url), init ?? {})
}
function resetFetch(handler) {
  fetchCalls = []
  fetchHandler = handler
}
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// window mock：数据变更事件测试用（dispatch 前判 window 存在，Node 平时静默）
const windowListeners = {}
globalThis.window = {
  addEventListener: (name, fn) => {
    windowListeners[name] = fn
  },
  removeEventListener: (name) => {
    delete windowListeners[name]
  },
  dispatchEvent: (ev) => {
    const fn = windowListeners[ev.type]
    if (fn) fn(ev)
    return true
  },
}

// 固定时间戳
const T1 = new Date(2026, 7, 20, 10, 0).getTime()
const T2 = new Date(2026, 7, 21, 10, 0).getTime()
const T3 = new Date(2026, 7, 22, 10, 0).getTime()

console.log('\n[1] 账号存取')
resetStore()
eq(getAccount(), null, '无账号 → null')
setAccount({ token: 'tok', email: 'a@b.com' })
eq(getAccount(), { token: 'tok', email: 'a@b.com' }, '写入后读回相同')
localStorage.setItem('ai_companion_account', 'not-json')
eq(getAccount(), null, '损坏 JSON → null')
localStorage.setItem('ai_companion_account', JSON.stringify({ token: '', email: 'a@b.com' }))
eq(getAccount(), null, '空 token → null')
clearAccount()
eq(getAccount(), null, '清除后 → null')

console.log('\n[2] collectData 全量打包 + 剔除 apiKey')
resetStore()
const packed = collectData()
eq(packed.messages, [], '默认 messages 空数组')
eq(packed.memory, [], '默认 memory 空数组')
eq(packed.persona, '', '默认 persona 空串')
eq(packed.sessionStart, 0, '默认 sessionStart 0')
eq(packed.mainAnniversary, null, '默认 mainAnniversary null')

resetStore()
localStorage.setItem(
  'ai_companion_settings',
  JSON.stringify({
    provider: 'deepseek',
    providers: {
      deepseek: { apiKey: 'sk-secret', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
      zhipu: { apiKey: 'zp-secret', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.7-flash' },
      openai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
      custom: { apiKey: '', baseUrl: '', model: 'gpt-4o-mini' },
    },
  }),
)
localStorage.setItem('ai_companion_persona', '专属人设')
localStorage.setItem('ai_companion_messages', JSON.stringify([{ role: 'user', content: '你好', ts: T1 }]))
localStorage.setItem('ai_companion_memory', JSON.stringify([{ id: 'm1', text: '喜欢奶茶', createdAt: T1 }]))
const packed2 = collectData()
ok(!('apiKey' in packed2.settings.providers.deepseek), 'settings 里 deepseek 无 apiKey')
ok(!('apiKey' in packed2.settings.providers.zhipu), 'settings 里 zhipu 无 apiKey')
eq(Object.keys(packed2.settings.providers.deepseek).sort(), ['baseUrl', 'model'], '每个服务商只留 baseUrl/model')
eq(packed2.settings.providers.deepseek.baseUrl, 'https://api.deepseek.com/v1', 'baseUrl 保留')
eq(packed2.settings.provider, 'deepseek', '外层 provider 保留')
eq(packed2.persona, '专属人设', 'persona 打进载荷')
eq(packed2.messages, [{ role: 'user', content: '你好', ts: T1 }], 'messages 打进载荷')
eq(packed2.memory, [{ id: 'm1', text: '喜欢奶茶', createdAt: T1 }], 'memory 打进载荷')

console.log('\n[3] mergeMessages 按 ts 去重合并、升序')
const cloudMsgs = [
  { role: 'user', content: '云端A', ts: T1 },
  { role: 'user', content: '云端B', ts: T3 },
]
const localMsgs = [
  { role: 'user', content: '本地B(同ts)', ts: T3 },
  { role: 'user', content: '本地C', ts: T2 },
]
const mergedMsgs = mergeMessages(localMsgs, cloudMsgs)
eq(mergedMsgs.map((m) => m.content), ['云端A', '本地C', '本地B(同ts)'], '去重 + 升序 + 同 ts 本地覆盖')
eq(mergeMessages([], []), [], '空输入 → 空')
eq(mergeMessages([null, { role: 'user', content: 'x', ts: T1 }], []).length, 1, '非法条目被过滤')
const stable = mergeMessages([{ role: 'user', content: 'a', ts: T3 }], [{ role: 'user', content: 'b', ts: T2 }])
eq(stable.map((m) => m.content), ['b', 'a'], '输入乱序也能升序')

console.log('\n[4] mergeMemory 按 id 去重、兜底 key')
const cloudMem = [{ id: 'm1', text: '云端记忆', createdAt: T1 }]
const localMem = [
  { id: 'm1', text: '本地同id', createdAt: T2 },
  { id: 'm2', text: '本地专属', createdAt: T3 },
]
const mergedMem = mergeMemory(localMem, cloudMem)
eq(mergedMem.map((m) => m.id).sort(), ['m1', 'm2'], 'id 去重并集')
const m1 = mergedMem.find((m) => m.id === 'm1')
eq(m1.text, '本地同id', '同 id 本地覆盖云端')
eq(
  mergeMemory([{ text: '无id', createdAt: T1 }], [{ text: '无id', createdAt: T1 }]).length,
  1,
  '没 id 的用 JSON.stringify 兜底去重',
)
eq(mergeMemory([], []), [], '空输入 → 空')

console.log('\n[5] applyData：新设备（本地全空）用云端')
resetStore()
applyData({
  messages: [{ role: 'assistant', content: '云端消息', ts: T1 }],
  memory: [{ id: 'm1', text: '云端记忆', createdAt: T1 }],
  persona: '你是小云',
  userProfile: { nickname: '云用户', avatar: '', bio: '云简介' },
  aiProfile: { nickname: '小云', avatar: '' },
  settings: { provider: 'custom', providers: { custom: { baseUrl: 'https://my.cloud/v1', model: 'my-model' } } },
  sessionStart: T2,
  anniversaries: [{ id: 'a1', label: '认识纪念日', date: '08-22', createdAt: T1 }],
  mainAnniversary: 'a1',
  spacePosts: [{ id: 'p1', at: T1, kind: '日常', text: '云动态', art: 0 }],
})
eq(JSON.parse(localStorage.getItem('ai_companion_messages')), [{ role: 'assistant', content: '云端消息', ts: T1 }], 'messages 落盘')
eq(JSON.parse(localStorage.getItem('ai_companion_memory')), [{ id: 'm1', text: '云端记忆', createdAt: T1 }], 'memory 落盘')
eq(localStorage.getItem('ai_companion_persona'), '你是小云', 'persona 用云端')
eq(JSON.parse(localStorage.getItem('ai_companion_user_profile')).nickname, '云用户', '用户资料用云端')
eq(JSON.parse(localStorage.getItem('ai_companion_ai_profile')).nickname, '小云', 'TA 资料用云端')
eq(localStorage.getItem('ai_companion_session_start'), String(T2), 'sessionStart 用云端')
eq(JSON.parse(localStorage.getItem('ai_companion_anniversaries')).length, 1, '纪念日用云端')
eq(localStorage.getItem('ai_companion_main_anniversary'), 'a1', '主纪念日用云端')
eq(JSON.parse(localStorage.getItem('ai_space_posts')).length, 1, '空间动态用云端')
const newDevSettings = JSON.parse(localStorage.getItem('ai_companion_settings'))
eq(newDevSettings.provider, 'custom', '云端 provider 落盘')
eq(newDevSettings.providers.custom.baseUrl, 'https://my.cloud/v1', '云端 baseUrl 落盘')
eq(newDevSettings.providers.custom.apiKey, '', '云端设置落盘时 apiKey 置空')

console.log('\n[6] applyData：老设备（本地有数据）本地优先')
resetStore()
localStorage.setItem('ai_companion_persona', '我的专属人设')
localStorage.setItem('ai_companion_session_start', String(T3))
localStorage.setItem('ai_companion_messages', JSON.stringify([{ role: 'user', content: '本地旧消息', ts: T2 }]))
localStorage.setItem(
  'ai_companion_settings',
  JSON.stringify({
    provider: 'deepseek',
    providers: {
      deepseek: { apiKey: 'sk-local', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
      zhipu: { apiKey: '', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.7-flash' },
      openai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
      custom: { apiKey: '', baseUrl: '', model: 'gpt-4o-mini' },
    },
  }),
)
applyData({
  messages: [{ role: 'user', content: '云端消息', ts: T1 }],
  persona: '云端人设',
  sessionStart: T1,
  settings: { provider: 'custom', providers: { custom: { baseUrl: 'https://cloud/v1', model: 'cloud-model' } } },
})
eq(localStorage.getItem('ai_companion_persona'), '我的专属人设', '本地有人设 → 本地保留')
eq(localStorage.getItem('ai_companion_session_start'), String(T3), '本地有起点 → 本地保留')
const mergedOld = JSON.parse(localStorage.getItem('ai_companion_messages'))
eq(mergedOld.map((m) => m.content), ['云端消息', '本地旧消息'], 'messages 并集合并（本地消息保留）')
eq(JSON.parse(localStorage.getItem('ai_companion_settings')).providers.deepseek.apiKey, 'sk-local', '本地 apiKey 保留')
eq(JSON.parse(localStorage.getItem('ai_companion_settings')).provider, 'deepseek', '本地配过设置 → provider 保留本地')

console.log('\n[7] applyData：云端为空/缺省 → 本地不动')
resetStore()
localStorage.setItem('ai_companion_persona', '本地人设')
applyData({})
eq(localStorage.getItem('ai_companion_persona'), '本地人设', '云端缺省不覆盖本地')
applyData({ persona: '', messages: [], memory: [] })
eq(localStorage.getItem('ai_companion_persona'), '本地人设', '云端空 persona 不覆盖本地')

console.log('\n[8] 登录 / 注册')
resetStore()
resetFetch((url, init) => {
  const body = JSON.parse(init.body)
  if (url.endsWith('/api/login')) {
    if (body.email === 'a@b.com' && body.password === '123456') {
      return jsonResponse({ token: 't1', email: 'a@b.com', createdAt: 1 })
    }
    return jsonResponse({ error: '邮箱或密码不对' }, 401)
  }
  if (url.endsWith('/api/register')) {
    if (body.email === 'new@b.com') {
      return jsonResponse({ token: 't2', email: 'new@b.com', createdAt: 1 })
    }
    return jsonResponse({ error: '这个邮箱已经注册过了' }, 409)
  }
  throw new Error('unexpected fetch: ' + url)
})
const acct = await login('a@b.com', '123456')
eq(acct.email, 'a@b.com', '登录成功返回账号')
eq(getAccount().email, 'a@b.com', '登录后账号已存 localStorage')
try {
  await login('a@b.com', 'wrong')
  ok(false, '错密码应抛错')
} catch (e) {
  eq(e.message, '邮箱或密码不对', '登录失败抛后端 error 文案')
}
const reg = await register('new@b.com', '123456')
eq(reg.email, 'new@b.com', '注册成功返回账号')
eq(getAccount().email, 'new@b.com', '注册后账号已存 localStorage')
try {
  await register('taken@b.com', '123456')
  ok(false, '重复注册应抛错')
} catch (e) {
  eq(e.message, '这个邮箱已经注册过了', '注册冲突抛后端 error 文案')
}

console.log('\n[9] 网络失败抛网络兜底（不抛底层 TypeError）')
resetStore()
resetFetch(() => {
  throw new TypeError('fetch failed')
})
try {
  await login('a@b.com', '123456')
  ok(false, '网络失败应抛错')
} catch (e) {
  ok(String(e.message).includes('网络不通'), '网络失败抛「网络不通」兜底')
}

console.log('\n[10] syncNow：先拉云端合并到本地，再全量上传')
resetStore()
setAccount({ token: 'tok', email: 'a@b.com' })
localStorage.setItem('ai_companion_persona', '本地人设')
localStorage.setItem('ai_companion_messages', JSON.stringify([{ role: 'user', content: '本地消息', ts: T2 }]))
const cloudData = {
  messages: [{ role: 'user', content: '云端消息', ts: T1 }],
  persona: '云端人设',
}
resetFetch((url, init) => {
  const method = init?.method ?? 'GET'
  if (url.endsWith('/api/sync') && method === 'GET') {
    return jsonResponse({ data: cloudData, updatedAt: 1 })
  }
  if (url.endsWith('/api/sync') && method === 'POST') {
    return jsonResponse({ ok: true, updatedAt: 2 })
  }
  throw new Error('unexpected: ' + method + ' ' + url)
})
await syncNow()
eq(fetchCalls.length, 2, 'syncNow 先 GET 再 POST')
eq(fetchCalls[0].method, 'GET', '第一步下载')
eq(fetchCalls[0].headers.Authorization, 'Bearer tok', '下载带 token')
eq(fetchCalls[1].method, 'POST', '第二步上传')
eq(JSON.parse(fetchCalls[1].body).data.persona, '本地人设', '上传的是合并后的本地数据（本地优先）')
eq(JSON.parse(fetchCalls[1].body).data.messages.length, 2, '上传含合并后的两条消息')
eq(localStorage.getItem('ai_companion_persona'), '本地人设', '本地人设仍在')
eq(JSON.parse(localStorage.getItem('ai_companion_messages')).length, 2, '本地消息合并云端消息')

console.log('\n[11] syncNow：未登录不发请求 / 上传失败抛错')
resetStore()
clearAccount()
resetFetch(() => jsonResponse({ ok: true }, 200))
await syncNow()
eq(fetchCalls.length, 0, '未登录 syncNow 不发请求')
setAccount({ token: 'tok', email: 'a@b.com' })
resetFetch(() => jsonResponse({ error: '登录已失效，请重新登录' }, 401))
try {
  await syncNow()
  ok(false, '上传 401 应抛错')
} catch (e) {
  eq(e.message, '登录已失效，请重新登录', '上传失败抛后端 error 文案')
}

console.log('\n[12] 数据变更事件：未登录不触发、已登录防抖后自动上传')
resetStore()
clearAccount()
resetFetch(() => jsonResponse({ ok: true }, 200))
// 把 4 秒防抖替换成立即执行，避免测试空等
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
globalThis.setTimeout = (fn) => {
  fn()
  return 1
}
globalThis.clearTimeout = () => {}
try {
  initSyncListener()
  window.dispatchEvent(new Event(ELUVIN_DATA_CHANGE))
  eq(fetchCalls.length, 0, '未登录时数据变更不触发上传')

  setAccount({ token: 'tok', email: 'a@b.com' })
  window.dispatchEvent(new Event(ELUVIN_DATA_CHANGE))
  await new Promise((r) => setImmediate(r))
  ok(fetchCalls.length >= 1, '已登录数据变更防抖后自动上传')
  eq(fetchCalls[0].method, 'POST', '自动上传走 POST')
  ok(fetchCalls[0].url.endsWith('/api/sync'), '自动上传到 /api/sync')
  eq(JSON.parse(fetchCalls[0].body).data.messages.length, 0, '自动上传载荷为全量 collectData')
} finally {
  globalThis.setTimeout = realSetTimeout
  globalThis.clearTimeout = realClearTimeout
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
