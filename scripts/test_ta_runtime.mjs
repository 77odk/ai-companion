// TA Runtime · truth-driven contract
// 目标：TA 此刻只来自可信的 TA 自述；无证据/过期/旧随机状态 → idle。零额外 LLM。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  ACTIVITIES,
  applyCloudTaRuntime,
  buildTaRuntimeContext,
  shouldInjectTaRuntimeContext,
  collectAllTaRuntime,
  detectTaContinuityFromAssistantText,
  detectTaRuntimeDecision,
  getOrAdvanceTaRuntime,
  getTaContinuity,
  getTaRuntime,
  isTaRuntimeIdle,
  isTaRuntimeState,
  runtimeDisplayLabel,
  syncTaRuntimeFromAssistantText,
  TA_OPEN_THREAD_TTL_MS,
  TA_SELF_INTENT_TTL_MS,
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
const memorySrc = readFileSync(fileURLToPath(new URL('../src/components/Memory.tsx', import.meta.url)), 'utf8')
const chatSrc = readFileSync(fileURLToPath(new URL('../src/components/Chat.tsx', import.meta.url)), 'utf8') + '\n' + readFileSync(fileURLToPath(new URL('../src/lib/chatContextBuild.ts', import.meta.url)), 'utf8') + '\n' + readFileSync(new URL('../src/lib/chatStreamEngine.ts', import.meta.url), 'utf8')
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
  eq(runtimeDisplayLabel(shower, 'zh'), '去洗澡', 'B2 状态层优先显示 TA 自己刚说的话，而不是固定标签')
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
  eq(same?.updatedAt, start?.updatedAt, 'E1 同一活动同一精简原话不反复写')
  const richer = syncTaRuntimeFromAssistantText('chat', '我还在看小说呢。', T0 + 60_000, '')
  eq(richer?.plannedUntil, start?.plannedUntil, 'E1b 同一活动刷新原话不延长 plannedUntil')
  eq(runtimeDisplayLabel(richer, 'zh'), '看小说呢', 'E1b 同一活动可刷新成 TA 后续更具体的原话')
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
  eq(runtimeDisplayLabel(native, 'zh'), '回看我们的对话', 'F2 Natural 状态层只展示有证据的非身体化原话')

  setMode('ai', 'ai')
  const aiNative = syncTaRuntimeFromAssistantText('ai', '我正在整理思绪。', T0, '')
  eq(aiNative?.activityId, 'organizing_thoughts', 'F3 AI 可接受 AI-native 证据状态')
  eq(runtimeDisplayLabel(aiNative, 'zh'), '整理思绪', 'F3 AI 状态层展示 AI-native 原话')

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
  eq(runtimeDisplayLabel(active, 'zh'), '看书', 'G2 zh 优先角色原话精简')
  eq(runtimeDisplayLabel(active, 'en'), 'Reading a book', 'G2 跨语言仍回落活动映射，不硬显示旧语言')
  const zh = buildTaRuntimeContext(active, 'zh')
  const en = buildTaRuntimeContext(active, 'en')
  ok(zh.includes('[source=SELF] 看书'), 'G3 zh context 与 Home 使用同一条角色原话')
  ok(en.includes('Reading a book') && !/[\u4e00-\u9fa5]/.test(en), 'G4 en context 纯英文')
  const mixed = syncTaRuntimeFromAssistantText('mixed-display', '我现在在看书《The Great Gatsby》。', T0, '')
  eq(mixed?.displayLang, 'zh', 'G4b 中英混合标题不改变中文语法归属')
  eq(runtimeDisplayLabel(mixed, 'zh'), '看书《The Great Gatsby》', 'G4b 中文状态层保留 TA 原话精简')
  eq(runtimeDisplayLabel(mixed, 'en'), 'Reading a book', 'G4b 英文 Home 回落英文活动映射，不显示中文句式')
  const mixedEn = syncTaRuntimeFromAssistantText('mixed-display-en', "I'm reading 《看书》", T0, '')
  eq(mixedEn?.displayLang, 'en', 'G4c 英文主句里的中文书名不改变英文语法归属')
  eq(runtimeDisplayLabel(mixedEn, 'en'), 'reading 《看书》', 'G4c 英文状态层保留英文主句精简')
  eq(runtimeDisplayLabel(mixedEn, 'zh'), '正在看书', 'G4c 中文 Home 回落中文活动映射，不显示英文句式')
  const crossRuleZh = syncTaRuntimeFromAssistantText('cross-rule-zh', '我正在看书《Cooking》。', T0, '')
  eq(crossRuleZh?.activityId, 'reading', 'G4d 中文主句不会被英文标题里的另一活动词抢走')
  eq(crossRuleZh?.displayLang, 'zh', 'G4d 中文主句活动与展示语言同源')
  const crossRuleEn = syncTaRuntimeFromAssistantText('cross-rule-en', "I'm reading a novel called 《看电影》", T0, '')
  eq(crossRuleEn?.activityId, 'reading', 'G4e 英文主句不会被中文标题里的另一活动词抢走')
  eq(crossRuleEn?.displayLang, 'en', 'G4e 英文主句活动与展示语言同源')
  const prefixedIncidental = syncTaRuntimeFromAssistantText('grammar-anchor-en', "《看书》 is beside me while I'm cooking dinner", T0, '')
  eq(prefixedIncidental?.activityId, 'cooking', 'G4f 当前动作语法锚点之前的标题命中不会抢活动')
  eq(prefixedIncidental?.displayLang, 'en', 'G4f 当前动作语法锚点决定展示语言')
  const detachedActivity = syncTaRuntimeFromAssistantText('grammar-detached-en', 'I am beside 《看书》 while cooking dinner', T0, '')
  eq(detachedActivity, null, 'G4g 当前语法后没有直接活动匹配时不跨句硬猜 Runtime')
  const codeSwitched = syncTaRuntimeFromAssistantText('grammar-code-switch', 'I am 做饭', T0, '')
  eq(codeSwitched, null, 'G4h 中英混写但无同语言直接活动匹配时 fail closed')
  ok(memorySrc.includes('getTaStateDashboard'), 'G5 朝暮状态层读取真实 TA state dashboard')
  ok(!memorySrc.includes('runtimeDisplayLabel'), 'G5 朝暮首层不再混入 Runtime 活动解释文案')
}

group('G2. Runtime 只做当前态句式门，活动语义交给模型')
{
  const zhQueries = [
    '你在干嘛？',
    '在做什么',
    '你这会儿干什么呢',
    '还在忙吗',
    '忙完没',
    '到家了吗',
    '回来了吗',
    '你现在在做什么',
    '还在喝咖啡吗？',
    '还在喝咖啡吗',
    '还在遛狗吗？',
    '还在弄那个方案吗？',
    '你还在画画吗',
    '喝咖啡吗',
    '你现在在哪儿',
    '你到哪了',
    '你现在怎么样',
    '睡了吗',
    '醒了吗',
    '起床了吗',
    '吃饭了吗',
  ]
  for (const text of zhQueries) {
    ok(shouldInjectTaRuntimeContext(text, 'zh'), `G2 当前态候选命中：${text}`)
  }

  // 本地门只看句式，不承担语义理解；这些句子也可进入候选上下文，
  // 由本轮原本就会调用的模型判断“是不是在问 TA 自己”，无额外 LLM。
  for (const text of [
    '还在下雨吗？',
    '还在营业吗？',
    '你喜欢喝咖啡吗',
  ]) {
    ok(shouldInjectTaRuntimeContext(text, 'zh'), `G2 语义交给模型：${text}`)
  }

  const enQueries = [
    'What are you doing right now?',
    'Are you still busy?',
    'Are you still sketching?',
    'Did you get home?',
    'Where are you now?',
  ]
  for (const text of enQueries) {
    ok(shouldInjectTaRuntimeContext(text, 'en'), `G2 EN 候选命中：${text}`)
  }

  for (const text of [
    '我今天吃了饺子',
    '到家了',
    '我还在忙呢',
    '我现在在干嘛？',
    '他还在忙吗？',
    '你觉得我现在怎么样？',
    '你觉得这件事怎么样',
    '我们继续刚才的话题',
    'Tell me what you think about this',
  ]) {
    ok(!shouldInjectTaRuntimeContext(text, 'zh'), `G2 明显非当前态候选不注入：${text}`)
  }

  const active = syncTaRuntimeFromAssistantText('runtime-query', '我现在在看书。', T0, '')
  const ctx = buildTaRuntimeContext(active, 'zh')
  ok(ctx.includes('如果不是，就完全忽略下面这条状态'), 'G2 模型负责判断候选 Runtime 是否与用户问题相关')
  ok(ctx.includes('不得补写地点、人物、食物、原因、前后经过或其他生活细节'), 'G2 相关时也不得从状态扩写生活细节')
}

group('G3. 连续性 evidence：未完问题 / TA 自己想继续的事')
{
  clearLS()
  const openOnly = detectTaContinuityFromAssistantText('我明白。那你为什么会这么想？', T0)
  eq(openOnly?.openThread?.kind, 'open-question', 'G3-1 真实 TA 问句进入 openThread')
  eq(openOnly?.openThread?.text, '那你为什么会这么想？', 'G3-1 保存可追溯的 TA 原句')
  eq(openOnly?.openThread?.evidenceAt, T0, 'G3-1 evidenceAt = 最终回复落库时间')
  eq(openOnly?.openThread?.expiresAt, T0 + TA_OPEN_THREAD_TTL_MS, 'G3-1 openThread TTL 固定')

  const service = detectTaContinuityFromAssistantText('还有什么我能帮你的吗？', T0)
  eq(service, undefined, 'G3-2 客服式兜底问句不进入未完话题')

  const selfIntent = detectTaContinuityFromAssistantText('下次我还想继续听你讲这个。', T0)
  eq(selfIntent?.selfIntent?.kind, 'self-intent', 'G3-3 TA 明确后续意图进入 selfIntent')
  eq(selfIntent?.selfIntent?.text, '下次我还想继续听你讲这个。', 'G3-3 selfIntent 保存真实原句')
  eq(selfIntent?.selfIntent?.expiresAt, T0 + TA_SELF_INTENT_TTL_MS, 'G3-3 selfIntent TTL 固定')

  eq(
    detectTaContinuityFromAssistantText('你下次记得早点睡。', T0),
    undefined,
    'G3-4 对用户的未来建议不能冒充 TA 自己的后续意图',
  )
  eq(
    detectTaContinuityFromAssistantText('我明天去跑步。', T0),
    undefined,
    'G3-4 普通未来生活计划不作为关系连续性意图',
  )

  const en = detectTaContinuityFromAssistantText("Next time I'd like to ask you more about that. What made you feel that way?", T0)
  eq(en?.selfIntent?.kind, 'self-intent', 'G3-5 英文明确后续意图可识别')
  eq(en?.openThread?.kind, 'open-question', 'G3-5 英文真实问句可识别')
}

group('G4. 连续性生命周期与当前活动互不打架')
{
  clearLS()
  const first = syncTaRuntimeFromAssistantText('continuity', '下次我还想继续听你讲这个。那你为什么会这么想？', T0, '')
  eq(first?.activityId, 'idle', 'G4-1 只有连续性 evidence 时仍复用同一 Runtime idle，不造新活动')
  eq(first?.continuity?.openThread?.text, '那你为什么会这么想？', 'G4-1 openThread 已写入')
  eq(first?.continuity?.selfIntent?.text, '下次我还想继续听你讲这个。', 'G4-1 selfIntent 已写入')

  const answered = syncTaRuntimeFromAssistantText('continuity', '嗯，我听懂了。', T0 + 60_000, '')
  eq(answered?.continuity?.openThread, undefined, 'G4-2 下一轮 TA 回复完成后，旧 openThread 视为已回应并清掉')
  eq(answered?.continuity?.selfIntent?.text, '下次我还想继续听你讲这个。', 'G4-2 selfIntent 不因普通下一轮消失')

  eq(
    getTaContinuity('continuity', T0 + TA_SELF_INTENT_TTL_MS + 1),
    null,
    'G4-3 TTL 到期后读取不到旧连续性，不把陈年话题复活',
  )

  clearLS()
  const active = syncTaRuntimeFromAssistantText(
    'activity-continuity',
    '我现在在看书。下次我还想继续听你讲这个。你最近为什么总想到这件事？',
    T0,
    '',
  )
  eq(active?.activityId, 'reading', 'G4-4 当前活动照常写入')
  ok(Boolean(active?.continuity?.openThread && active?.continuity?.selfIntent), 'G4-4 同一 Runtime 同时持有活动与连续性 evidence')
  const afterActivity = getOrAdvanceTaRuntime('activity-continuity', '', (active?.plannedUntil ?? T0) + 1)
  eq(afterActivity.activityId, 'idle', 'G4-5 活动到期仍只回 idle')
  ok(Boolean(afterActivity.continuity?.openThread && afterActivity.continuity?.selfIntent), 'G4-5 活动到期不误删仍在 TTL 内的连续性 evidence')

  clearLS()
  syncTaRuntimeFromAssistantText('A', '下次我还想继续听你讲这个。', T0, '')
  eq(getTaContinuity('B', T0), null, 'G4-6 连续性按 session 隔离，B 读不到 A')
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
  ok(isTaRuntimeState({ ...cloud, displayText: '看书', displayLang: 'zh' }), 'H2b 原话展示字段通过 schema')
  ok(!isTaRuntimeState({ ...cloud, displayText: '看书', displayLang: 'jp' }), 'H2c 非法 displayLang 被拒绝')
  const continuityCloud = {
    ...cloud,
    updatedAt: T0 + 1,
    continuity: {
      openThread: {
        kind: 'open-question',
        text: '那你后来怎么想？',
        evidenceAt: T0,
        expiresAt: T0 + TA_OPEN_THREAD_TTL_MS,
      },
      selfIntent: {
        kind: 'self-intent',
        text: '下次我还想继续听你讲这个。',
        evidenceAt: T0,
        expiresAt: T0 + TA_SELF_INTENT_TTL_MS,
      },
    },
  }
  ok(isTaRuntimeState(continuityCloud), 'H2d 合法 continuity 通过 Runtime schema')
  ok(!isTaRuntimeState({
    ...continuityCloud,
    continuity: {
      openThread: { ...continuityCloud.continuity.openThread, kind: 'self-intent' },
    },
  }), 'H2e continuity kind 不匹配时拒绝')
  applyCloudTaRuntime({ cloud: continuityCloud })
  eq(getTaRuntime('cloud')?.continuity?.openThread?.text, '那你后来怎么想？', 'H2f legacy/cloud Runtime LWW 保留 continuity evidence')
  ok(isTaRuntimeState({ ...cloud, activityId: 'idle', label: '', plannedUntil: 0, source: 'idle' }), 'H3 idle state 通过 schema')
  const all = collectAllTaRuntime()
  ok('cloud' in all, 'H4 collectAllTaRuntime 保留角色归属')
  applyCloudTaRuntime(undefined)
  eq(getTaRuntime('cloud')?.activityId, 'reading', 'H5 旧 blob 缺字段不清本地')
}

group('I. 朝暮 / Chat / Sync 接线保持')
{
  ok(chatSrc.includes('syncTaRuntimeFromAssistantText'), 'I1 Chat 仍在最终回复后写 Runtime')
  ok(chatSrc.includes('buildTaRuntimeContext'), 'I2 Chat 仍从同一 Runtime 注入')
  ok(chatSrc.includes('if (shouldInjectTaRuntimeContext(text, lang))'), 'I2 Chat 仅在明确询问当前状态时注入 Runtime')
  ok(memorySrc.includes('getTaStateDashboard'), 'I3 朝暮状态层读取 taState 的 2 轴 + 7 倾向 dashboard')
  ok(syncSrc.includes('taRuntime: collectAllTaRuntime()'), 'I4 sync collectData 仍含 taRuntime')
  ok(syncSrc.includes('applyCloudTaRuntime(d.taRuntime)'), 'I5 sync applyData 仍含 taRuntime')
  ok(!/from\s+['"].*aiBusy['"]/.test(taSrc), 'I6 Runtime 不依赖 Busy')
  ok(!/from\s+['"].*(?:memory|eventStore|anniversary|futureIntent)['"]/.test(taSrc), 'I7 Runtime 不 import Memory/Event/Anniversary/FutureIntent 数据层')
  ok(!/ai_companion_memory|ai_companion_anniversaries|_events/.test(taSrc), 'I7 Runtime 不写 Memory/Event/Anniversary')
  ok(ACTIVITIES.every((a) => typeof a.labelEn === 'string' && a.labelEn.length > 0), 'I8 活动映射仍保留英文展示')
}

console.log(`\n结果：${pass} 通过，${fail} 失败`)
if (fail > 0) process.exit(1)
