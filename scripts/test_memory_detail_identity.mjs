// Memory Detail stable identity regression guard.
// This test is intentionally display-layer-only: it verifies the component no longer stores a mutable array index as identity.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(path.join(process.cwd(), 'src/components/Memory.tsx'), 'utf8')

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
assert.match(source, /const identity: MemorySelection = \{[\s\S]*kind: initialDetail\.kind,[\s\S]*memoryId: initialDetail\.memoryId/)
assert.match(source, /setSelectedIdentity\(identity\)/)

console.log('\n[5] If refresh removes the selected item, Detail exits safely instead of falling through to a neighbor')
assert.match(source, /if \(view !== 'detail' \|\| !selectedIdentity \|\| selected\) return/)
assert.match(source, /setSelectedIdentity\(null\)[\s\S]*setView\('river'\)/)

console.log('\nmemory detail stable identity: all passed')
