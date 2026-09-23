import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { composeContext, CONTEXT_HARD_BUDGET, COMPACT_INPUT_BUDGET, buildCompactedHistory, buildCompactSource, COMPACT_KEEP_RECENT, BRIDGE_ACTIVE_TURNS, BRIDGE_INPUT_BUDGET, BRIDGE_TAIL_COUNT } from '../src/lib/contextComposer.ts'
import { estimateToken } from '../src/lib/token.ts'

const core = [{ role: 'system', content: 'core persona' }]
const history = Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'history '.repeat(100) }))
const tail = [{ role: 'system', content: 'current time tail' }]
const result = composeContext(core, history, [], tail, 500)

assert.ok(result.totalTokens <= 500, 'final payload must stay inside supplied hard budget')
assert.deepEqual(result.messages[0], core[0], 'core must stay first')
assert.deepEqual(result.messages.at(-1), tail[0], 'time tail must stay last and count inside budget')
assert.equal(result.totalTokens, result.messages.reduce((sum, m) => sum + estimateToken(m.content), 0))
assert.equal(result.overBudget, false, 'normal payload is not over budget')

const hugeNewest = composeContext(core, [{ role: 'user', content: '超'.repeat(2000) }], [], tail, 500)
assert.equal(hugeNewest.overBudget, true, 'single oversized newest message must be rejected instead of breaking hard cap')
assert.ok(hugeNewest.totalTokens <= 500, 'over-budget marker must still keep composed payload under hard cap')

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
const compactInput = buildCompactSource(Array.from({ length: 200 }, () => ({ role: 'user', content: '较老历史 '.repeat(1000) })))
assert.ok(compactInput.reduce((sum, m) => sum + estimateToken(m.content), 0) <= COMPACT_INPUT_BUDGET, 'Compact 单次模型输入受安全预算限制')

// ── PR #99：Bridge 常量 + 块可被 composer 纳入（memory 优先级）──
console.log('\n[bridge] evidence-only bridge 块注入')
assert.equal(BRIDGE_ACTIVE_TURNS, 8, 'bridge 临时参与轮数 = 8（约 6–10）')
assert.equal(BRIDGE_INPUT_BUDGET, 42000, 'Bridge 单次模型输入预算 = 42k')
assert.equal(BRIDGE_TAIL_COUNT, 30, '承接只取上一会话最近 30 条聊天尾部')
const bridgeInput = buildCompactSource(Array.from({ length: 30 }, () => ({ role: 'user', content: '上一段 '.repeat(4000) })), BRIDGE_INPUT_BUDGET)
assert.ok(bridgeInput.reduce((sum, m) => sum + estimateToken(m.content), 0) <= BRIDGE_INPUT_BUDGET, 'Bridge 单次模型输入同时受 token 预算限制')
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
setContextBridge('S1', 'S0', '交接摘要', 8, 777)
const bridgedState = getContextBridge('S1')
assert.ok(bridgedState, '承接状态可回读')
assert.equal(bridgedState.fromSessionId, 'S0', '承接来源正确')
assert.equal(bridgedState.content, '交接摘要', 'bridge 摘要可回读')
assert.equal(bridgedState.turnsLeft, 8, '初始参与轮数 = 8')
assert.equal(bridgedState.bridgedAt, 777, 'Bridge 可保留 canonical bridgedAt')
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
const syncSource = readFileSync(new URL('../src/lib/sync.ts', import.meta.url), 'utf8')
const promptSource = readFileSync(new URL('../src/lib/chatPrompts.ts', import.meta.url), 'utf8')
// Meter：session 级持久化；真实 usage 优先校准当前上下文总量，无 usage 才用 compose 估算
assert.match(chatSource, /context-meter-slot/, 'Meter 控件渲染')
assert.match(chatSource, /getContextUsage\(activeSessionId\)/, '进入会话从 session 持久化恢复 Meter')
assert.match(chatSource, /setContextUsage\(estimatedContextState, activeSessionId\)/, '发送时估算 Meter 持久化')
assert.match(chatSource, /used: composed\.totalTokens,[\s\S]*source: 'estimate',[\s\S]*inputTokens: composed\.totalTokens/, '发送前保留本地输入估算')
assert.match(chatSource, /used: usage\.promptTokens \+ \(outputTokens \?\? 0\)/, 'provider usage 返回后用真实 prompt + output 校准当前上下文总量')
assert.match(chatSource, /setContextUsage\(actualContextState, activeSessionId\)/, '真实 usage 结果写回 session 持久化')
assert.match(chatSource, /if \(composed\.overBudget\)/, '超过 64k 时在 provider 调用前停止')
assert.doesNotMatch(chatSource, /buildTimeContext\(Date\.now\(\), lang\)/, 'Chat 不再重复追加第二份当前时间')
assert.match(promptSource, /【此刻时间】/, 'System Prompt 仍保留当前时间注入')
// Compact：用户主动触发 + 1 次模型生成 summary + summary/recent raw 注入 + 不删原记录
assert.match(chatSource, /buildCompactedHistory\(compactSummary, history, COMPACT_KEEP_RECENT\)/, '已压缩后注入 = summary + 最近原始消息')
assert.match(chatSource, /setContextCompactSummary\(trimmed, activeSessionId\)/, '模型生成的摘要持久化')
assert.match(chatSource, /setContextCompactAt\(Date\.now\(\), activeSessionId\)/, '压缩成功记录时间戳')
assert.match(chatSource, /const compactBoundary = sessionStart/, 'Compact 发起时捕获刷新边界')
assert.match(chatSource, /getSessionStart\(activeSessionId\) !== compactBoundary/, 'Compact 写回前必须确认刷新边界未变化')
assert.match(chatSource, /compactedAt >= sessionStart/, 'Compact 只对当前刷新段生效')
assert.match(chatSource, /const summary = await chatCompletion\(/, '压缩最多 1 次模型调用（主动）')
assert.ok(!chatSource.includes('composed.usage >= COMPACT_USAGE_THRESHOLD'), '已删除阈值自动压缩（普通聊天 0 自动模型调用）')
assert.ok(!chatSource.includes('compactHistory('), '已删除 slice 裁剪式压缩')
const compactSection = chatSource.slice(
  chatSource.indexOf('const handleCompact = async () =>'),
  chatSource.indexOf('const handleBridge = async () =>'),
)
assert.ok(!compactSection.includes('saveMessagesCache('), 'Compact 不改动消息缓存')
// Bridge：承接 = 上一会话有限聊天尾部 + 1 次模型生成 evidence-only bridge；不再注入旧会话 Memory
assert.match(chatSource, /hasBridgableHistory\(messages, sessionStart\)/, 'Bridge 只由同一 session 的刷新边界控制')
assert.match(chatSource, /messages\.filter\(\(message\) => message\.ts < sessionStart\)\.slice\(-BRIDGE_TAIL_COUNT\)/, 'Bridge 只取同一 session 刷新前有限尾部')
assert.match(chatSource, /buildCompactSource\(bridgeHistory, BRIDGE_INPUT_BUDGET\)/, 'Bridge 尾部除了条数上限，还必须受 token 预算限制')
assert.match(chatSource, /const bridgeBoundary = sessionStart/, 'Bridge 发起时捕获刷新边界')
assert.match(chatSource, /getSessionStart\(activeSessionId\) !== bridgeBoundary/, 'Bridge 写回前必须确认刷新边界未变化')
assert.ok(!chatSource.includes("(s.title ?? '').trim() === title"), '禁止用可编辑 title 猜角色身份')
assert.match(chatSource, /bridgeInfo \|\| streaming \|\| contextBusy\) return/, '已承接后不再重复（每会话最多 1 次）')
assert.match(chatSource, /const content = await chatCompletion\(/, '承接最多 1 次模型调用（主动）')
assert.match(chatSource, /setContextBridge\(activeSessionId, activeSessionId, trimmed, BRIDGE_ACTIVE_TURNS, bridgedAt\)/, 'bridge 只记录同一 session 的刷新前承接')
assert.match(chatSource, /bridgeInfo\.bridgedAt >= sessionStart/, '旧刷新段的 bridge 不得重新注入当前上下文')
assert.match(chatSource, /bridgeInfo\.content\.trim\(\)/, 'bridge 以摘要内容注入，不读旧会话记忆')
assert.ok(!chatSource.includes('getMemoriesCache(bridgeInfo.fromSessionId)'), '已删除"注入旧会话全部 Memory"行为')
assert.match(chatSource, /bridgeInfo\.turnsLeft - 1/, 'bridge 每轮递减，临时参与后退出')
// 同步：Context 只并入既有 /api/sync 全量 blob，不注册第二套 /api/state kind
assert.match(syncSource, /contextCompacts: collectAllContextCompacts\(\)/, 'compact 进入 collectData 全量 blob')
assert.match(syncSource, /contextBridges: collectAllContextBridges\(\)/, 'bridge 进入 collectData 全量 blob')
assert.match(syncSource, /applyCloudContextCompacts\(d\.contextCompacts\)/, 'compact 从全量 blob 恢复')
assert.match(syncSource, /applyCloudContextBridges\(d\.contextBridges\)/, 'bridge 从全量 blob 恢复')
assert.ok(!cloudSource.includes("registerCloudStateAdapter('context_compact'"), '不再注册 context_compact /api/state adapter')
assert.ok(!cloudSource.includes("registerCloudStateAdapter('context_bridge'"), '不再注册 context_bridge /api/state adapter')
// 原聊天记录零删除：Chat 不新增删除类调用
assert.ok(!chatSource.includes('clearMessagesCache'), 'Chat 不清理消息缓存')
assert.ok(!chatSource.includes('deleteMessage'), 'Chat 不删除消息')

console.log('\ncontext_composer（含 PR #99 Compact/Bridge/Meter 契约）：全绿')