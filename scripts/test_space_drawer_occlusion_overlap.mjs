import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { paintSpaceDrawer } from '../src/lib/spaceDrawerComposite.ts'

const src = readFileSync('src/lib/spaceDrawerComposite.ts','utf8')
assert.match(src, /ctx\.translate\(0, \(1 - p\) \* 63 \+ 8\)/)

// The source C sprite physically ends at world 1438 / 1535 (left/right),
// while the E wooden front begins on its two perspective edges. The C inner
// layer must reach a few pixels *behind* that front at every open state.
for (const p of [.25,.5,.75,1]) {
  const extra = (1-p)*63 + 8
  const cBottomLeft = 1438+extra, cBottomRight = 1535+extra
  const faceTopLeft = 1500+(1442-1500)*p
  const faceTopRight = 1586+(1540-1586)*p
  const leftOverlap = cBottomLeft-faceTopLeft
  const rightOverlap = cBottomRight-faceTopRight
  assert.ok(leftOverlap>=2 && leftOverlap<20, 'left edge would leave a cavity gap at '+p)
  assert.ok(rightOverlap>=2 && rightOverlap<20, 'right edge would leave a cavity gap at '+p)
}
// An empty C/E hole would show the bare background through the moving front.
// This test protects the coordinate-level fix; it does not certify the artwork.
assert.doesNotMatch(src,/ctx\.translate\(0, \(1 - p\) \* 23\)/)
console.log('[Space G0-B] E/C edge overlap stays positive throughout the pull: PASS')
