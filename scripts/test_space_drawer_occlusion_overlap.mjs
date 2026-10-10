import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spaceDrawerFrontQuad, spaceDrawerInteriorTravel, spaceDrawerAperture } from '../src/lib/spaceDrawerComposite.ts'

const src = readFileSync('src/lib/spaceDrawerComposite.ts', 'utf8')
const fixedClip = src.indexOf('const { leftTop, rightTop } = spaceDrawerAperture(p)')
const movement = src.indexOf('ctx.translate(innerX, innerY)')
assert.ok(fixedClip > 0 && movement > fixedClip)
assert.ok(src.slice(fixedClip, movement).includes('ctx.clip()'))
const closed = spaceDrawerFrontQuad(0)
const edge = (quad, i) => quad[(i + 1) % 4].map((value, k) => value - quad[i][k])
for (let frame = 0; frame <= 100; frame++) {
  const p = frame / 100
  const front = spaceDrawerFrontQuad(p)
  for (let i = 0; i < 4; i++) {
    const a = edge(front, i), b = edge(closed, i)
    a.forEach((value, k) => assert.ok(Math.abs(value - b[k]) < 1e-9,
      'wood front must retain every edge vector throughout the slide'))
  }
  const [, y] = spaceDrawerInteriorTravel(p)
  assert.equal(1438 + y - front[0][1], 3, 'left rim overlaps the front, never leaves a crack')
  assert.equal(1535 + y - front[1][1], 14, 'right source rim overlap remains constant')
  assert.deepEqual(spaceDrawerAperture(p), spaceDrawerAperture(0), 'fixed cabinet does not travel')
}
assert.deepEqual(spaceDrawerFrontQuad(NaN), closed)
assert.deepEqual(spaceDrawerFrontQuad(-1), closed)
assert.deepEqual(spaceDrawerFrontQuad(2), spaceDrawerFrontQuad(1))
console.log('[Space V2] 101 rigid-front poses / fixed opening / constant interior overlap: PASS')
