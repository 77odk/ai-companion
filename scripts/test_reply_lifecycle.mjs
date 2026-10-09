import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  findRecoverableReply,
  interruptionReasonFromError,
  markInterruptedAssistantContent,
  normalizeStaleReplyLifecycle,
  preserveReplyLifecycle,
  registerActiveReplyRun,
  setReplyLifecycle,
  unregisterActiveReplyRun,
} from '../src/lib/replyLifecycle.ts'

const U = (ts, state, reason) => ({
  role: 'user',
  content: '原话不能丢',
  ts,
  ...(state ? { replyState: state } : {}),
  ...(reason ? { replyInterruptedReason: reason } : {}),
})
const A = (ts, content, state, reason) => ({
  role: 'assistant',
  content,
  ts,
  ...(state ? { replyState: state } : {}),
  ...(reason ? { replyInterruptedReason: reason } : {}),
})

console.log('[reply lifecycle] pending → streaming → interrupted / complete')
const userTs = 100
const assistantTs = 200
const split = [U(userTs, 'pending'), A(assistantTs, '第一泡'), A(assistantTs, '第二泡')]
const interrupted = setReplyLifecycle(split, userTs, assistantTs, 'interrupted', 'network')
assert.equal(interrupted[0].replyState, 'interrupted')
assert.equal(interrupted[0].replyInterruptedReason, 'network')
assert.equal(interrupted[1].replyState, undefined, '多泡只在最后一泡挂中断标记')
assert.equal(interrupted[2].replyState, 'interrupted')
assert.equal(interrupted[2].replyInterruptedReason, 'network')
assert.match(interrupted[2].content, /回复中断/, '中断态必须编码进 assistant 正文，跨设备没有 lifecycle 字段也不能冒充完整回复')
assert.equal(markInterruptedAssistantContent(interrupted[2].content), interrupted[2].content, '中断标记必须幂等')
assert.equal(markInterruptedAssistantContent('This reply stopped').endsWith('(Reply interrupted)'), true, '英文 partial 使用英文中断标记')

const completed = setReplyLifecycle(interrupted, userTs, 300, 'complete')
assert.equal(completed[0].replyState, 'complete')
assert.equal(completed[0].replyInterruptedReason, undefined, '正常完成必须清掉旧中断原因')
assert.equal(completed[2].replyState, 'interrupted', '旧 partial 不得被新 retry 冒充 complete')

console.log('[reply lifecycle] 同页 active run 不误判；页面重载后的 stale run 才转 interrupted')
registerActiveReplyRun('s1', userTs)
const active = normalizeStaleReplyLifecycle([U(userTs, 'streaming')], 's1')
assert.equal(active.changed, false)
unregisterActiveReplyRun('s1', userTs)
const stale = normalizeStaleReplyLifecycle([U(userTs, 'streaming'), A(assistantTs, '半截', 'streaming')], 's1')
assert.equal(stale.changed, true)
assert.equal(stale.messages[0].replyState, 'interrupted')
assert.equal(stale.messages[0].replyInterruptedReason, 'pagehide')
assert.equal(stale.messages[1].replyState, 'interrupted')

console.log('[reply lifecycle] 恢复入口只认最近一轮 interrupted，context-limit 不误导重试')
const recoverable = findRecoverableReply([
  U(10, 'complete'),
  A(11, '完整', 'complete'),
  U(20, 'interrupted', 'timeout'),
  A(21, '半截', 'interrupted', 'timeout'),
])
assert.equal(recoverable?.userMessage.ts, 20)
assert.equal(recoverable?.reason, 'timeout')
assert.equal(findRecoverableReply([U(30, 'interrupted', 'context-limit')]), null)

console.log('[reply lifecycle] cloud merge 后保留本地生命周期，但正文/身份仍以后端为准')
const local = [
  { id: 7, role: 'user', content: '原话不能丢', ts: 100, replyState: 'interrupted', replyInterruptedReason: 'network' },
]
const merged = [
  { id: 7, role: 'user', content: '原话不能丢', ts: 101 },
]
const preserved = preserveReplyLifecycle(local, merged)
assert.equal(preserved[0].ts, 101)
assert.equal(preserved[0].replyState, 'interrupted')
assert.equal(preserved[0].replyInterruptedReason, 'network')

console.log('[reply lifecycle] 重复正文不能靠 content 猜 lifecycle 身份')
const repeatedLocal = [
  { role: 'user', content: '一样的话', ts: 100, replyState: 'interrupted', replyInterruptedReason: 'timeout' },
  { role: 'user', content: '一样的话', ts: 200 },
]
const repeatedMerged = [
  { id: 9, role: 'user', content: '一样的话', ts: 300 },
]
const repeatedPreserved = preserveReplyLifecycle(repeatedLocal, repeatedMerged)
assert.equal(repeatedPreserved[0].replyState, undefined, '没有 id / 精确 ts 时宁可不贴，也不能把旧中断复制给另一条同文消息')

console.log('[reply lifecycle] 429 / timeout / network 分类')
assert.equal(interruptionReasonFromError({ message: '请求失败（HTTP 429）' }), 'rate-limit')
assert.equal(interruptionReasonFromError({ message: 'request timeout' }), 'timeout')
assert.equal(interruptionReasonFromError({ kind: 'network', message: '网络不通' }), 'network')
assert.equal(interruptionReasonFromError({ message: 'other failure' }), 'unknown')

console.log('[reply lifecycle] Chat 静态闭环：Stop / 切模型 / 切会话 / pagehide + TA-only retry')
const chatSrc = fs.readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8') + '\n' + fs.readFileSync(new URL('../src/lib/chatStreamEngine.ts', import.meta.url), 'utf8')
assert.match(chatSrc, /replyInterruptionReasonRef\.current = 'stop'/)
assert.match(chatSrc, /replyInterruptionReasonRef\.current = 'model-switch'/)
assert.match(chatSrc, /replyInterruptionReasonRef\.current = 'session-switch'/)
assert.match(chatSrc, /replyInterruptionReasonRef\.current = 'pagehide'/)
assert.match(chatSrc, /replyInterruptionReasonRef\.current = interruptionReasonFromError\(err\)/)
assert.match(chatSrc, /assistantTs = Math\.max\(Date\.now\(\), assistantTs \+ 1\)/)
assert.match(chatSrc, /void uploadMessage\(roundSessionId, userMsg, \(confirmed\) =>/)
assert.match(chatSrc, /visibleHistory: visibleMessages\.slice\(0, sourceIndex \+ 1\)/)
const replyErrSrc = fs.readFileSync(new URL('../src/components/ChatReplyError.tsx', import.meta.url), 'utf8')
assert.match(replyErrSrc, /只重试 TA/)
assert.match(chatSrc, /if \(event\.persisted\) return/, 'BFCache pagehide 不得终止仍存活的 Chat 实例')
assert.match(chatSrc, /replyState === 'pending' \|\| latestLocalUser\.replyState === 'streaming'/, '只有仍运行的回复可以暂缓 cloud pull')
assert.match(chatSrc, /const interruptedLifecycle = local\.filter\(\(message\) => message\.replyState === 'interrupted'\)/)
assert.match(chatSrc, /preserveReplyLifecycle\(interruptedLifecycle, mergeSessionMessages\(local, cloud\)\)/, 'interrupted 要先正常合并 cloud，再只恢复精确本地 lifecycle')
assert.doesNotMatch(chatSrc, /replyState === 'pending'[\s\S]{0,160}replyState === 'interrupted'/, 'interrupted 不得和 active run 一起永久阻断 cloud merge')
assert.match(chatSrc, /const pendingSnapshot = getPendingOps\(\)[\s\S]*enqueueSessionMessageCommits\([\s\S]*\(\) => flushPendingOpsSnapshot\(token, pendingSnapshot\)/, 'pending replay 必须先快照，再经过同一 session commit gate；等待期间新增 op 不能被 recovery 偷吃')
assert.match(chatSrc, /let lifecycleUserTs = userMsg\.ts/)
assert.match(chatSrc, /partialUserTsRef\.current = confirmed\.ts/)
assert.match(chatSrc, /initialConfirmedAssistantIds\.has\(message\.id\)/, '并发确认消息用 server id 判断是否为本轮开始前已存在')
assert.doesNotMatch(chatSrc, /sid && token && !interruptionReason/, '不得通过 interruptionReason 条件旁路受保护 Chat 上传链')
assert.match(chatSrc, /if \(sid && token\) \{[\s\S]*uploadMessage\(roundSessionId, m\)/, '完整与中断回复都继续走既有 Chat 上传链；中断语义由正文标记承载')
assert.doesNotMatch(chatSrc, /initialAssistantSignatures/, '新 server id 不能因正文与旧 assistant 相同而被过滤')

console.log('reply lifecycle tests passed')
