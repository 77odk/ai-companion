import assert from 'node:assert/strict'
import { composeContext } from '../src/lib/contextComposer.ts'
import { buildSystemPrompt } from '../src/lib/chatPrompts.ts'
import { estimateToken } from '../src/lib/token.ts'

const store = new Map()
globalThis.localStorage = {
  getItem: (key) => store.has(key) ? store.get(key) : null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
  key: (index) => [...store.keys()][index] ?? null,
  get length() { return store.size },
}

const sid = 'weak-model-check'
const firstSeen = new Date(2026, 7, 25, 10, 0, 0).getTime()
const now = new Date(2026, 8, 23, 14, 30, 0).getTime()
localStorage.setItem(`ai_companion_first_seen_${sid}`, String(firstSeen))

console.log('\n[1] 减法之后，唯一 system prompt 仍保留日期与关系锚点')
const prompt = buildSystemPrompt('', '饺子', now, sid, 'zh')
assert.match(prompt, /【此刻时间】2026年9月23日/)
assert.match(prompt, /今天是你们认识的第 30 天/)
assert.equal((prompt.match(/【此刻时间】/g) || []).length, 1, '当前时间在 system prompt 内只出现一次')

console.log('\n[2] 最近对话仍原样在最终 payload，弱模型能看到“刚才说过什么”')
const history = [
  { role: 'user', content: '我刚才说今天想吃小蛋糕' },
  { role: 'assistant', content: '那就在家点根蜡烛。' },
  { role: 'user', content: '你还记得我刚才说什么吗' },
]
const composed = composeContext([{ role: 'system', content: prompt }], history, [])
assert.equal(composed.messages.at(-1)?.content, '你还记得我刚才说什么吗')
assert.ok(composed.messages.some((m) => m.content === '我刚才说今天想吃小蛋糕'))
assert.ok(composed.messages.some((m) => m.content === '那就在家点根蜡烛。'))

console.log('\n[3] 规则做减法但不砍边界；低价值临时状态明确不自动记')
assert.match(prompt, /不编事实、共同经历或现实事件/)
assert.match(prompt, /临时状态和一次性琐事/)
assert.match(prompt, /点外卖/)
assert.match(prompt, /上厕所/)
assert.ok(!prompt.includes('特别是对方明确说你们的关系、你的身份、或对你的称呼'), '旧版重复长说明已移除')
assert.ok(estimateToken(prompt) < 1800, `默认 system prompt 不再无限膨胀（当前估算 ${estimateToken(prompt)} tokens）`)

console.log('\nprompt/context slim：全部通过')
