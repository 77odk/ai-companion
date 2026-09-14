// UI2-03B-1 Memory「看原对话」：exact-match 三态 + 二次校验
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_chat_jump.mjs（npm test 入口自动带上）
// 覆盖：unique / not_found / ambiguous / substring 禁止 / 角色隔离 /
//       sessionStart 过滤 / verifyChatJumpTarget 二次校验（ts / content / session / 多命中）

import { findChatJumpTarget, verifyChatJumpTarget } from '../src/lib/chatJump.ts'
import { getMessagesCache, saveMessagesCache } from '../src/lib/sessionStore.ts'

// localStorage / window mock（与现有 test_*.mjs 同款）：storage.ts / sessionStore.ts 在函数体内引用
const memStore = new Map()
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: (k) => memStore.delete(k),
  clear: () => memStore.clear(),
}
globalThis.window = { dispatchEvent: () => {} }

function resetStore() {
  memStore.clear()
}

let passed = 0
let failed = 0

function ok(cond, name) {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ FAIL ${name}`)
  }
}

const SESSION_START_KEY = 'ai_companion_session_start'

// ---- 数据准备 ----
const msg = (role, content, ts) => ({ id: `x${ts}`, role, content, ts })
const uid = (content, ts) => ({ role: 'user', content, ts })

// ---- A：唯一 exact match ----
{
  resetStore()
  saveMessagesCache('A', [uid('我喜欢拿铁', 1000), msg('assistant', '记住啦', 1001), uid('你呢？', 2000)])
  const r = findChatJumpTarget('A', '我喜欢拿铁')
  ok(r.status === 'unique', 'A unique：唯一 exact match → unique')
  ok(r.target && r.target.ts === 1000 && r.target.sessionId === 'A' && r.target.source === '我喜欢拿铁', 'A target 携带 sessionId/ts/source')
}

// ---- B：0 命中 ----
{
  resetStore()
  saveMessagesCache('A', [uid('今天天气不错', 1000)])
  const r = findChatJumpTarget('A', '我喜欢拿铁')
  ok(r.status === 'not_found' && r.target === null, 'B not_found：聊天没有该句 → not_found')
}

// ---- B2：source 为空 ----
{
  resetStore()
  saveMessagesCache('A', [uid('我喜欢拿铁', 1000)])
  const r = findChatJumpTarget('A', '   ')
  ok(r.status === 'not_found' && r.target === null, 'B2 空 source → not_found（不查）')
}

// ---- B3：sessionId 为空 ----
{
  resetStore()
  const r = findChatJumpTarget(null, '我喜欢拿铁')
  ok(r.status === 'not_found' && r.target === null, 'B3 无 session → not_found（不跨角色）')
}

// ---- C：重复 source（同 session 两次） ----
{
  resetStore()
  saveMessagesCache('A', [uid('我喜欢拿铁', 1000), msg('assistant', '好', 1001), uid('我喜欢拿铁', 2000)])
  const r = findChatJumpTarget('A', '我喜欢拿铁')
  ok(r.status === 'ambiguous' && r.target === null, 'C ambiguous：同 session 两次相同 → ambiguous，不跳第一条')
}

// ---- D：substring 禁止 ----
{
  resetStore()
  saveMessagesCache('A', [uid('我不喜欢拿铁', 1000), uid('我喜欢拿铁蛋糕', 2000)])
  const r = findChatJumpTarget('A', '我喜欢拿铁')
  ok(r.status === 'not_found' && r.target === null, 'D substring 禁止：includes 命中不算 exact → not_found')
}

// ---- D2：前后空白 trim 后全等 ----
{
  resetStore()
  saveMessagesCache('A', [uid('  我喜欢拿铁  ', 1000)])
  const r = findChatJumpTarget('A', '我喜欢拿铁')
  ok(r.status === 'unique' && r.target && r.target.ts === 1000, 'D2 trim 后全等 → unique（两端空白不破坏匹配）')
}

// ---- E：角色隔离 ----
{
  resetStore()
  saveMessagesCache('A', [uid('我喜欢拿铁', 1000)])
  saveMessagesCache('B', [uid('我喜欢拿铁', 3000)])
  const rA = findChatJumpTarget('A', '我喜欢拿铁')
  ok(rA.status === 'unique' && rA.target && rA.target.sessionId === 'A' && rA.target.ts === 1000, 'E A 只查 A cache：命中 A 的那条')
  const rB = findChatJumpTarget('B', '我喜欢拿铁')
  ok(rB.status === 'unique' && rB.target && rB.target.sessionId === 'B' && rB.target.ts === 3000, 'E B 只查 B cache：命中 B 的那条')
  // A 的会话起点过滤后，B 的消息绝不能进入 A 的结果
  const rA2 = findChatJumpTarget('A', 'x')
  ok(rA2.status === 'not_found', 'E 不跨会话：A 查不到 B 的内容')
}

// ---- F：sessionStart 过滤 ----
{
  resetStore()
  saveMessagesCache('A', [uid('我喜欢拿铁', 1000), uid('最近还好吗', 5000)])
  memStore.set(`${SESSION_START_KEY}_sid_A`, String(4000)) // 起点 4000：1000 那条 Chat 不渲染
  const rOld = findChatJumpTarget('A', '我喜欢拿铁')
  ok(rOld.status === 'not_found' && rOld.target === null, 'F 早于 sessionStart → not_found（不可跳 Chat 不渲染的旧消息）')
  const rNew = findChatJumpTarget('A', '最近还好吗')
  ok(rNew.status === 'unique' && rNew.target && rNew.target.ts === 5000, 'F 晚于 sessionStart 仍可跳')
}

// ---- verifyChatJumpTarget：Chat 进入前二次校验 ----
{
  const target = { sessionId: 'A', ts: 1000, source: '我喜欢拿铁' }
  const same = [uid('我喜欢拿铁', 1000), msg('assistant', '好', 1001)]
  ok(verifyChatJumpTarget(target, 'A', same) === true, '二次校验 唯一命中（session+ts+content）→ true')

  ok(verifyChatJumpTarget(target, 'B', same) === false, '二次校验 session 变化 → false')
  ok(verifyChatJumpTarget(target, null, same) === false, '二次校验 无 session → false')
  ok(verifyChatJumpTarget(target, 'A', [uid('我喜欢拿铁', 999)]) === false, '二次校验 ts 不匹配 → false')
  ok(verifyChatJumpTarget(target, 'A', [uid('我喜欢拿铁蛋糕', 1000)]) === false, '二次校验 content 不匹配 → false')
  ok(verifyChatJumpTarget(target, 'A', [uid('我喜欢拿铁', 1000), uid('我喜欢拿铁', 1000)]) === false, '二次校验 多命中（含目标 ts）→ false')
  ok(verifyChatJumpTarget(target, 'A', [uid('我不喜欢拿铁', 1000)]) === false, '二次校验 内容不符 → false')
  ok(verifyChatJumpTarget(null, 'A', same) === false, '二次校验 空 target → false')
  ok(verifyChatJumpTarget(target, 'A', []) === false, '二次校验 消息清空（被删除）→ false')
}

// ---- G：不同 ts 的相同内容（校验必须 ts+content 双锁） ----
{
  const target = { sessionId: 'A', ts: 1000, source: '我喜欢拿铁' }
  const shifted = [uid('我喜欢拿铁', 2000)]
  ok(verifyChatJumpTarget(target, 'A', shifted) === false, 'ts 变化但内容相同 → false（不凭 content 就滚）')
}

console.log(`\nchatJump: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
