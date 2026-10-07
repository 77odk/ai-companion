// UI2-03-POLISH-04 · S3 星星罐物理交互合同
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const star = readFileSync(path.join(root, 'src/components/StarJar.tsx'), 'utf8')
const css = readFileSync(path.join(root, 'src/styles/space.css'), 'utf8')
const memoryLib = readFileSync(path.join(root, 'src/lib/memory.ts'), 'utf8')

assert.match(star, /numberedMemories\.map\(\(\{ item \}, index\) =>/)
assert.match(star, /Math\.floor\(Math\.random\(\) \* numberedMemories\.length\)/)
assert.doesNotMatch(star, /is-filler|visibleStarCount|★/)
assert.match(star, /setPhase\('opening'\)/)
assert.match(star, /setPhase\('detail'\)/)
assert.match(star, /setPhase\('folding'\)/)
assert.match(star, /当时你说/)
assert.match(star, /TA 当时回应/)
assert.doesNotMatch(star, /moodSnapshot/, '没有可靠历史 mood snapshot 时保持空，不补编')
assert.match(css, /star-paper-open/)
assert.match(css, /star-paper-fold/)
assert.match(css, /steps\(6, end\)/)
assert.match(css, /prefers-reduced-motion: reduce/)
assert.doesNotMatch(star, /https?:\/\//)
assert.doesNotMatch(memoryLib, /triggerWords\??:|moodSnapshot\??:/)

console.log('UI2-03-POLISH-04 Star Jar fidelity passed')
