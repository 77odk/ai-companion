// Event 识别自测（E2）：负向过滤 / 粗筛 / 额度 / 精判 JSON / 硬过滤 / 无 key 静默
// 覆盖 E2 单测清单：真阳性、假阳性、时间词单独不触发、未来表达被过滤、
// 硬过滤（未来时间拒 / confidence 0.5 拒）、额度（前 3 次允许第 4 次拒且不调模型）、隔离。
// 跑法：node scripts/test_event_detector.mjs
import {
  isNegativeExpression,
  coarsePass,
  localDateKey,
  judgeQuotaKey,
  getJudgeQuotaUsed,
  consumeJudgeQuota,
  parseJudgeJson,
  parseOccurredAt,
  applyEventHardFilter,
  buildEventJudgeSystemPrompt,
  EVENT_JUDGE_LIMIT,
  EVENT_CONFIDENCE_THRESHOLD,
} from '../src/lib/eventDetector.ts'
import { processEventCandidate } from '../src/lib/eventDetector.ts'
import { getEvents } from '../src/lib/eventStore.ts'

let passed = 0
let failed = 0

function ok(cond, name) {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() {
    return store.size
  },
}
function resetAll() {
  store.clear()
}

console.log('\n[1] 真阳性（共同主体 + 已发生动作 双命中）')
ok(coarsePass('我们昨天一起看了电影') === true, '「我们昨天一起看了电影」→ 候选')
ok(coarsePass('我们一起吃了饭') === true, '「我们一起吃了饭」→ 候选')
ok(coarsePass('咱们前天去了那家店') === true, '「咱们前天去了那家店」→ 候选')
ok(coarsePass('你和我一起看了日落') === true, '「你和我一起看了日落」→ 候选')
ok(coarsePass('昨天和你去了公园') === true, '「昨天和你去了公园」→ 候选（跟你）')

console.log('\n[2] 假阳性（缺主体或缺已发生动作）')
ok(coarsePass('今天工作很累') === false, '「今天工作很累」→ 不候选（无主体无动作）')
ok(coarsePass('昨天我去了纽约') === false, '「昨天我去了纽约」→ 不候选（单方面经历，无共同主体）')
ok(coarsePass('以后我们一起去巴黎') === false, '「以后我们一起去巴黎」→ 粗筛不中（去不是去了）')
ok(coarsePass('我想和你一起看电影') === false, '「我想和你一起看电影」→ 粗筛不中（看电影非看了）')
ok(coarsePass('我们周五去看电影') === false, '「我们周五去看电影」→ 粗筛不中（未来时态动作词）')
ok(coarsePass('我们打算去爬山') === false, '「我们打算去爬山」→ 粗筛不中')

console.log('\n[3] 时间词 / 关系词单独出现不触发')
ok(coarsePass('今天') === false && coarsePass('刚刚') === false && coarsePass('昨天') === false, '时间词单独不算候选')
ok(coarsePass('第一次') === false && coarsePass('终于') === false, '关系词单独不算候选')

console.log('\n[4] 负向过滤（先于一切，不耗额度）')
ok(isNegativeExpression('以后我们一起旅行') === true, '「以后我们一起旅行」→ 未来')
ok(isNegativeExpression('下周我们去看海') === true, '「下周我们去看海」→ 未来')
ok(isNegativeExpression('周五我们去露营') === true, '「周五我们去露营」→ 未来')
ok(isNegativeExpression('好想一起去看星星') === true, '「好想一起去看星星」→ 愿望')
ok(isNegativeExpression('想和你一起散步') === true, '「想和你一起散步」→ 愿望')
ok(isNegativeExpression('如果以后有机会一起去看演唱会') === true, '「如果以后有机会一起」→ 假设')
ok(isNegativeExpression('有机会一起打球') === true, '「有机会一起打球」→ 机会未定')
ok(isNegativeExpression('我们应该去过那家店') === true, '「我们应该去过那家店」→ 不确定回忆')
ok(isNegativeExpression('我们可能一起看过那部电影') === true, '「我们可能一起看过」→ 不确定')
ok(isNegativeExpression('我记得我们好像去过') === true, '「我记得我们好像去过」→ 不确定')
ok(isNegativeExpression('我们昨天一起看了电影') === false, '已发生真实经历 → 不拦（负向误伤检查）')
ok(isNegativeExpression('我们一起吃了饭') === false, '「我们一起吃了饭」→ 不拦')
ok(isNegativeExpression('') === true, '空文本直接拦')

console.log('\n[5] 额度：每会话 + 设备本地日期，每天最多 3 次，刷新不清零')
resetAll()
{
  const now = Date.now()
  ok(EVENT_JUDGE_LIMIT === 3, '限额 = 3')
  ok(judgeQuotaKey('s1', now).includes(localDateKey(now)), '额度 key 带日期')
  ok(getJudgeQuotaUsed('s1', now) === 0, '初始 0')
  ok(consumeJudgeQuota('s1', now) === true, '第 1 次允许')
  ok(consumeJudgeQuota('s1', now) === true, '第 2 次允许')
  ok(consumeJudgeQuota('s1', now) === true, '第 3 次允许')
  ok(getJudgeQuotaUsed('s1', now) === 3, '已用 3')
  ok(consumeJudgeQuota('s1', now) === false, '第 4 次拒（不调模型）')
  ok(consumeJudgeQuota('s1', now) === false, '第 5 次仍拒')
  ok(consumeJudgeQuota('s2', now) === true, '另一个会话独立额度')
  ok(consumeJudgeQuota('s1', now + 86400000) === true, '第二天额度重置')
  ok(getJudgeQuotaUsed('s1', now) === 3, '刷新页面（重新读）不清零')
}

console.log('\n[6] 精判 JSON 解析')
ok(parseJudgeJson('{"isEvent":true,"type":"meal","title":"一起吃了火锅","occurredAt":"2026-09-10","confidence":0.9,"evidence":"原文"}')?.isEvent === true, '标准 JSON')
ok(parseJudgeJson('```json\n{"isEvent":false}\n```')?.isEvent === false, '```json 围栏包裹')
ok(parseJudgeJson('思考：xxx\n{"isEvent":true,"confidence":0.8}')?.isEvent === true, '前后废话容忍')
ok(parseJudgeJson('不是 JSON') == null, '乱文 → null')
ok(parseJudgeJson('') == null, '空 → null')
ok(parseJudgeJson('{}')?.isEvent === false, '空对象 → isEvent false')

console.log('\n[7] 硬过滤：isEvent/type/title/occurredAt 不晚于现在/confidence>=0.75')
{
  const now = Date.now()
  const okIn = { isEvent: true, type: 'meal', title: '吃了饭', occurredAt: new Date(now - 86400000).toISOString(), confidence: 0.9 }
  ok(applyEventHardFilter(okIn, 's1', now) != null, '全过 → 创建入参')
  const r = applyEventHardFilter(okIn, 's1', now)
  ok(r?.source === 'chat' && r?.confidence === 0.9 && r?.sessionId === 's1', '入参带 source=chat/confidence/sessionId')

  const future = { isEvent: true, type: 'meal', title: 'x', occurredAt: new Date(now + 86400000).toISOString(), confidence: 0.9 }
  ok(applyEventHardFilter(future, 's1', now) == null, 'occurredAt 未来 → 拒')

  const lowConf = { isEvent: true, type: 'meal', title: 'x', occurredAt: new Date(now - 86400000).toISOString(), confidence: 0.5 }
  ok(applyEventHardFilter(lowConf, 's1', now) == null, 'confidence=0.5 → 拒（<0.75）')

  const notEvent = { isEvent: false, type: 'meal', title: 'x', occurredAt: new Date(now - 86400000).toISOString(), confidence: 0.9 }
  ok(applyEventHardFilter(notEvent, 's1', now) == null, 'isEvent=false → 拒')

  const badType = { isEvent: true, type: 'not-real', title: 'x', occurredAt: new Date(now - 86400000).toISOString(), confidence: 0.9 }
  ok(applyEventHardFilter(badType, 's1', now) == null, 'type 非法 → 拒')

  const noTitle = { isEvent: true, type: 'meal', title: '  ', occurredAt: new Date(now - 86400000).toISOString(), confidence: 0.9 }
  ok(applyEventHardFilter(noTitle, 's1', now) == null, 'title 空 → 拒')

  ok(EVENT_CONFIDENCE_THRESHOLD === 0.75, '阈值常量 = 0.75')
  ok(parseOccurredAt('昨天', now) == null, '相对词无法解析 → null')
  ok(parseOccurredAt('not-a-date', now) == null, '乱日期 → null')
  ok(parseOccurredAt('2026-09-10', now) != null, 'YYYY-MM-DD 可解析')
}

console.log('\n[8] 主流程：无 key 静默 + 未来表达不耗额度 + 非候选不耗额度')
resetAll()
{
  // 不配 key（settings 空）→ 即使命中候选也静默跳过，不创建、不报错
  const before = getJudgeQuotaUsed('s1', Date.now())
  let threw = false
  await processEventCandidate({ sessionId: 's1', userText: '我们昨天一起看了电影', now: Date.now() }).catch(() => {
    threw = true
  })
  ok(!threw, '无 key：processEventCandidate 不抛错')
  ok(getEvents('s1').length === 0, '无 key：不创建 Event')
  // 注意：命中候选但无 key 时额度已消耗（契约：粗筛通过即消耗额度，无 key 属于精判前静默跳过）
  // 这里只断言「不抛错、不创建」

  resetAll()
  const before2 = getJudgeQuotaUsed('s1', Date.now())
  await processEventCandidate({ sessionId: 's1', userText: '以后我们一起去巴黎', now: Date.now() })
  ok(getJudgeQuotaUsed('s1', Date.now()) === before2, '未来表达：不消耗额度')
  ok(getEvents('s1').length === 0, '未来表达：不创建')

  resetAll()
  const before3 = getJudgeQuotaUsed('s1', Date.now())
  await processEventCandidate({ sessionId: 's1', userText: '今天工作很累', now: Date.now() })
  ok(getJudgeQuotaUsed('s1', Date.now()) === before3, '非候选（假阳性）：不消耗额度')
}

console.log('\n[9] Prompt 硬规则与枚举')
{
  const p = buildEventJudgeSystemPrompt(Date.now())
  ok(p.includes('不是总结记忆') && p.includes('绝不根据记忆或计划推断事件'), 'Prompt 含不总结/不推断硬规则')
  ok(p.includes('未来计划') && p.includes('不确定的回忆'), 'Prompt 含未来/不确定拒因')
  ok(p.includes('activity') && p.includes('milestone'), 'Prompt 列出类型枚举')
  ok(p.includes('{"isEvent"'), 'Prompt 要求严格 JSON')
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)
