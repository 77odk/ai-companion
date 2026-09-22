import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { composeContext, CONTEXT_HARD_BUDGET, buildCompactedHistory, COMPACT_KEEP_RECENT, BRIDGE_ACTIVE_TURNS, BRIDGE_TAIL_COUNT } from '../src/lib/contextComposer.ts'
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

// ── PR #99：Compact = 较老历史 → summary + 保留最近原始消息（不是 slice 裁剪）──
console.log('\n[compact] summary + recent raw 注入组装')
assert.equal(COMPACT_KEEP_RECENT, 12, '保留最近原始消息条数 = 12')
const longHistory = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `msg-${i}` }))
const folded = buildCompactedHistory('早期对话摘要', longHistory, COMPACT_KEEP_RECENT)
assert.equal(folded.length, COMPACT_KEEP_RECENT + 1, '折叠后 = 1 条 summary + 最近 12 条原始消息')
assert.equal(folded[0].role, 'system', 'summary 以 system 角色注入')
assert.equal(folded[0].content, '早期对话摘要', 'summary 内容原样保留')
assert.equal(folded[1].content, 'msg-8', '最近窗口从 20-12=8 开始')
assert.equal(folded.at(-1)?.content, 'msg-19', '最新一条必须在')
assert.equal(folded.filter((m) => m.role === 'assistant' || m.role === 'user').length, COMPACT_KEEP_RECENT, '原始消息一条不少（最近窗）')
const short = buildCompactedHistory('摘要', longHistory.slice(0, 5), COMPACT_KEEP_RECENT)
assert.equal(short.length, 6, '不足近窗也保留 summary + 全部原消息')
assert.equal(buildCompactedHistory('', longHistory, COMPACT_KEEP_RECENT).length, COMPACT_KEEP_RECENT, 'summary 为空退回最近原始消息')
assert.deepEqual(buildCompactedHistory('摘要', []), [], '空 history 返回空')
assert.ok(!buildCompactedHistory('摘要', longHistory).some((m) => m.content === 'msg-0'), '较老消息不直接注入（被摘要替代）')

// ── PR #99：Bridge 常量 + 块可被 composer 纳入（memory 优先级）──
console.log('\n[bridge] evidence-only bridge 块注入')
assert.equal(BRIDGE_ACTIVE_TURNS, 8, 'bridge 临时参与轮数 = 8（约 6–10）')
assert.equal(BRIDGE_TAIL_COUNT, 30, '承接只取上一会话最近 30 条聊天尾部')
const bridgeBlock = { id: 'bridge', content: 'evidence-only 交接摘要', priority: 'memory' }
const bridged = composeContext(core, [], [bridgeBlock], [], CONTEXT_HARD_BUDGET)
assert.ok(bridged.includedBlockIds.includes('bridge'), 'bridge 块应被纳入 composer')
assert.ok(bridged.messages.some((m) => m.content === 'evidence-only 交接摘要'), 'bridge 内容出现在最终 payload')

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
const { getContextCompactAt, setContextCompactAt, getContextCompactSummary, setContextCompactSummary, getContextBridge, setContextBridge, setContextBridgeTurns, clearContextBridge } = await import('../src/lib/storage.ts')
assert.equal(getContextCompactAt('S1'), 0, '未压缩返回 0')
assert.equal(getContextCompactSummary('S1'), '', '未压缩无摘要')
setContextCompactSummary('早期摘要', 'S1')
assert.equal(getContextCompactSummary('S1'), '早期摘要', '压缩摘要可回读')
assert.equal(getContextCompactSummary('S2'), '', '摘要会话隔离')
setContextCompactSummary('', 'S1')
assert.equal(getContextCompactSummary('S1'), '', '空串清除摘要')
setContextCompactAt(123456, 'S1')
assert.equal(getContextCompactAt('S1'), 123456, '压缩时间戳可回读')
assert.equal(getContextCompactAt('S2'), 0, '会话隔离，不影响别的会话')
setContextCompactAt(0, 'S1')
assert.equal(getContextCompactAt('S1'), 0, 'ts=0 清除')
setContextCompactAt(111, 'S1')
assert.equal(getContextBridge('S1'), null, '未承接返回 null')
setContextBridge('S1', 'S0', '交接摘要', 8)
const bridgedState = getContextBridge('S1')
assert.ok(bridgedState, '承接状态可回读')
assert.equal(bridgedState.fromSessionId, 'S0', '承接来源正确')
assert.equal(bridgedState.content, '交接摘要', 'bridge 摘要可回读')
assert.equal(bridgedState.turnsLeft, 8, '初始参与轮数 = 8')
setContextBridgeTurns('S1', 4)
assert.equal(getContextBridge('S1')?.turnsLeft, 4, '轮数可递减回读')
assert.equal(getContextBridge('S1')?.fromSessionId, 'S0', '递减不改承接来源')
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
// Compact：用户主动触发 + 1 次模型生成 summary + summary/recent raw 注入 + 不删原记录
assert.match(chatSource, /buildCompactedHistory\(compactSummary, history, COMPACT_KEEP_RECENT\)/, '已压缩后注入 = summary + 最近原始消息')
assert.match(chatSource, /setContextCompactSummary\(trimmed, activeSessionId\)/, '模型生成的摘要持久化')
assert.match(chatSource, /setContextCompactAt\(Date\.now\(\), activeSessionId\)/, '压缩成功记录时间戳')
assert.match(chatSource, /const summary = await chatCompletion\(/, '压缩最多 1 次模型调用（主动）')
assert.ok(!chatSource.includes('composed.usage >= COMPACT_USAGE_THRESHOLD'), '已删除阈值自动压缩（普通聊天 0 自动模型调用）')
assert.ok(!chatSource.includes('compactHistory('), '已删除 slice 裁剪式压缩')
assert.ok(!chatSource.includes('saveMessagesCache(sessionId'), 'Chat 不因 compact 改动消息缓存')
// Bridge：承接 = 上一会话有限聊天尾部 + 1 次模型生成 evidence-only bridge；不再注入旧会话 Memory
assert.match(chatSource, /findBridgableSession\(activeSessionId\)/, '主动承接入口存在')
assert.match(chatSource, /\(s\.title \?\? ''\)\.trim\(\) === title/, '承接只匹配同 title（同 TA），不跨角色')
assert.match(chatSource, /bridgeInfo \|\| streaming \|\| contextBusy\) return/, '已承接后不再重复（每会话最多 1 次）')
assert.match(chatSource, /getMessagesCache\(String\(source\.id\)\)\.slice\(-BRIDGE_TAIL_COUNT\)/, '承接只取上一会话有限聊天尾部')
assert.match(chatSource, /const content = await chatCompletion\(/, '承接最多 1 次模型调用（主动）')
assert.match(chatSource, /setContextBridge\(activeSessionId, String\(source\.id\), trimmed, BRIDGE_ACTIVE_TURNS\)/, 'bridge 摘要 + 参与轮数一起写入')
assert.match(chatSource, /bridgeInfo\.content\.trim\(\)/, 'bridge 以摘要内容注入，不读旧会话记忆')
assert.ok(!chatSource.includes('getMemoriesCache(bridgeInfo.fromSessionId)'), '已删除"注入旧会话全部 Memory"行为')
assert.match(chatSource, /bridgeInfo\.turnsLeft - 1/, 'bridge 每轮递减，临时参与后退出')
// Cloud State：两个新 kind 注册（上云，不是只在本机），payload 带新语义字段
assert.match(cloudSource, /registerCloudStateAdapter\('context_compact'/, 'context_compact 注册 Cloud State')
assert.match(cloudSource, /registerCloudStateAdapter\('context_bridge'/, 'context_bridge 注册 Cloud State')
assert.match(cloudSource, /compactedAt: rec\.ts/, 'compact 标记随现有 Cloud State 同步')
assert.match(cloudSource, /summary: getContextCompactSummary/, 'compact 摘要随 Cloud State 同步')
assert.match(cloudSource, /fromSessionId: rec\.fromSessionId/, 'bridge 记录随现有 Cloud State 同步')
// 原聊天记录零删除：Chat 不新增删除类调用
assert.ok(!chatSource.includes('clearMessagesCache'), 'Chat 不清理消息缓存')
assert.ok(!chatSource.includes('deleteMessage'), 'Chat 不删除消息')

console.log('\ncontext_composer（含 PR #99 Compact/Bridge/Meter 契约）：全绿')
