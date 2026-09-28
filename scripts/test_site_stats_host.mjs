import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/siteStats.ts'), 'utf8')

console.log('\n[1] 两个正式前端 host 都允许第一方统计')
assert.match(source, /new Set\(\['eluvin\.space', 'www\.eluvin\.space'\]\)/)

console.log('\n[2] 统计仍保持第一方，不重新引入第三方脚本')
assert.equal(source.includes('jsdelivr'), false)
assert.equal(source.includes('http://'), false)

console.log('\nsite stats host contract: all passed')
