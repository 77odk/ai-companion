// UI2-03-POLISH-05 · S3 记忆书降级为详情能力合同
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const memory = readFileSync(path.join(root, 'src/components/Memory.tsx'), 'utf8')
const css = readFileSync(path.join(root, 'src/styles/memory.css'), 'utf8')
const memoryLib = readFileSync(path.join(root, 'src/lib/memory.ts'), 'utf8')

const rootStart = memory.indexOf('// ---- 朝暮')
assert.ok(rootStart >= 0)
assert.doesNotMatch(memory.slice(rootStart), /memory-book-portal/, '朝暮根页不再放记忆书 portal')
assert.match(memory, /const openBookHere = \(\) =>/)
assert.match(memory, /setBookFrom\('detail'\)/)
assert.match(memory, /setView\('book'\)/)
assert.match(memory, /memory-book-page/)
assert.match(memory, /memory-book-cover/)
assert.match(memory, /memory-book-memory-page/)
assert.match(css, /memory-book/)
assert.doesNotMatch(memory, /<img/, '记忆书不凭空引入图片')
assert.doesNotMatch(memoryLib, /imageUrl|\bimages\b|\.media\b/)
assert.doesNotMatch(memoryLib, /triggerWords\??:|moodSnapshot\??:/)
assert.ok(!css.includes('@import'))

console.log('UI2-03-POLISH-05 detail book preservation passed')
