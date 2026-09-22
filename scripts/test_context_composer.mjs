import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { composeContext, CONTEXT_HARD_BUDGET, compactHistory, COMPACT_KEEP_RECENT, COMPACT_USAGE_THRESHOLD } from '../src/lib/contextComposer.ts'
import { estimateToken } from '../src/lib/token.ts'

const core = [{ role: 'system', content: 'core persona' }]
const history = Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'history '.repeat(100) }))
const tail = [{ role: 'system', content: 'current time tail' }]
const result = composeContext(core, history, [], tail, 500)

assert.ok(result.totalTokens <= 500, 'final payload must stay inside supplied hard budget')
assert.deepEqual(result.messages[0], core[0], 'core must stay first')
assert.deepEqual(result.messages.at(-1), tail[0], 'time tail must stay last and count inside budget')
assert.equal(result.totalTokens, result.messages.reduce((sum, m) => sum + estimateToken(m.content), 0))

const blocks = composeContext(core, [], [
  { id: 'ambient', content: 'ambient', priority: 'ambient' },
  { id: 'memory', content: 'memory', priority: 'memory' },
  { id: 'irrelevant', content: 'skip me', priority: 'memory', relevant: false },
], [], CONTEXT_HARD_BUDGET)
assert.deepEqual(blocks.includedBlockIds, ['memory', 'ambient'])
assert.ok(!blocks.messages.some((m) => m.content === 'skip me'))

console.log('\ncontext_composer 基础：5/5')

// ── PR #99：Compact 纯函数 ──
console.log('\n[compact] 结构性压缩纯函数')
const longHistory = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `msg-${i}` }))
const cut = compactHistory(longHistory, COMPACT_KEEP_RECENT)
assert.equal(cut.compacted, true, '超过近窗长度应折叠')
assert.equal(cut.history.length, COMPACT_KEEP_RECENT, '折叠后只保留最近近窗条数')
assert.equal(cut.history[0].content, 'msg-8', '保留的是最近窗口（从 20-12=8 开始）')
assert.equal(cut.history.at(-1)?.content, 'msg-19', '最新一条必须在')
const short = compactHistory(longHistory.slice(0, 5))
assert.equal(short.compacted, false, '不足近窗不折叠')
assert.equal(short.history.length, 5, '不足近窗原样返回')
assert.equal(compactHistory([]).compacted, false, '空 history 不折叠')
assert.equal(COMPACT_USAGE_THRESHOLD, 0.7, '自动压缩阈值 = usage ≥ 0.7')

// ── PR #99：Bridge 块可被 composer 纳入（memory 优先级）──
console.log('\n[bridge] 承接块按 memory 优先级注入')
const bridgeBlock = { id: 'bridge', content: '旧会话记忆块', priority: 'memory' }
const bridged = composeContext(core, [], [bridgeBlock], [], CONTEXT_HARD_BUDGET)
assert.ok(bridged.includedBlockIds.includes('bridge'), 'bridge 块应被纳入 composer')
assert.ok(bridged.messages.some((m) => m.content === '旧会话记忆块'), 'bridge 内容出现在最终 payload')

// ── PR #99：storage 业务值（本地 + 上云通道，模式同 session_start）──
console.log('\n[storage] compact/bridge 业务值')
const store = new Map()
globalThis.localStorage = {
  getItem: (key) => store.has(key) ? store.get(key) : null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
  key: (index) => [...store.keys()][index] ?? null,
  get length() { return store.size },
}
const { getContextCompactAt, setContextCompactAt, getContextBridge, setContextBridge, clearContextBridge } = await import('../src/lib/storage.ts')
assert.equal(getContextCompactAt('S1'), 0, '未压缩返回 0')
setContextCompactAt(123456, 'S1')
assert.equal(getContextCompactAt('S1'), 123456, '压缩时间戳可回读')
assert.equal(getContextCompactAt('S2'), 0, '会话隔离，不影响别的会话')
setContextCompactAt(0, 'S1')
assert.equal(getContextCompactAt('S1'), 0, 'ts=0 清除')
setContextCompactAt(111, 'S1')
assert.equal(getContextBridge('S1'), null, '未承接返回 null')
setContextBridge('S1', 'S0')
const bridgedState = getContextBridge('S1')
assert.ok(bridgedState, '承接状态可回读')
assert.equal(bridgedState.fromSessionId, 'S0', '承接来源正确')
assert.ok(bridgedState.bridgedAt > 0, '承接时间戳存在')
assert.equal(getContextBridge('S2'), null, '承接会话隔离')
clearContextBridge('S1')
assert.equal(getContextBridge('S1'), null, '清除后返回 null')

// ── PR #99：Chat.tsx / cloudStateResources.ts 源码契约 ──
console.log('\n[contract] Chat 与 Cloud State 接入契约')
const chatSource = readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
const cloudSource = readFileSync(new URL('../src/lib/cloudStateResources.ts', import.meta.url), 'utf8')
// Meter：只展示最近一次发送的用量，不新增 LLM
assert.match(chatSource, /context-meter-row/, 'Meter 行渲染')
assert.match(chatSource, /setContextMeter\(\{ used: composed\.totalTokens, budget: composed\.hardBudget \}\)/, 'Meter 数据来自 composer 实际结果')
// Compact：阈值自动触发 + 主动按钮 + 每会话最多一次 + 不删原记录
assert.match(chatSource, /composed\.usage >= COMPACT_USAGE_THRESHOLD/, '达到软预算阈值自动压缩')
assert.match(chatSource, /setContextCompactAt\(Date\.now\(\), activeSessionId\)/, '自动压缩记录时间戳')
assert.match(chatSource, /compactDone\) return/, '已压缩后不再重复（每会话最多 1 次）')
assert.match(chatSource, /compactHistory\(history, COMPACT_KEEP_RECENT\)/, '结构性压缩 = 近窗注入')
assert.ok(!chatSource.includes('saveMessagesCache(sessionId'), 'Chat 不因 compact 改动消息缓存')
// Bridge：同 TA 承接 + 角色隔离 + 最多一次 + 不新增 LLM
assert.match(chatSource, /findBridgableSession\(activeSessionId\)/, '主动承接入口存在')
assert.match(chatSource, /\(s\.title \?\? ''\)\.trim\(\) === title/, '承接只匹配同 title（同 TA），不跨角色')
assert.match(chatSource, /bridgeInfo\) return/, '已承接后不再重复（每会话最多 1 次）')
assert.match(chatSource, /getMemoriesCache\(bridgeInfo\.fromSessionId\)/, '承接只读旧会话记忆缓存')
assert.match(chatSource, /bridgeBlocks\.push\(\{ id: 'bridge', content: bridgeBlock, priority: 'memory' \}\)/, '承接块以 memory 优先级进 composer')
// Cloud State：两个新 kind 注册（上云，不是只在本机）
assert.match(cloudSource, /registerCloudStateAdapter\('context_compact'/, 'context_compact 注册 Cloud State')
assert.match(cloudSource, /registerCloudStateAdapter\('context_bridge'/, 'context_bridge 注册 Cloud State')
assert.match(cloudSource, /queue\('context_compact', sessionId, \{ compactedAt: ts \}, false, sessionId\)/, 'compact 标记随现有 Cloud State 同步')
assert.match(cloudSource, /queue\('context_bridge', sessionId, \{ fromSessionId: state\.fromSessionId, bridgedAt: state\.bridgedAt \}, false, sessionId\)/, 'bridge 标记随现有 Cloud State 同步')
// 原聊天记录零删除：Chat 不新增删除类调用
assert.ok(!chatSource.includes('clearMessagesCache'), 'Chat 不清理消息缓存')
assert.ok(!chatSource.includes('deleteMessage'), 'Chat 不删除消息')

console.log('\ncontext_composer（含 PR #99 Compact/Bridge/Meter 契约）：全绿')
