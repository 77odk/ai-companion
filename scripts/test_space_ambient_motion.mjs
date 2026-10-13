import assert from 'node:assert/strict'
import {
  sampleSpaceWind, selectSpaceMotionQuality,
  advanceSpaceDrawer, shouldPaintSpaceFrame,
} from '../src/lib/spaceAmbientMotion.ts'

console.log('[Space V2 motion] deterministic shared wind & conservative limits')
for (const quality of ['low', 'full']) {
  let largestPlant = 0
  for (let t = 0; t <= 120000; t += 37) {
    const a = sampleSpaceWind(t, 2, quality)
    const b = sampleSpaceWind(t, 2, quality)
    assert.deepEqual(a, b, 'same clock/seed must produce identical motion')
    assert.ok(a.wind >= -1 && a.wind <= 1)
    assert.ok(a.gust >= 0 && a.gust <= 1)
    assert.ok(a.plantDegrees.every(Number.isFinite))
    assert.ok(a.paperOffsets.every(Number.isFinite))
    assert.ok(a.plantDegrees.every(n => Math.abs(n) <= 3.56))
    assert.ok(a.paperOffsets.every(n => Math.abs(n) <= 1.91))
    largestPlant = Math.max(largestPlant, ...a.plantDegrees.map(Math.abs))
  }
  assert.ok(largestPlant > 0.1, 'motion should not be frozen in active mode')
}
assert.deepEqual(sampleSpaceWind(12000, 0, 'off'), {
  wind: 0, gust: 0, plantDegrees: [0, 0, 0], paperOffsets: [0, 0, 0],
})
assert.deepEqual(sampleSpaceWind(Number.NaN), sampleSpaceWind(0, 0, 'off'))
// Wind never pops sharply at the periodic gust boundary.
const a = sampleSpaceWind(23399, 0, 'full')
const b = sampleSpaceWind(23401, 0, 'full')
assert.ok(Math.abs(a.wind - b.wind) < 0.02)
assert.ok(Math.abs(a.gust - b.gust) < 0.02)

console.log('[Space V2 motion] background, reduced motion and low-power choices')
assert.equal(selectSpaceMotionQuality({ visible: false, reducedMotion: false, lowPower: false }), 'off')
assert.equal(selectSpaceMotionQuality({ visible: true, reducedMotion: true, lowPower: false }), 'off')
assert.equal(selectSpaceMotionQuality({ visible: true, reducedMotion: false, lowPower: true }), 'low')
assert.equal(selectSpaceMotionQuality({ visible: true, reducedMotion: false, lowPower: false, meanFrameMs: 45 }), 'low')
assert.equal(selectSpaceMotionQuality({ visible: true, reducedMotion: false, lowPower: false, meanFrameMs: 18 }), 'full')

console.log('[Space V2 motion] drawer ease is monotonic and approximately frame-rate independent')
let full = 0, low = 0
for (let i = 0; i < 60; i++) full = advanceSpaceDrawer(full, 1, 16)
for (let i = 0; i < 12; i++) low = advanceSpaceDrawer(low, 1, 80)
assert.ok(Math.abs(full - low) < 1e-8)
assert.ok(full > 0.95 && full <= 1)
assert.equal(advanceSpaceDrawer(0.3, 1, 0), 0.3)
assert.equal(advanceSpaceDrawer(0.3, 1, 15, true), 1)
assert.equal(advanceSpaceDrawer(0.7, 0, 15, true), 0)
assert.ok(advanceSpaceDrawer(-12, 5, 1000) > 0.99)
assert.ok(advanceSpaceDrawer(3, -1, 1000) < 0.01)

console.log('[Space V2 motion] shared frame scheduling cap')
assert.equal(shouldPaintSpaceFrame(10, -Infinity, 'full'), true)
assert.equal(shouldPaintSpaceFrame(32, 0, 'full'), false)
assert.equal(shouldPaintSpaceFrame(34, 0, 'full'), true)
assert.equal(shouldPaintSpaceFrame(80, 0, 'low'), false)
assert.equal(shouldPaintSpaceFrame(84, 0, 'low'), true)
assert.equal(shouldPaintSpaceFrame(300, 0, 'off'), false)
console.log('[Space V2 motion] wind / paper / drawer / 30-12fps degradation: PASS')
