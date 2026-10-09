import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'

const html = readFileSync('docs/space/G0B_motion_lab_20261009.html', 'utf8')
const motion = readFileSync('src/lib/spaceAmbientMotion.ts', 'utf8')
assert.match(html, /<canvas/)
assert.equal((html.match(/390,844|390,690|430,932/g) ?? []).length, 3)
for (const asset of ['room-closed.webp','room-cavity.webp','open_drawer.png','open_book.png','hanging_plant.png']) {
  assert.ok(html.includes(asset), 'lab must use committed local art: ' + asset)
}
for (const redline of [/localStorage/, /sessionStorage/, /fetch\(/, /api\.eluvin/, /<script[^>]*src=/, /https?:\/\//]) {
  assert.doesNotMatch(html, redline, 'prototype must not touch private state or remote resources')
}
assert.doesNotMatch(html, /src\/components\/AISpace\.tsx/, 'lab must stay isolated')
assert.match(html, /pointerdown/)
assert.match(html, /pointermove/)
assert.match(html, /devicePixelRatio/)
assert.match(html, /document\.hidden/)
assert.match(html, /low\?'?\.4|low\?\.4/)
assert.match(html, /prefers-reduced-motion|减少动态效果/)
assert.match(motion, /export function sampleSpaceWind/)
assert.match(motion, /export function selectSpaceMotionQuality/)
assert.match(motion, /export function advanceSpaceDrawer/)
assert.match(motion, /export function shouldPaintSpaceFrame/)
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)
assert.ok(script, 'lab script must be self contained')
new Script(script[1], { filename: 'G0B_motion_lab_inline.js' })
console.log('[Space V2 G0-B lab] three sizes, local assets, no private data, JS syntax: PASS')
