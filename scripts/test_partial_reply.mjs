// 生成中途退出的兜底（2026-09-14 七七实测：生成到一半关页面，回来那条回复凭空消失）
// 覆盖：
//   1. 半截回复落库：同 ts 的空占位被替换成真实内容，不是堆两条
//   2. 同 ts 重复提交不产生重复（只保留最后一次）
//   3. 每条都排进 pendingOps（关页面时来不及发请求，下次打开补传）
//   4. 无会话（游客）只走全局消息缓存，不排上传队列
//   5. 空白内容不落库、不排队列
//   6. 落库顺序按 ts 升序
//   7. 静态检查：Chat.tsx 真的挂了 pagehide / visibilitychange 并调用兜底函数

import { commitPartialReply } from '../src/lib/partialReply.ts'
import { getMessagesCache, saveMessagesCache, getPendingOps } from '../src/lib/sessionStore.ts'
import { loadMessages, saveMessages } from '../src/lib/storage.ts'

const memStore = new Map()
globalThis.localStorage = {
  get length() { return memStore.size },
  key: (i) => [...memStore.keys()][i] ?? null,
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: (k) => memStore.delete(k),
  clear: () => memStore.clear(),
}
globalThis.window = { dispatchEvent: () => {}, addEventListener: () => {}, removeEventListener: () => {} }
globalThis.document = { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' }

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log('  ok - ' + name + (detail ? '  | ' + detail : '')) }
  else { failed++; console.log('  FAIL - ' + name + (detail ? '  | ' + detail : '')) }
}
const reset = () => memStore.clear()
const SID = '1001'
const T = Date.now() - 60_000  // 必须落在 60 天窗口内：saveMessages 会裁掉更早的

console.log('[1] 生成到一半退出：半截回复落库（替换空占位）')
reset()
saveMessagesCache(SID, [
  { role: 'user', content: '在吗', ts: T - 1000 },
  { role: 'assistant', content: '', ts: T },
])
const parts = commitPartialReply(SID, T, '在的\n刚在忙')
let cache = getMessagesCache(SID)
check('落库成功', parts.length === 2, JSON.stringify(parts.map((p) => p.content)))
check('空占位被替换（不是堆两条）', cache.filter((m) => m.ts === T).length === 2, JSON.stringify(cache.map((m) => [m.role, m.content])))
check('顺序保持 ts 升序', cache.every((m, i, a) => i === 0 || a[i - 1].ts <= m.ts))
check('用户那条没被动', cache[0].role === 'user' && cache[0].content === '在吗')

console.log('[2] 同一轮重复提交不重复')
commitPartialReply(SID, T, '只剩这一句')
cache = getMessagesCache(SID)
check('同 ts 只保留最后一次', cache.filter((m) => m.ts === T).length === 1 && cache.filter((m) => m.ts === T)[0].content === '只剩这一句', JSON.stringify(cache.map((m) => m.content)))

console.log('[3] 排进待上传队列（关页面来不及发请求）')
reset()
saveMessagesCache(SID, [{ role: 'user', content: '你好', ts: T - 1000 }, { role: 'assistant', content: '', ts: T }])
commitPartialReply(SID, T, '第一句\n第二句')
let ops = getPendingOps()
check('每条一条待上传', ops.length === 2, JSON.stringify(ops.map((o) => o.payload.content)))
check('队列项带 role/ts/sessionId', ops.every((o) => o.type === 'message' && o.sessionId === SID && o.ts === T && o.payload.role === 'assistant'))
check('队列项有唯一 id', new Set(ops.map((o) => o.id)).size === ops.length)

console.log('[4] 游客（无会话）只落本地，不排队列')
reset()
saveMessages([{ role: 'user', content: 'hi', ts: T - 1 }])
commitPartialReply(null, T, 'hello')
check('全局缓存里有这条回复', loadMessages().some((m) => m.ts === T && m.content === 'hello'), JSON.stringify(loadMessages()))
check('没有排上传队列', getPendingOps().length === 0)

console.log('[5] 空白内容不落库、不排队列')
reset()
saveMessagesCache(SID, [{ role: 'user', content: '在吗', ts: T - 1 }])
const none = commitPartialReply(SID, T, '   ')
check('返回空数组', none.length === 0)
check('缓存没变', getMessagesCache(SID).length === 1)
check('队列没变', getPendingOps().length === 0)

console.log('[6] 只是切到后台（visible→hidden）：落本地但不抢着上传')
reset()
saveMessagesCache(SID, [{ role: 'user', content: '在吗', ts: T - 1000 }, { role: 'assistant', content: '', ts: T }])
commitPartialReply(SID, T, '半截内容', false)
const cache6 = getMessagesCache(SID)
check('半截内容先落本地（切后台/被系统杀掉也不丢）', cache6.some((m) => m.ts === T && m.content === '半截内容'))
check('没有排上传队列（流还在跑，等正常结束再传）', getPendingOps().length === 0)

console.log('[7] 静态检查：Chat.tsx 真的挂了兜底')
const fs = await import('node:fs')
const chatSrc = fs.readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
check('注册 pagehide', /addEventListener\('pagehide'/.test(chatSrc))
check('注册 visibilitychange', /addEventListener\('visibilitychange'/.test(chatSrc))
check('调用 commitPartialReply', /commitPartialReply\(sid, ts, text, leaving\)/.test(chatSrc))
check('生成开始时记下 ts（partialTsRef）', /partialTsRef\.current = assistantTs/.test(chatSrc))
check('正常结束时清掉标记（commitFinal 内）', /partialTsRef\.current = null/.test(chatSrc))

console.log(`\n结果：${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
