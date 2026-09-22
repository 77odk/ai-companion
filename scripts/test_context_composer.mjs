import assert from 'node:assert/strict'
import { composeContext, CONTEXT_HARD_BUDGET } from '../src/lib/contextComposer.ts'
import { estimateToken } from '../src/lib/token.ts'

const core = [{ role: 'system', content: 'core persona' }]
const history = Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'history '.repeat(100) }))
const tail = [{ role: 'system', content: 'current time tail' }]
const result = composeContext(core, history, [], tail, 500)

assert.ok(result.totalTokens <= 500, 'final payload must stay inside supplied hard budget')
assert.deepEqual(result.messages[0], core[0], 'core must stay first')
assert.deepEqual(result.messages.at(-1), tail[0], 'time tail must stay last and count inside budget')
assert.equal(result.totalTokens, result.messages.reduce((sum, m) => sum + estimateToken(m.content), 0))

const blocks = composeContext(core, [], [
  { id: 'ambient', content: 'ambient', priority: 'ambient' },
  { id: 'memory', content: 'memory', priority: 'memory' },
  { id: 'irrelevant', content: 'skip me', priority: 'memory', relevant: false },
], [], CONTEXT_HARD_BUDGET)
assert.deepEqual(blocks.includedBlockIds, ['memory', 'ambient'])
assert.ok(!blocks.messages.some((m) => m.content === 'skip me'))

console.log('context_composer: 5/5')
