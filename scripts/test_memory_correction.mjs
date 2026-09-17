// UI2-03A · Memory Correction V1
// 覆盖：三层来源文案、只改 text、全局持久化、session PATCH、失败保护与角色隔离。

import fs from 'node:fs'

const store = new Map()
globalThis.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
}
globalThis.window = { dispatchEvent: () => true }

let responseStatus = 200
const requests = []
globalThis.fetch = async (url, init = {}) => {
  const body = JSON.parse(String(init.body ?? '{}'))
  requests.push({ url: String(url), method: init.method, body })
  const payload = init.method === 'DELETE'
    ? { ok: true }
    : responseStatus === 200
      ? { id: 41, content: body.content, createdAt: '2026-09-01T00:00:00.000Z' }
      : { error: '暂时无法保存' }
  return new Response(
    JSON.stringify(payload),
    { status: responseStatus, headers: { 'Content-Type': 'application/json' } },
  )
}

const { correctMemoryText, removeMemory } = await import('../src/lib/memoryCorrection.ts')
const { getMemoriesCache, saveMemoriesCache } = await import('../src/lib/sessionStore.ts')

let passed = 0
let failed = 0
function check(name, condition) {
  if (condition) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}

const original = {
  id: '41',
  text: '用户不喜欢咖啡',
  createdAt: 1788211200000,
  source: '我不是不喝咖啡，只是不喜欢黑咖啡',
  taReply: '好，那我以后不把黑咖啡推给你。',
  explicit: true,
  pinned: true,
  topic: '饮食',
  lastMentionedAt: 1788297600000,
}

console.log('\n[1] Detail 来源语义与空态')
const component = fs.readFileSync(new URL('../src/components/Memory.tsx', import.meta.url), 'utf8')
check('source 有值展示真实 source', component.includes('selected.item.source.trim()'))
check('source 无值显示诚实空态', component.includes('没有保留当时原文'))
check('三层标题明确区分', ['当时你说', 'TA 当时回应', 'TA 最后记住'].every((text) => component.includes(text)))
check('TA 回应带轻辅助说明', component.includes('当时回应的记录'))

console.log('\n[2] 全局 explicit Memory 只改 text')
store.set('ai_companion_memory', JSON.stringify([original]))
const globalResult = await correctMemoryText({ kind: 'global', item: original }, '  用户只是不喜欢黑咖啡  ')
const savedGlobal = JSON.parse(store.get('ai_companion_memory'))[0]
check('全局保存成功并 trim', globalResult.ok && savedGlobal.text === '用户只是不喜欢黑咖啡')
for (const field of ['source', 'taReply', 'createdAt', 'explicit', 'pinned', 'topic', 'lastMentionedAt']) {
  check(`全局 correction 不改 ${field}`, savedGlobal[field] === original[field])
}
const globalResultAgain = await correctMemoryText(
  { kind: 'global', item: globalResult.ok ? globalResult.item : savedGlobal },
  '用户偶尔会喝加奶的咖啡',
)
check('同一 global Memory 可连续纠正两次', globalResultAgain.ok && globalResultAgain.item.text === '用户偶尔会喝加奶的咖啡')
check('两次 global correction 都不发 PATCH', requests.length === 0)
check('组件不再使用 WeakSet 或对象引用判断来源', !component.includes('WeakSet') && component.includes("selected.kind === 'global'"))

console.log('\n[3] 空字符串和未变化不写')
const beforeNoop = store.get('ai_companion_memory')
const emptyResult = await correctMemoryText({ kind: 'global', item: savedGlobal }, '   ')
check('空字符串被拒绝', !emptyResult.ok)
check('空字符串不改原记忆', store.get('ai_companion_memory') === beforeNoop)
const unchangedResult = await correctMemoryText({ kind: 'global', item: savedGlobal }, savedGlobal.text)
check('内容未变化不重复写', unchangedResult.ok && !unchangedResult.changed && store.get('ai_companion_memory') === beforeNoop)

console.log('\n[4] session Memory 走既有 PATCH，成功后才落缓存')
store.clear()
requests.length = 0
responseStatus = 200
saveMemoriesCache('role-a', [original])
saveMemoriesCache('role-b', [{ ...original, text: '角色 B 的独立记忆' }])
const sessionResult = await correctMemoryText(
  { kind: 'session', sessionId: 'role-a', item: original, token: 'token-1' },
  '用户只是不喜欢黑咖啡',
)
check('session 保存成功', sessionResult.ok && sessionResult.changed)
check('复用 PATCH /api/memories/:id', requests.length === 1 && requests[0].method === 'PATCH' && requests[0].url.endsWith('/api/memories/41'))
check('PATCH 只提交 content', JSON.stringify(requests[0].body) === JSON.stringify({ content: '用户只是不喜欢黑咖啡' }))
const savedSession = getMemoriesCache('role-a')[0]
check('session 缓存同步新 text', savedSession.text === '用户只是不喜欢黑咖啡')
for (const field of ['source', 'taReply', 'createdAt', 'explicit', 'pinned', 'topic', 'lastMentionedAt']) {
  check(`session correction 不改 ${field}`, savedSession[field] === original[field])
}
check('角色 B Memory 不变', getMemoriesCache('role-b')[0].text === '角色 B 的独立记忆')
const sessionResultAgain = await correctMemoryText(
  { kind: 'session', sessionId: 'role-a', item: sessionResult.ok ? sessionResult.item : savedSession, token: 'token-1' },
  '用户会喝加奶的咖啡',
)
check('同一 session Memory 可连续纠正两次', sessionResultAgain.ok && sessionResultAgain.item.text === '用户会喝加奶的咖啡')
check('两次 session correction 都走 PATCH', requests.length === 2 && requests.every((request) => request.method === 'PATCH'))
check('连续纠正仍只影响当前 session', getMemoriesCache('role-b')[0].text === '角色 B 的独立记忆')

console.log('\n[5] PATCH 失败保留原缓存')
responseStatus = 500
const beforeFailure = JSON.stringify(getMemoriesCache('role-a'))
const failedResult = await correctMemoryText(
  { kind: 'session', sessionId: 'role-a', item: savedSession, token: 'token-1' },
  '失败时不能落下的内容',
)
check('接口失败不报成功', !failedResult.ok)
check('接口失败不破坏原 Memory', JSON.stringify(getMemoriesCache('role-a')) === beforeFailure)

console.log('\n[6] mounted stale 临时 ID 使用 reconcile 后的服务端 ID')
responseStatus = 200
requests.length = 0
const staleOptimistic = { ...original, id: '1788211200000-local' }
const reconciled = { ...staleOptimistic, id: '902' }
saveMemoriesCache('role-stale', [reconciled])
const staleResult = await correctMemoryText(
  { kind: 'session', sessionId: 'role-stale', item: staleOptimistic, token: 'token-1' },
  '使用最新服务端 ID 保存',
)
check('stale 页面条目可解析到最新 cache 条目', staleResult.ok && staleResult.item.id === '902')
check('PATCH 使用 reconcile 后的 server id', requests.length === 1 && requests[0].url.endsWith('/api/memories/902'))
check('绝不 PATCH 旧临时 id', !requests.some((request) => request.url.includes(staleOptimistic.id)))
check('成功后 cache 保持 server id', getMemoriesCache('role-stale')[0].id === '902')
check('成功后 cache text 已更新', getMemoriesCache('role-stale')[0].text === '使用最新服务端 ID 保存')

console.log('\n[7] 尚未 reconcile 的纯本地 Memory 不发送 PATCH')
requests.length = 0
saveMemoriesCache('role-pending', [staleOptimistic])
const pendingBefore = JSON.stringify(getMemoriesCache('role-pending'))
const pendingResult = await correctMemoryText(
  { kind: 'session', sessionId: 'role-pending', item: staleOptimistic, token: 'token-1' },
  '这段草稿应当保留在编辑框',
)
check('未同步 Memory 返回明确失败', !pendingResult.ok && pendingResult.message === '这段记忆还没同步完成，请稍后再试')
check('未同步 Memory 不发送 PATCH', requests.length === 0)
check('未同步 Memory cache 原样不变', JSON.stringify(getMemoriesCache('role-pending')) === pendingBefore)

console.log('\n[8] reconcile 匹配不唯一时不猜测')
requests.length = 0
saveMemoriesCache('role-ambiguous', [
  { ...staleOptimistic, id: '903' },
  { ...staleOptimistic, id: '904' },
])
const ambiguousResult = await correctMemoryText(
  { kind: 'session', sessionId: 'role-ambiguous', item: staleOptimistic, token: 'token-1' },
  '不能猜是哪一条',
)
check('多个候选时返回未同步失败', !ambiguousResult.ok && ambiguousResult.message === '这段记忆还没同步完成，请稍后再试')
check('多个候选时不发送 PATCH', requests.length === 0)

console.log('\n[9] 删除记忆（2026-09-18 新增入口）')
// 全局：只动本地列表
store.clear()
requests.length = 0
responseStatus = 200
store.set('ai_companion_memory', JSON.stringify([original, { ...original, id: '42', text: '另一条' }]))
const globalRemoved = await removeMemory({ kind: 'global', item: original })
const globalLeft = JSON.parse(store.get('ai_companion_memory'))
check('全局删除成功', globalRemoved.ok)
check('全局只删掉那一条', globalLeft.length === 1 && globalLeft[0].id === '42')
check('全局删除不发请求（随全量 blob 同步）', requests.length === 0)
const globalMissing = await removeMemory({ kind: 'global', item: original })
check('删不存在的全局记忆返回失败而不是假装成功', !globalMissing.ok)

// 会话：DELETE 服务端成功后才清缓存
store.clear()
requests.length = 0
saveMemoriesCache('role-del', [original, { ...original, id: '42', text: '留下这条' }])
saveMemoriesCache('role-other', [{ ...original, id: '43', text: '别的角色' }])
const sessionRemoved = await removeMemory({ kind: 'session', sessionId: 'role-del', item: original, token: 'token-1' })
check('会话删除成功', sessionRemoved.ok)
check('走 DELETE /api/memories/:id', requests.length === 1 && requests[0].method === 'DELETE' && requests[0].url.endsWith('/api/memories/41'))
check('会话缓存里那条已消失', getMemoriesCache('role-del').every((m) => m.id !== '41'))
check('同一角色其余记忆不受影响', getMemoriesCache('role-del').some((m) => m.id === '42'))
check('其他角色记忆不受影响', getMemoriesCache('role-other')[0].id === '43')

// 失败保护：服务端没删掉就绝不先清本地
responseStatus = 500
const beforeFail = JSON.stringify(getMemoriesCache('role-del'))
const failedRemove = await removeMemory({ kind: 'session', sessionId: 'role-del', item: { ...original, id: '42' }, token: 'token-1' })
check('接口失败不报成功', !failedRemove.ok)
check('接口失败保留本地缓存（不做假消失）', JSON.stringify(getMemoriesCache('role-del')) === beforeFail)

// 未同步 / 不唯一：不猜
responseStatus = 200
requests.length = 0
saveMemoriesCache('role-pending-del', [{ ...original, id: '1788211200000-local' }])
const pendingRemove = await removeMemory({
  kind: 'session', sessionId: 'role-pending-del', item: { ...original, id: '1788211200000-local' }, token: 'token-1',
})
check('未同步记忆拒绝删除并给出明确提示', !pendingRemove.ok && pendingRemove.message === '这段记忆还没同步完成，请稍后再试')
check('未同步时不发送 DELETE', requests.length === 0)
saveMemoriesCache('role-ambiguous-del', [
  { ...original, id: '903' },
  { ...original, id: '904' },
])
const ambiguousRemove = await removeMemory({ kind: 'session', sessionId: 'role-ambiguous-del', item: { ...original, id: '1788211200000-local' }, token: 'token-1' })
check('多个候选时不猜哪一条', !ambiguousRemove.ok)
check('多个候选时不发送 DELETE', requests.length === 0)

// 组件接线（静态断言，防漏接）
check('详情页有删除入口', component.includes('memory-delete-trigger'))
check('删除要二次确认', component.includes('memory-delete-confirm') && component.includes('确认删除'))
check('删除成功后回记忆长河', component.includes('setConfirmingDelete(false)') && component.includes("setView('river')"))
check('删除失败就地提示不静默', component.includes('setDeleteError(result.message)'))

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed) process.exit(1)
