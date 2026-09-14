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
  return new Response(
    JSON.stringify(responseStatus === 200
      ? { id: 41, content: body.content, createdAt: '2026-09-01T00:00:00.000Z' }
      : { error: '暂时无法保存' }),
    { status: responseStatus, headers: { 'Content-Type': 'application/json' } },
  )
}

const { correctMemoryText } = await import('../src/lib/memoryCorrection.ts')
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

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed) process.exit(1)
