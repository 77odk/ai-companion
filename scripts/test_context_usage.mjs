// 上下文总量口径自测：会话累计 + provider usage 校准
// 跑法：npm test（node --test scripts/test_*.mjs）
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { calibrateContextFactor, contentTokensOf, loadContextFactor } from '../src/lib/contextUsage.ts'

let passed = 0
let failed = 0
const check = (name, fn) => {
  try {
    fn()
    passed += 1
    console.log('  ✔', name)
  } catch (err) {
    failed += 1
    console.log('  ✗', name, '→', err.message)
  }
}

const msg = (role, content, ts = 1) => ({ role, content, ts })

console.log('上下文总量口径')

check('空会话总量为 0', () => {
  assert.equal(contentTokensOf([], 0.24), 0)
})

check('总量 = 本地估算 × 校准系数', () => {
  const messages = [msg('user', '你好呀'), msg('assistant', '在的，怎么了？')]
  const raw = contentTokensOf(messages, 1)
  const scaled = contentTokensOf(messages, 0.24)
  assert.ok(raw > scaled, '小系数应得到更小的总量')
  assert.ok(scaled >= 1)
})

check('脏数据（缺 content / null）不影响总量', () => {
  const dirty = [{ role: 'user', ts: 1 }, null, msg('assistant', '好')]
  assert.equal(contentTokensOf(dirty, 0.5), contentTokensOf([msg('assistant', '好')], 0.5))
})

check('总量只随消息增长，重复统计同一批结果不变', () => {
  const base = [msg('user', '第一句'), msg('assistant', '第二句')]
  const once = contentTokensOf(base, 0.24)
  assert.equal(contentTokensOf(base, 0.24), once, '同一批内容重复计算必须相等')
  assert.ok(contentTokensOf([...base, msg('user', '第三句')], 0.24) > once, '新增消息后应变大')
})

check('校准系数按 7:3 平滑', () => {
  const next = calibrateContextFactor(0.2, 1000, 300)
  assert.ok(Math.abs(next - (0.2 * 0.7 + 0.3 * 0.3)) < 1e-9)
})

check('估算为 0 / usage 非法时保持原系数', () => {
  assert.equal(calibrateContextFactor(0.24, 0, 100), 0.24)
  assert.equal(calibrateContextFactor(0.24, 1000, 0), 0.24)
  assert.equal(calibrateContextFactor(0.24, Number.NaN, 100), 0.24)
})

check('观测值越界时拒绝采纳（脏 usage 不带偏）', () => {
  assert.equal(calibrateContextFactor(0.24, 1000, 999999), 0.24)
  assert.equal(calibrateContextFactor(0.24, 1000, 1), 0.24)
})

check('系数始终夹在安全区间 [0.1, 1.5]', () => {
  const lo = calibrateContextFactor(0.1, 1000, 100)
  const hi = calibrateContextFactor(1.5, 1000, 1400)
  assert.ok(lo >= 0.1 && lo <= 1.5)
  assert.ok(hi >= 0.1 && hi <= 1.5)
})

check('无 localStorage 环境取默认系数，不抛错', () => {
  const f = loadContextFactor()
  assert.ok(Number.isFinite(f) && f > 0)
})

// —— 接线断言：Chat 里两处写入都必须走新口径，别退回「一轮的量」 ——
const chatSource = readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')

check('发送前写入：总量 = 会话累计估算', () => {
  assert.match(chatSource, /used: sessionContentTokens,/, '发送前总量必须用会话累计')
})

check('provider usage 返回后：总量仍按会话累计写入，并反推校准系数', () => {
  assert.match(chatSource, /calibrateContextFactor\(loadContextFactor\(\), composed\.totalTokens, usage\.promptTokens\)/, '必须用真实 usage 反推系数')
  assert.match(chatSource, /used: contentTokensOf\(messages, nextFactor\)/, '最终总量必须按会话累计 + 校准系数')
  assert.doesNotMatch(chatSource, /used: usage\.promptTokens \+ \(outputTokens \?\? 0\)/, '不得再退回「本轮 prompt + 输出」当总量')
})

check('明细字段仍是 usage 原始数据', () => {
  assert.match(chatSource, /inputTokens: usage\.promptTokens,/, '本轮输入保持 usage 原始值')
  assert.match(chatSource, /source: 'actual',/, '有 usage 时标记为真实来源')
})

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
