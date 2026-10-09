import assert from 'node:assert/strict'
import { computeSpaceCover, hasMovedSpacePhoto, projectSpaceDrawerPull, projectSpacePhotoDrag, shouldOpenSpaceDrawer } from '../src/lib/spaceSceneDrag.ts'

console.log('[Space game] photo placement uses pointer delta, not rotated bounding-box offset')
const origin = { x: 30, y: 20, rotate: -7 }
const start = { x: 110, y: 220 }
assert.deepEqual(projectSpacePhotoDrag(origin, start, start, 200, 400), origin)
assert.deepEqual(projectSpacePhotoDrag(origin, start, { x: 130, y: 260 }, 200, 400), {
  x: 40, y: 30, rotate: -7,
})
assert.deepEqual(projectSpacePhotoDrag(origin, start, { x: -999, y: 9999 }, 200, 400), {
  x: 2, y: 72, rotate: -7,
})
assert.deepEqual(projectSpacePhotoDrag(origin, start, { x: 9999, y: -999 }, 200, 400), {
  x: 78, y: 1, rotate: -7,
})
assert.deepEqual(projectSpacePhotoDrag(origin, start, { x: 140, y: 220 }, 0, 400), origin)
assert.equal(hasMovedSpacePhoto(start, { x: 113, y: 224 }), false)
assert.equal(hasMovedSpacePhoto(start, { x: 116, y: 220 }), true)

console.log('[Space game] no finger-start jump, bounded drag, preserved rotation and tap threshold: PASS')

console.log('[Space game] drawer pull follows the finger, clamps and snaps back')
assert.equal(projectSpaceDrawerPull(200, 250, 100), 48)
assert.equal(projectSpaceDrawerPull(200, 220, 100), 20)
assert.equal(projectSpaceDrawerPull(200, 100, 100), 0)
assert.equal(projectSpaceDrawerPull(200, 250, 0), 0)
assert.equal(shouldOpenSpaceDrawer(21.99), false)
assert.equal(shouldOpenSpaceDrawer(22), true)
assert.equal(shouldOpenSpaceDrawer(Number.NaN), false)
console.log('[Space game] drawer thresholds PASS')

console.log('[Space game] scene art + hotspots share a true viewport-cover plane')
for (const [viewWidth, viewHeight] of [[390, 844], [390, 690], [430, 932], [941, 1672]]) {
  const covered = computeSpaceCover(viewWidth, viewHeight)
  assert.ok(covered)
  assert.ok(covered.width >= viewWidth - 0.01)
  assert.ok(covered.height >= viewHeight - 0.01)
  assert.ok(Math.abs(covered.width / covered.height - 941 / 1672) < 0.00001)
}
assert.equal(computeSpaceCover(0, 844), null)
assert.equal(computeSpaceCover(390, NaN), null)
console.log('[Space game] ratio/cover/null sizing PASS')
