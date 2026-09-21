// Memory Detail stable identity regression guard.
// This test is intentionally display-layer-only: it verifies the component no longer stores a mutable array index as identity.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(path.join(process.cwd(), 'src/components/Memory.tsx'), 'utf8')
const {
  recordMemoryIdAlias,
  resolveMemoryIdAlias,
  subscribeMemoryIdAliases,
} = await import('../src/lib/memoryIdAliases.ts')

console.log('\n[1] Detail selection no longer stores selectedIndex in state')
assert.doesNotMatch(source, /const \[selectedIndex,\s*setSelectedIndex\]\s*=\s*useState/)
assert.doesNotMatch(source, /setSelectedIndex\(/)
assert.match(source, /useState<MemorySelection \| null>\(null\)/)

console.log('\n[2] Stable identity includes kind + memoryId and session guard')
assert.match(source, /interface MemorySelection \{[\s\S]*kind: MemoryKind[\s\S]*memoryId: MemoryItem\['id'\][\s\S]*sessionId\?: string/)
assert.match(source, /memory\.kind !== selection\.kind \|\| memory\.item\.id !== selection\.memoryId/)
assert.match(source, /activeSessionId === expectedSessionId/)

console.log('\n[3] Cloud refresh re-resolves current detail by identity')
assert.match(source, /chronological\.findIndex\(\(memory\) => matchesMemorySelection\(memory, selectedIdentity, sessionId\)\)/)
assert.match(source, /const selected = selectedIndex >= 0 \? chronological\[selectedIndex\] : null/)

console.log('\n[4] River click and Chat return both bind the stable identity')
assert.match(source, /setSelectedIdentity\(\{[\s\S]*kind: memory\.kind,[\s\S]*memoryId: memory\.item\.id/)
assert.match(source, /const identity: MemorySelection = \{[\s\S]*kind: initialDetail\.kind,[\s\S]*resolveMemoryIdAlias\(initialDetail\.sessionId \?\? sessionId, String\(initialDetail\.memoryId\)\)/)
assert.match(source, /setSelectedIdentity\(identity\)/)

console.log('\n[5] Refresh reconciliation carries local→server id into an open Detail')
assert.match(source, /setSelectedIdentity\(\(current\) => \{/)
assert.match(source, /resolveMemoryIdAlias\(sessionId, String\(current\.memoryId\)\)/)
assert.match(source, /return resolved !== current\.memoryId \? \{ \.\.\.current, memoryId: resolved \} : current/)

console.log('\n[6] 所有持有旧 id 的入口统一从瞬时别名源解析')
assert.match(source, /subscribeMemoryIdAliases/)
assert.match(source, /subscribeMemoryIdAliases\([\s\S]*setMemories\(\(current\) => \{[\s\S]*setSelectedIdentity/)
assert.match(source, /recordMemoryIdAlias\(sessionId, localId, serverId\)/)
assert.match(source, /resolveMemoryIdAlias\(sessionId, String\(current\.memoryId\)\)/)
assert.match(source, /const jumpIdentity: MemorySelection = \{/)
assert.match(source, /resolveMemoryIdAlias\(jumpIdentity\.sessionId \?\? sessionId, String\(jumpIdentity\.memoryId\)\)/)
assert.match(source, /memoryId: returnMemoryId/)

console.log('\n[7] 别名源支持订阅和 A → B → C 连续迁移')
const seen = []
const unsubscribe = subscribeMemoryIdAliases((alias) => seen.push(alias))
recordMemoryIdAlias('detail-session', 'local-a', 'server-b')
recordMemoryIdAlias('detail-session', 'server-b', 'server-c')
unsubscribe()
assert.equal(resolveMemoryIdAlias('detail-session', 'local-a'), 'server-c')
assert.deepEqual(seen.map((alias) => [alias.oldId, alias.newId]), [
  ['local-a', 'server-b'],
  ['server-b', 'server-c'],
])

console.log('\n[8] If refresh truly removes the selected item, Detail exits safely instead of falling through to a neighbor')
assert.match(source, /if \(view !== 'detail' \|\| !selectedIdentity \|\| selected\) return/)
assert.match(source, /setSelectedIdentity\(null\)[\s\S]*setView\('river'\)/)

console.log('\nmemory detail stable identity: all passed')
