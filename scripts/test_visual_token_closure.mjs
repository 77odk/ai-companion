// Visual token closure V1: keep repeated system colors centralized without changing values.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
const tokens = read('src/styles/tokens.css')
const index = read('src/index.css')
const ui2 = read('src/styles/ui2.css')

console.log('\n[1] canonical tokens keep the exact existing values')
assert.match(tokens, /--el-danger:\s*#b3261e;/)
assert.match(tokens, /--el-danger-surface:\s*#fdecea;/)
assert.match(tokens, /--el-static-white:\s*#ffffff;/)

console.log('\n[2] repeated danger colors no longer live in page CSS')
assert.equal(index.includes('#b3261e'), false)
assert.equal(index.includes('#fdecea'), false)
assert.match(index, /var\(--el-danger\)/)
assert.match(index, /var\(--el-danger-surface\)/)

console.log('\n[3] fixed white and UI2 ink reuse canonical variables')
assert.equal(/(?:color|background):\s*#fff;/.test(index), false)
assert.equal(/color:\s*#fff;/.test(ui2), false)
assert.match(ui2, /color:\s*var\(--ui2-text\);/)
assert.match(ui2, /var\(--el-static-white\)/)

console.log('\nvisual token closure v1: all passed')
