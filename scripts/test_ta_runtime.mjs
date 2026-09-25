// TA Runtime · truth-driven contract
// 目标：TA 此刻只来自可信的 TA 自述；无证据/过期/旧随机状态 → idle。零额外 LLM。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  ACTIVITIES,
  applyCloudTaRuntime,
  buildTaRuntimeContext,
  collectAllTaRuntime,
  detectTaRuntimeDecision,
  getOrAdvanceTaRuntime,
  getTaRuntime,
  isTaRuntimeIdle,
  isTaRuntimeState,
  runtimeDisplayLabel,
  syncTaRuntimeFromAssistantText,
  TA_RUNTIME_IDLE_ID,
} from '../src/lib/taRuntime.ts'

let pass = 0
let fail = 0
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) pass++
  else {
    fail++
    console.log(`  ✗ ${msg}\n    期望 ${e}\n    实际 ${a}`)
  }
}
function ok(cond, msg) {
  if (cond) pass++
  else {
    fail++
    console.log(`  ✗ ${msg}`)
  }
}
function group(name) { console.log(`\n== ${name} ==`) }

function makeLS() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size },
    _map: m,
  }
}
globalThis.localStorage = makeLS()
const clearLS = () => localStorage.clear()

const taSrc = readFileSync(fileURLToPath(new URL('../src/lib/taRuntime.ts', import.meta.url)), 'utf8')
const homeSrc = readFileSync(fileURLToPath(new URL('../src/components/Home.tsx', import.meta.url)), 'utf8')
const chatSrc = readFileSync(fileURLToPath(new URL('../src/components/Chat.tsx', import.meta.url)), 'utf8')
const syncSrc = readFileSync(fileURLToPath(new URL('../src/lib/sync.ts', import.meta.url)), 'utf8')

const T0 = new Date(2026, 8, 25, 18, 0, 0).getTime()
const profileKey = (sid) => `ai_companion_ai_profile_${sid}`
const setMode = (sid, mode) => {
  localStorage.setItem(profileKey(sid), JSON.stringify({ identityMode: mode, nickname: sid, avatar: '' }))
}

group('A. 无证据 = idle，不再自动抽状态')
{
  clearLS()
  const first = getOrAdvanceTaRuntime('s1', '很爱喝咖啡', T0, () => 0.99)
  eq(first.activityId, TA_RUNTIME_IDLE_ID, 'A1 首次读取直接 idle')
  eq(first.source, 'idle', 'A1 idle source 正确')
  eq(first.label, '', 'A1 idle 不伪造活动文案')
  ok(isTaRuntimeIdle(first), 'A1 isTaRuntimeIdle = true')

  const second = getOrAdvanceTaRuntime('s1', '完全不同的人设', T0 + 60_000, () => 0)
  eq(second, first, 'A2 刷新/换 rand/persona 都不创造新事实')
  ok(!/chatCompletion|streamChat/.test(taSrc), 'A3 Runtime 仍然零 LLM')
}

group('B. 旧随机状态自动退役；可信 chat 状态才可持续')
{
  clearLS()
  localStorage.setItem('ai_companion_ta_runtime', JSON.stringify({
    legacy: {
      activityId: 'coffee', label: '正在喝咖啡', startedAt: T0 - 60_000,
      plannedUntil: T0 + 60 * 60_000, updatedAt: T0 - 60_000, source: 'routine',
    },
  }))
  const migrated = getOrAdvanceTaRuntime('legacy', '', T0)
  eq(migrated.activityId, 'idle', 'B1 legacy routine 首次读取回 idle')

  const shower = syncTaRuntimeFromAssistantText('trusted', '好，我现在去洗澡。', T0, '')
  eq(shower?.activityId, 'shower', 'B2 明确当前自述 → shower')
  eq(shower?.source, 'chat', 'B2 新状态来源必须是 chat')
  const stable = getOrAdvanceTaRuntime('trusted', '', T0 + 5 * 60_000)
  eq(stable.activityId, 'shower', 'B3 未过期且身份允许 → 保持原状态')
  const expired = getOrAdvanceTaRuntime('trusted', '', (shower?.plannedUntil ?? T0) + 1)
  eq(expired.activityId, 'idle', 'B4 到期只回 idle，不随机续一个活动')
}

group('C. 角色隔离')
{
  clearLS()
  syncTaRuntimeFromAssistantText('A', '我现在在看书。', T0, '')
  getOrAdvanceTaRuntime('B', '', T0)
  eq(getTaRuntime('A')?.activityId, 'reading', 'C1 A 保持自己的 chat 状态')
  eq(getTaRuntime('B')?.activityId, 'idle', 'C2 B 独立 idle')
}

group('D. 提取只认明确的“我此刻”')
{
  eq(detectTaRuntimeDecision('好，我先去洗澡了，等会聊。'), { type: 'start', activityId: 'shower' }, 'D1 明确自我当前动作')
  eq(detectTaRuntimeDecision('我现在在看书。'), { type: 'start', activityId: 'reading' }, 'D2 当前看书')
  eq(detectTaRuntimeDecision('我正在回看我们的对话。'), { type: 'start', activityId: 'reading_chat' }, 'D3 AI-native 当前状态')
  eq(detectTaRuntimeDecision('我正在整理思绪。'), { type: 'start', activityId: 'organizing_thoughts' }, 'D4 AI-native 整理思绪')
  eq(detectTaRuntimeDecision('我晚点去洗澡。'), null, 'D5 未来计划不算此刻')
  eq(detectTaRuntimeDecision('你去洗澡吧。'), null, 'D6 对方动作不算 TA')
  eq(detectTaRuntimeDecision('我没在看书。'), null, 'D7 否定不写')
  eq(detectTaRuntimeDecision('看书这件事我一直挺挑的。'), null, 'D8 泛泛提及不写')
  eq(detectTaRuntimeDecision('洗完了。', 'shower'), { type: 'finish' }, 'D9 明确完成 → finish')
  eq(detectTaRuntimeDecision('洗完了吗？', 'shower'), null, 'D10 问句不误判完成')
}

group('E. finish 回 idle；无新证据完全不写')
{
  clearLS()
  const start = syncTaRuntimeFromAssistantText('chat', '我现在在看书。', T0, '')
  const same = syncTaRuntimeFromAssistantText('chat', '我还在看书。', T0 + 30_000, '')
  eq(same?.updatedAt, start?.updatedAt, 'E1 同一活动不反复续命')
  const finish = syncTaRuntimeFromAssistantText('chat', '看完了。', T0 + 5 * 60_000, '')
  eq(finish?.activityId, 'idle', 'E2 明确结束后直接 idle')
  eq(buildTaRuntimeContext(finish, 'zh'), '', 'E3 idle 不注入 Chat 事实')

  const before = getTaRuntime('chat')
  const noop = syncTaRuntimeFromAssistantText('chat', '这个我也不知道诶。', T0 + 6 * 60_000, '')
  eq(noop, null, 'E4 无可信动作 → null')
  eq(getTaRuntime('chat'), before, 'E4 无可信动作 → 存储不变')
}

group('F. 身份边界仍生效')
{
  clearLS()
  setMode('natural', 'natural')
  const physical = syncTaRuntimeFromAssistantText('natural', '我现在去洗澡。', T0, '')
  eq(physical, null, 'F1 Natural 不接受实体生活状态')
  const native = syncTaRuntimeFromAssistantText('natural', '我正在回看我们的对话。', T0, '')
  eq(native?.activityId, 'reading_chat', 'F2 Natural 可接受非身体化、且有自述证据的状态')

  setMode('ai', 'ai')
  const aiNative = syncTaRuntimeFromAssistantText('ai', '我正在整理思绪。', T0, '')
  eq(aiNative?.activityId, 'organizing_thoughts', 'F3 AI 可接受 AI-native 证据状态')

  clearLS()
  const immersive = syncTaRuntimeFromAssistantText('switch', '我现在在看书。', T0, '')
  eq(immersive?.activityId, 'reading', 'F4 沉浸档实体状态可由自述写入')
  setMode('switch', 'natural')
  eq(getOrAdvanceTaRuntime('switch', '', T0 + 1)?.activityId, 'idle', 'F5 切到 Natural 后不沿用不允许的实体状态')
}

group('G. 展示 / 注入')
{
  clearLS()
  const idle = getOrAdvanceTaRuntime('idle-display', '', T0)
  eq(runtimeDisplayLabel(idle, 'zh'), '', 'G1 idle 无活动 label')
  eq(runtimeDisplayLabel(idle, 'en'), '', 'G1 idle 英文也不伪造 label')

  const active = syncTaRuntimeFromAssistantText('active-display', '我现在在看书。', T0, '')
  eq(runtimeDisplayLabel(active, 'zh'), '正在看书', 'G2 zh 活动文案')
  eq(runtimeDisplayLabel(active, 'en'), 'Reading a book', 'G2 en 活动映射')
  const zh = buildTaRuntimeContext(active, 'zh')
  const en = buildTaRuntimeContext(active, 'en')
  ok(zh.includes('[source=SELF] 正在看书'), 'G3 zh context 保留 SELF 归因')
  ok(en.includes('Reading a book') && !/[\u4e00-\u9fa5]/.test(en), 'G4 en context 纯英文')
  ok(homeSrc.includes('正安静地陪着你') && homeSrc.includes('在等你'), 'G5 Home idle 文案按有无模型区分')
  ok(homeSrc.includes('isTaRuntimeIdle(runtime)'), 'G5 Home 显式识别 idle')
}

group('H. Cloud / 数据边界')
{
  clearLS()
  const cloud = {
    activityId: 'reading', label: '正在看书', startedAt: T0,
    plannedUntil: T0 + 60 * 60_000, updatedAt: T0, source: 'chat',
  }
  applyCloudTaRuntime({ cloud })
  eq(getTaRuntime('cloud')?.activityId, 'reading', 'H1 chat 来源云状态可恢复')
  ok(isTaRuntimeState(cloud), 'H2 chat state 通过 schema')
  ok(isTaRuntimeState({ ...cloud, activityId: 'idle', label: '', plannedUntil: 0, source: 'idle' }), 'H3 idle state 通过 schema')
  const all = collectAllTaRuntime()
  ok('cloud' in all, 'H4 collectAllTaRuntime 保留角色归属')
  applyCloudTaRuntime(undefined)
  eq(getTaRuntime('cloud')?.activityId, 'reading', 'H5 旧 blob 缺字段不清本地')
}

group('I. Home / Chat / Sync 接线保持')
{
  ok(chatSrc.includes('syncTaRuntimeFromAssistantText'), 'I1 Chat 仍在最终回复后写 Runtime')
  ok(chatSrc.includes('buildTaRuntimeContext'), 'I2 Chat 仍从同一 Runtime 注入')
  ok(homeSrc.includes('getOrAdvanceTaRuntime'), 'I3 Home 仍读同一 Runtime getter')
  ok(syncSrc.includes('taRuntime: collectAllTaRuntime()'), 'I4 sync collectData 仍含 taRuntime')
  ok(syncSrc.includes('applyCloudTaRuntime(d.taRuntime)'), 'I5 sync applyData 仍含 taRuntime')
  ok(!/from\s+['"].*aiBusy['"]/.test(taSrc), 'I6 Runtime 不依赖 Busy')
  ok(!/ai_companion_memory|ai_companion_anniversaries|_events/.test(taSrc), 'I7 Runtime 不写 Memory/Event/Anniversary')
  ok(ACTIVITIES.every((a) => typeof a.labelEn === 'string' && a.labelEn.length > 0), 'I8 活动映射仍保留英文展示')
}

console.log(`\n结果：${pass} 通过，${fail} 失败`)
if (fail > 0) process.exit(1)
