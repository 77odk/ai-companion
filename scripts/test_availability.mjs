import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  busyReturnFallback,
  classifyAvailability,
  isGroundedBusyReturn,
} from '../src/lib/availability.ts'
import { serializeBusyContext } from '../src/lib/aiBusy.ts'
import { buildBusyReturnPrompt } from '../src/lib/chatPrompts.ts'

const cases = [
  ['我先下楼', 'available'],
  ['我去拿个快递', 'available'],
  ['我倒杯水', 'available'],
  ['我去开个会', 'occupied'],
  ['我先吃饭', 'occupied'],
  ['我在忙工作', 'occupied'],
  ['等我一下，我马上回来', 'unavailable'],
  ['我先去洗澡，出来找你', 'unavailable'],
  ['我现在上台汇报，等我两分钟', 'unavailable'],
  ['brb', 'unavailable'],
  ['be right back', 'unavailable'],
  ['我去找你', 'available'],
]

for (const [input, state] of cases) {
  test(`${input} -> ${state}`, () => {
    const decision = classifyAvailability(input)
    assert.equal(decision.state, state)
    assert.equal(decision.owner, 'SELF')
    assert.ok(decision.evidence)
  })
}

test('Chat gates Busy by identity mode and repairs unavailable claims outside immersive', () => {
  const source = readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
  // 产品定义演进：身份模式按实时读取（live/resolve）门控 Busy（Codex 修复"生成中途切换模式"），
  // 语义与旧 `const allowBusy = allowsBusyState(identityMode)` 等价但不再缓存请求开始的模式。
  assert.match(source, /const liveAllowBusy = allowsBusyState\(liveIdentityMode\)/)
  assert.ok((source.match(/busyTriggeredRef\.current = true/g) ?? []).length >= 2, 'Busy 触发点存在且受身份门控')
  assert.match(source, /const unavailableIdentityProblem = Boolean\(/)
  assert.match(source, /!liveAllowBusy && cleanedAvailability\?\.state === 'unavailable'/)
  assert.match(source, /!retryAllowBusy && retryAvailability\?\.state === 'unavailable'/)
  assert.doesNotMatch(source, /containsBusyKeyword/)
})

test('context labels USER and SELF without ambiguous first person', () => {
  assert.equal(serializeBusyContext([
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '等我一下' },
  ]), '[source=USER] 向 SELF 问好\n[source=SELF] 等 SELF 一下')
})

test('Busy Return prompt contains ownership and allowed facts', () => {
  const prompt = buildBusyReturnPrompt('洗澡', 'USER：好\nSELF：等我', 'zh', '我先去洗澡，出来找你')
  assert.match(prompt, /\[source=SELF\] SELF 先去洗澡，出来找 USER/)
  assert.match(prompt, /USER 是与你聊天的人；SELF 是你自己；SHARED 是你们双方/)
  assert.match(prompt, /不得把 SELF_ACTIVITY 说成 USER/)
})

test('guard rejects SELF activity attributed to USER', () => {
  assert.equal(isGroundedBusyReturn('你洗完澡了吗？', '我先去洗澡，出来找你'), false)
})

test('guard rejects unsupported hand-washing detail', () => {
  assert.equal(isGroundedBusyReturn('刚洗了手，我回来了。', '我现在上台汇报，等我两分钟'), false)
})

test('guard rejects unsupported coffee detail', () => {
  assert.equal(isGroundedBusyReturn('顺便买了杯咖啡。', '等我一下，我马上回来'), false)
})

test('guard accepts grounded return', () => {
  assert.equal(isGroundedBusyReturn('洗完了，我回来了。', '我先去洗澡，出来找你'), true)
})

test('fallback is local and contains no invented action', () => {
  assert.equal(busyReturnFallback('zh'), '忙完了，我回来了。')
  assert.equal(busyReturnFallback('en'), "I'm back.")
})
