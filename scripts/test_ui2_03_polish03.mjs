// UI2-03-POLISH-03 · S3 朝暮根层级迁移合同
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const memory = readFileSync(path.join(root, 'src/components/Memory.tsx'), 'utf8')
const css = readFileSync(path.join(root, 'src/styles/memory.css'), 'utf8')
const memoryLib = readFileSync(path.join(root, 'src/lib/memory.ts'), 'utf8')

assert.match(memory, /className="memory-title">朝暮</)
assert.match(memory, /STATUS/)
assert.match(memory, /MEMORY RIVER/)
assert.match(memory, /<EventArchive sessionId=\{sessionId \|\| undefined\} \/>/)
assert.match(memory, /type="search"/)
assert.match(memory, /memory-audit-toggle/)
assert.doesNotMatch(memory.slice(memory.indexOf('// ---- 朝暮')), /memory-book-portal/)
assert.match(memory, /openBookHere/, '单条记忆详情仍保留进入记忆书的能力')
assert.match(memory, /className="home-web-refresh"/)
assert.match(css, /S3 · 朝暮/)
assert.match(css, /memory-search/)
assert.match(css, /memory-audit-panel/)
assert.doesNotMatch(memoryLib, /imageUrl|\bimages\b|\.media\b/)
assert.doesNotMatch(memoryLib, /triggerWords\??:|moodSnapshot\??:/, 'MemoryItem schema remains frozen')

console.log('UI2-03-POLISH-03 Chaomu root migration passed')
