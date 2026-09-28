// Visual token closure V2: page modules reuse canonical functional colors without flattening design-specific materials.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
const targets = [
  'src/styles/eventArchive.css',
  'src/styles/home.css',
  'src/styles/memory.css',
  'src/styles/mine.css',
  'src/styles/photoWallArchive.css',
  'src/styles/primitives.css',
  'src/styles/space.css',
  'src/styles/spaceLetter.css',
  'src/styles/taProfile.css',
]

const tokens = read('src/styles/tokens.css')
assert.match(tokens, /--el-overlay-scrim:\s*rgba\(38, 31, 28, 0\.30\);/)
assert.match(tokens, /--el-static-white:\s*#ffffff;/)
assert.match(tokens, /--el-danger:\s*#b3261e;/)

for (const file of targets) {
  const css = read(file)
  assert.equal(/#fff(?:fff)?\b/i.test(css), false, `${file}: fixed white should use --el-static-white`)
  assert.equal(/#b3261e\b/i.test(css), false, `${file}: danger should use --el-danger`)
  assert.equal(/rgba\(38,\s*31,\s*28,\s*0\.30\)/i.test(css), false, `${file}: common scrim should use --el-overlay-scrim`)
}

// Deliberately preserve design-specific materials instead of tokenising every literal.
const photo = read('src/styles/photoWallArchive.css')
assert.match(photo, /rgba\(20, 16, 15, 0\.92\)/, 'photo lightbox dark material stays design-specific')
const closure = read('src/styles/ui204MobileClosure.css')
assert.match(closure, /#fff8e9/i, 'memory/mobile paper tone stays design-specific')

console.log('visual token closure v2: all passed')
