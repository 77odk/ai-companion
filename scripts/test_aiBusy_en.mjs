// 英文 busy 句式单测（2026-09-05 乔补——豆包交付版只认带结尾词的句式，日常口语大量漏匹配）
// 跑法：node --test scripts/test_aiBusy_en.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchBusyIntent, containsBusyKeyword, findBusyCutoff } from '../src/lib/aiBusy.ts'

// 应该触发的英文离开意图
const SHOULD_HIT = [
  "I'll go wash the dishes",
  "I'm going to take a shower now",
  'brb',
  'BRB',
  'gotta go',
  "I need to run some errands",
  'Let me go grab dinner real quick',
  "I'm gonna call my mom",
  "I'll be right back",
  "I'm off to cook dinner",
  "I've got to finish this report",
  "I'll go handle the laundry",
  "Let me go do the dishes",
]

// 不该触发的（还在聊/奔向对方/思考）
const SHOULD_NOT_HIT = [
  "I'll come find you in a bit",
  'See you later',
  "I'll go to the store to pick you up",
  "Let me think about that",
  "I'll go with you",
  "I need to tell you something",
  "I'm going to ask you a question",
  "Let me explain something",
  "I'll talk to you about it",
  "I'm going to be honest with you",
  "I'm gonna come get you",
]

test('英文离开意图：应该触发', () => {
  for (const t of SHOULD_HIT) {
    assert.ok(containsBusyKeyword(t), `应触发: ${t}`)
  }
})

test('英文非离开意图：不应触发', () => {
  for (const t of SHOULD_NOT_HIT) {
    assert.ok(!containsBusyKeyword(t), `不应触发: ${t}`)
  }
})

test('findBusyCutoff 英文：能定位截断点', () => {
  const t = "I'll go wash the dishes now, back in a bit"
  const pos = findBusyCutoff(t)
  assert.ok(pos > 0, `应找到截断点，实际 ${pos}`)
})

test('中文 busy 不受影响（回归）', () => {
  assert.ok(containsBusyKeyword('我去洗碗了'))
  assert.ok(containsBusyKeyword('我先去洗个澡了'))
  assert.ok(!containsBusyKeyword('我去找你吧'))
  assert.ok(!containsBusyKeyword('我去给你做饭了'))
})
