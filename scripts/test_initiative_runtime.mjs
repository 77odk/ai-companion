import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildInitiativeMessages,
  cleanInitiativeReply,
  resetInitiativeRuntimeForTests,
  runInitiativeCatchUp,
} from '../src/lib/initiativeRuntime.ts'
import { evaluateInitiativeResponse } from '../src/lib/initiativePolicy.ts'

const NOW = new Date(2026, 9, 8, 15, 0, 0).getTime()

function pref(patch = {}) {
  return {
    enabled: true,
    dailyLimit: 2,
    quietStartHour: 23,
    quietEndHour: 8,
    lastDeliveredAt: 0,
    deliveredDay: '',
    deliveredCount: 0,
    ignoredStreak: 0,
    lastCandidateKey: '',
    lastBackgroundAt: NOW - 3 * 60 * 60 * 1000,
    lastResponseEvaluatedAt: 0,
    ...patch,
  }
}

function futureCandidate() {
  return {
    key: 'future:2026-10-08:1:今天一起看电影',
    reason: 'future-intent',
    evidence: '今天一起看电影',
    evidenceAt: NOW - 86400000,
    priority: 300,
  }
}

function policyInput(preference = pref()) {
  return {
    preference,
    leftAt: preference.lastBackgroundAt,
    now: NOW,
    futureTopics: [{ t: '今天一起看电影', ts: NOW - 86400000, futureDay: '2026-10-08' }],
    events: [],
    anniversaries: [],
  }
}

function context() {
  return {
    sessionId: '1',
    taName: '阿文',
    persona: '温柔、自然，不说客服话。',
    lang: 'zh',
    identityMode: 'immersive',
  }
}

console.log('[initiative-runtime] 无真实理由 = 零模型调用')
{
  let generateCount = 0
  const p = pref()
  const outcome = await runInitiativeCatchUp(
    {
      preference: p,
      leftAt: p.lastBackgroundAt,
      now: NOW,
      futureTopics: [],
      events: [],
      anniversaries: [],
    },
    context(),
    {
      estimateTokens: (text) => Math.max(1, Math.ceil(text.length / 4)),
      generate: async () => {
        generateCount += 1
        return { text: '不应该被调用' }
      },
      commit: async () => true,
      recordUsage: () => {},
      savePreference: () => true,
      now: () => NOW,
    },
  )
  assert.equal(outcome, 'disabled-or-no-reason')
  assert.equal(generateCount, 0)
}

console.log('[initiative-runtime] 有理由只做一次短生成，成功后才增加投递次数')
{
  resetInitiativeRuntimeForTests()
  let generateCount = 0
  let commitCount = 0
  let recorded = null
  const saved = []
  const outcome = await runInitiativeCatchUp(
    policyInput(),
    context(),
    {
      estimateTokens: (text) => Math.max(1, Math.ceil(text.length / 4)),
      generate: async (messages) => {
        generateCount += 1
        assert.equal(messages.length, 2)
        assert.match(messages[1].content, /到期不代表已经发生/)
        return { text: '你之前说今天想一起看电影。还想继续这个约定吗？' }
      },
      commit: async (content, candidate) => {
        commitCount += 1
        assert.match(content, /看电影/)
        assert.equal(candidate.reason, 'future-intent')
        return true
      },
      recordUsage: (usage) => { recorded = usage },
      savePreference: (value) => {
        saved.push(value)
        return true
      },
      now: () => NOW + 1234,
    },
  )
  assert.equal(outcome, 'delivered')
  assert.equal(generateCount, 1)
  assert.equal(commitCount, 1)
  assert.equal(recorded?.source, 'estimate')
  assert.ok(recorded.inputTokens > 0)
  assert.ok(recorded.outputTokens > 0)
  assert.match(saved[0].lastCandidateKey, /^future:2026-10-08:\d+:今天一起看电影$/, '模型调用前先占用候选，防重复轰炸')
  assert.equal(saved.at(-1).deliveredCount, 1)
  assert.equal(saved.at(-1).lastDeliveredAt, NOW + 1234)
  assert.equal(saved.at(-1).lastBackgroundAt, 0)
}

console.log('[initiative-runtime] provider usage 有则记录真实值')
{
  resetInitiativeRuntimeForTests()
  let recorded = null
  const outcome = await runInitiativeCatchUp(
    policyInput(),
    context(),
    {
      estimateTokens: (text) => Math.max(1, Math.ceil(text.length / 4)),
      generate: async () => ({
        text: '今天那个电影约定，我还记着。',
        usage: {
          promptTokens: 321,
          completionTokens: 22,
          totalTokens: 343,
          cachedPromptTokens: 100,
        },
      }),
      commit: async () => true,
      recordUsage: (usage) => { recorded = usage },
      savePreference: () => true,
      now: () => NOW,
    },
  )
  assert.equal(outcome, 'delivered')
  assert.deepEqual(recorded, {
    source: 'actual',
    inputTokens: 321,
    outputTokens: 22,
    cachedTokens: 100,
  })
}

console.log('[initiative-runtime] 未来约定不能被模型说成“已经一起完成”')
{
  const candidate = futureCandidate()
  assert.equal(
    cleanInitiativeReply('我们刚刚已经看完电影回来啦，真的好开心。', candidate, 'zh'),
    null,
  )
  assert.equal(
    cleanInitiativeReply('我刚才下班回家，突然想起你说今天看电影。', candidate, 'zh'),
    null,
  )
  assert.equal(
    cleanInitiativeReply('今天那个电影约定，你还想继续吗？', candidate, 'zh'),
    '今天那个电影约定，你还想继续吗？',
  )
}

console.log('[initiative-runtime] 被护栏拒绝时不落聊天，但真实模型调用仍记用量')
{
  resetInitiativeRuntimeForTests()
  let commits = 0
  let usageCalls = 0
  const outcome = await runInitiativeCatchUp(
    policyInput(),
    context(),
    {
      estimateTokens: (text) => Math.max(1, Math.ceil(text.length / 4)),
      generate: async () => ({ text: '我们刚刚已经看完电影回来啦。' }),
      commit: async () => {
        commits += 1
        return true
      },
      recordUsage: () => { usageCalls += 1 },
      savePreference: () => true,
      now: () => NOW,
    },
  )
  assert.equal(outcome, 'rejected')
  assert.equal(commits, 0)
  assert.equal(usageCalls, 1)
}

console.log('[initiative-runtime] 生成失败也不会重复用同一理由再次请求')
{
  resetInitiativeRuntimeForTests()
  let current = pref()
  let generateCount = 0
  const deps = {
    estimateTokens: (text) => Math.max(1, Math.ceil(text.length / 4)),
    generate: async () => {
      generateCount += 1
      throw new Error('network')
    },
    commit: async () => true,
    recordUsage: () => {},
    savePreference: (value) => {
      current = value
      return true
    },
    now: () => NOW,
  }
  const first = await runInitiativeCatchUp(policyInput(current), context(), deps)
  assert.equal(first, 'generation-failed')
  assert.equal(generateCount, 1)
  assert.match(current.lastCandidateKey, /^future:2026-10-08:\d+:今天一起看电影$/)

  const second = await runInitiativeCatchUp(policyInput(current), context(), deps)
  assert.equal(second, 'disabled-or-no-reason')
  assert.equal(generateCount, 1, '同一 evidence 失败后不自动反复烧用户 Key')
}

console.log('[initiative-runtime] 连续不回应只结算一次；回应后归零')
{
  const delivered = pref({
    lastDeliveredAt: NOW - 60 * 60 * 1000,
    ignoredStreak: 1,
    lastResponseEvaluatedAt: 0,
  })
  const ignored = evaluateInitiativeResponse(delivered, NOW - 2 * 60 * 60 * 1000)
  assert.equal(ignored.ignoredStreak, 2)
  assert.equal(ignored.lastResponseEvaluatedAt, delivered.lastDeliveredAt)

  const ignoredAgain = evaluateInitiativeResponse(ignored, NOW - 2 * 60 * 60 * 1000)
  assert.equal(ignoredAgain.ignoredStreak, 2, '同一次主动投递不得重复累计忽略')

  const laterDelivery = {
    ...ignored,
    lastDeliveredAt: NOW - 10 * 60 * 1000,
    lastResponseEvaluatedAt: ignored.lastResponseEvaluatedAt,
  }
  const engaged = evaluateInitiativeResponse(laterDelivery, NOW - 5 * 60 * 1000)
  assert.equal(engaged.ignoredStreak, 0)
  assert.equal(engaged.lastResponseEvaluatedAt, laterDelivery.lastDeliveredAt)
}

console.log('[initiative-runtime] Prompt 只带角色与真实理由，不带整段聊天')
{
  const messages = buildInitiativeMessages(context(), futureCandidate())
  const joined = messages.map((message) => message.content).join('\n')
  assert.match(joined, /阿文/)
  assert.match(joined, /今天一起看电影/)
  assert.doesNotMatch(joined, /用户完整聊天记录/)
}

console.log('[initiative-runtime] App 只在 hidden/pagehide 记离开，visible 时补算；权限只由按钮请求')
{
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const settings = readFileSync(new URL('../src/components/ChatSettings.tsx', import.meta.url), 'utf8')
  assert.match(app, /document\.visibilityState === 'hidden'[\s\S]*recordInitiativeBackground\(\)/)
  assert.match(app, /document\.visibilityState === 'visible'[\s\S]*runInitiativeCatchUpNow\(\)/)
  assert.match(app, /pagehide/)
  assert.match(app, /commitInitiativeMessage/)
  assert.match(app, /getInitiativePreference\(account\.account, sessionId\)/)
  assert.match(app, /getAccount\(\)\?\.account !== accountId/)
  assert.match(app, /getActiveSessionId\(\) !== sessionId/)
  assert.match(app, /replyState === 'pending'.*replyState === 'streaming'/s)
  assert.match(app, /branchIdForNewMessage\(latestState\) !== conversationBranchId/)
  assert.match(app, /recordLocalModelUsageTurn/)
  assert.match(app, /Notification\.permission === 'granted'/)
  assert.doesNotMatch(app, /Notification\.requestPermission\(/)
  assert.match(settings, /Notification\.requestPermission\(\)/)
  assert.match(settings, /Key 不上传服务器/)
}

console.log('initiative runtime tests passed')
