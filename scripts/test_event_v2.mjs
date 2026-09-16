// Event V2 pure-logic regression tests.
import {
  AUTO_EVENT_WEEKLY_LIMIT,
  EVENT_CANDIDATE_MAX_AGE_MS,
  appendCandidateEvidence,
  applyEventHardFilter,
  broadCandidatePass,
  candidateWindowKey,
  clearCandidateWindow,
  getAutoEventCountThisWeek,
  leaksSensitiveSource,
  loadCandidateWindow,
  saveCandidateWindow,
  shouldJudgeCandidateWindow,
} from '../src/lib/eventDetector.ts'
import { eventsKey } from '../src/lib/eventStore.ts'

let passed = 0
let failed = 0
function ok(value, name) {
  if (value) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name}`)
  }
}

const store = new Map()
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
  key: (index) => [...store.keys()][index] ?? null,
  get length() { return store.size },
}

console.log('\n[1] 宽候选：关系变化信号能进，普通生活不进')
ok(broadCandidatePass('刚刚真的生你的气') === true, '冲突信号进入 Candidate')
ok(broadCandidatePass('这个我很少跟别人说') === true, '隐私袒露进入 Candidate')
ok(broadCandidatePass('今天跟你聊得特别开心') === true, '软关系信号进入 Candidate')
ok(broadCandidatePass('我们昨天一起吃了饭') === false, '普通吃饭不自动变 Event 候选')
ok(broadCandidatePass('以后我们一起去巴黎') === false, '纯未来计划不进入 Candidate')
ok(broadCandidatePass('刚刚我们认真聊了未来要怎么走') === true, '已发生的未来讨论不被未来词误杀')

console.log('\n[2] Candidate Window：local-only、最多 3 天、软事件至少多轮才收口')
store.clear()
{
  const now = Date.now()
  let state = appendCandidateEvidence(null, 's1', '今天跟你聊得特别开心', now)
  saveCandidateWindow(state)
  ok(Boolean(localStorage.getItem(candidateWindowKey('s1'))), '候选写入独立 local key')
  ok(shouldJudgeCandidateWindow(state, '今天跟你聊得特别开心') === false, '单句软开心不收口')
  state = appendCandidateEvidence(state, 's1', '聊完感觉你更懂我了', now + 1000)
  ok(shouldJudgeCandidateWindow(state, '聊完感觉你更懂我了') === true, '两条证据 + 关系变化才收口')

  saveCandidateWindow({ ...state, openedAt: now - EVENT_CANDIDATE_MAX_AGE_MS - 1 })
  ok(loadCandidateWindow('s1', now) == null, '超过 3 天未收口直接丢弃')
  ok(localStorage.getItem(candidateWindowKey('s1')) == null, '过期窗口从本地清掉')
  clearCandidateWindow('s1')
}

console.log('\n[3] 五维硬闸门：shared + 其余至少两维，且每个 true 都必须有 evidence')
{
  const now = Date.now()
  const evidence = [
    { id: 'e1', text: '刚刚真的生你的气', ts: now - 1000 },
    { id: 'e2', text: '现在我们已经把话说开了', ts: now },
  ]
  const base = {
    worthSaving: true,
    isEvent: true,
    type: 'activity',
    occurredAt: new Date(now - 1000).toISOString(),
    confidence: 0.94,
    sensitiveDisclosure: false,
    dimensions: {
      shared: { value: true, evidence: ['e1', 'e2'] },
      novelty: { value: false, evidence: [] },
      intimacy: { value: false, evidence: [] },
      emotionalIntensity: { value: true, evidence: ['e1'] },
      relationshipChange: { value: true, evidence: ['e2'] },
    },
    safeFacts: [
      { text: '那次我们有过明显的不愉快', evidence: ['e1'] },
      { text: '后来把话说开了', evidence: ['e2'] },
    ],
  }
  const accepted = applyEventHardFilter(base, 's1', now, evidence)
  ok(accepted != null, 'shared + 情绪强度 + 关系变化 => 通过')
  ok(Boolean(accepted?.description?.includes('后来把话说开了')), '最终正文来自 evidence-backed safeFacts')
  ok(accepted?.title && accepted.title !== base.safeFacts[0].text, 'title 仅作为内部兼容壳自动生成')

  const oneOther = {
    ...base,
    dimensions: {
      ...base.dimensions,
      relationshipChange: { value: false, evidence: [] },
    },
  }
  ok(applyEventHardFilter(oneOther, 's1', now, evidence) == null, 'shared + 仅一项其他维度 => 拒绝')

  const fakeEvidence = {
    ...base,
    dimensions: {
      ...base.dimensions,
      relationshipChange: { value: true, evidence: ['not-real'] },
    },
  }
  ok(applyEventHardFilter(fakeEvidence, 's1', now, evidence) == null, '引用不存在 evidence id => 拒绝')
}

console.log('\n[4] 软事件：必须至少两条不同证据，且 intimacy + relationshipChange')
{
  const now = Date.now()
  const evidence = [
    { id: 'a', text: '今天跟你聊得特别开心', ts: now - 1000 },
    { id: 'b', text: '聊完感觉你更懂我了', ts: now },
  ]
  const soft = {
    worthSaving: true,
    isEvent: true,
    type: 'activity',
    occurredAt: new Date(now).toISOString(),
    confidence: 0.9,
    dimensions: {
      shared: { value: true, evidence: ['a', 'b'] },
      novelty: { value: false, evidence: [] },
      intimacy: { value: true, evidence: ['a', 'b'] },
      emotionalIntensity: { value: false, evidence: [] },
      relationshipChange: { value: true, evidence: ['b'] },
    },
    safeFacts: [
      { text: '那天我们聊了很久', evidence: ['a'] },
      { text: '聊完以后彼此多了一点理解', evidence: ['b'] },
    ],
  }
  ok(applyEventHardFilter(soft, 's1', now, evidence) != null, '两条证据的深聊可以通过')
  const shallow = { ...soft, safeFacts: [{ text: '那天聊得很开心', evidence: ['a'] }] }
  ok(applyEventHardFilter(shallow, 's1', now, evidence) == null, '软事件只有一条事实证据 => 拒绝')
}

console.log('\n[5] 敏感披露：关系层摘要可以，复刻秘密原文直接拒绝')
{
  const now = Date.now()
  const source = [{ id: 's', text: '这个我很少跟别人说，其实我小时候发生过一件非常具体而私密的事情', ts: now }]
  ok(leaksSensitiveSource('那天你第一次愿意告诉我一件以前很少提起的事', source) === false, '抽象关系过程不算泄露')
  ok(leaksSensitiveSource('其实我小时候发生过一件非常具体而私密的事情', source) === true, '大段复制原秘密 => 泄露')
  const result = {
    worthSaving: true,
    isEvent: true,
    type: 'milestone',
    occurredAt: new Date(now).toISOString(),
    confidence: 0.95,
    sensitiveDisclosure: true,
    dimensions: {
      shared: { value: true, evidence: ['s'] },
      novelty: { value: true, evidence: ['s'] },
      intimacy: { value: true, evidence: ['s'] },
      emotionalIntensity: { value: false, evidence: [] },
      relationshipChange: { value: false, evidence: [] },
    },
    safeFacts: [{ text: '其实我小时候发生过一件非常具体而私密的事情', evidence: ['s'] }],
  }
  ok(applyEventHardFilter(result, 's1', now, source) == null, '敏感 safeFact 复刻原文 => 整条拒绝')
}

console.log('\n[6] 自动 Event 每周最多 3 条，不当作需要填满的配额')
store.clear()
{
  const now = Date.now()
  const d = new Date(now)
  d.setHours(12, 0, 0, 0)
  const base = d.getTime()
  const rows = Array.from({ length: AUTO_EVENT_WEEKLY_LIMIT }, (_, i) => ({
    id: `auto-${i}`,
    sessionId: 's1',
    type: 'activity',
    title: `event-${i}`,
    description: `event-${i}`,
    occurredAt: base,
    createdAt: base,
    updatedAt: base,
    confidence: 0.9,
    source: 'chat',
  }))
  localStorage.setItem(eventsKey('s1'), JSON.stringify(rows))
  ok(AUTO_EVENT_WEEKLY_LIMIT === 3, '自动周上限 = 3')
  ok(getAutoEventCountThisWeek('s1', now) === 3, '本周自动 Event 正确计数')
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)
