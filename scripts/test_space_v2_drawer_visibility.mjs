import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { computeSpaceCamera, SPACE_WORLD_WIDTH, SPACE_WORLD_HEIGHT } from '../src/lib/spaceWorldCamera.ts'
import { SPACE_DRAWER_OPEN_PERCENT, projectSpaceDrawerPull } from '../src/lib/spaceSceneDrag.ts'

const css = readFileSync('src/styles/space.css', 'utf8')
const app = readFileSync('src/components/AISpace.tsx', 'utf8')
const manual = readFileSync('docs/space/G0A_E_drawer_visual_gate.md', 'utf8')

assert.equal(SPACE_WORLD_WIDTH, 941)
assert.equal(SPACE_WORLD_HEIGHT, 1672)
assert.equal(SPACE_DRAWER_OPEN_PERCENT, 42)
assert.match(app, /room-closed\.webp/)
assert.match(app, /room-cavity\.webp/)
assert.match(app, /space-layer-drawer-art/)
assert.match(manual, /NOT APPROVED/)
assert.match(manual, /金色时光里的温馨书桌抽屉\.png/)

// Test the actual CSS hot area as currently declared (NOT the painted alpha bounds).
const m = css.match(/\.ai-space-page\.is-layered \.space-scene-hotspot\.is-weekly-letter\s*\{[^}]*?left:\s*([\d.]+)%;\s*top:\s*([\d.]+)%;\s*width:\s*([\d.]+)%;\s*height:\s*([\d.]+)%;/)
assert.ok(m, 'layered drawer hit area must be measurable')
const [left, top, width, height] = m.slice(1).map(Number)
assert.deepEqual([left, top, width, height], [48, 82, 55, 17])
const world = {
  x: left / 100 * SPACE_WORLD_WIDTH,
  y: top / 100 * SPACE_WORLD_HEIGHT,
  width: width / 100 * SPACE_WORLD_WIDTH,
  height: height / 100 * SPACE_WORLD_HEIGHT,
}
const reveal = world.height * SPACE_DRAWER_OPEN_PERCENT / 100
assert.ok(reveal > 110 && reveal < 130, 'drawer movement must visibly exceed 110 world px')
assert.equal(projectSpaceDrawerPull(0, 999, 100), SPACE_DRAWER_OPEN_PERCENT)

const outcomes = []
for (const [w, h] of [[390, 844], [390, 690], [430, 932]]) {
  const camera = computeSpaceCamera({ x: 0, y: 0, width: w, height: h })
  assert.ok(camera)
  // The cabinet background must not be transformed on drag; this test
  // explicitly projects only the movable drawer sprite's travel.
  const travelPx = reveal * camera.scale
  const x0 = Math.max(world.x, camera.visibleWorld.x)
  const x1 = Math.min(world.x + world.width, camera.visibleWorld.x + camera.visibleWorld.width)
  const y0 = Math.max(world.y + reveal, camera.visibleWorld.y)
  const y1 = Math.min(world.y + reveal + world.height, camera.visibleWorld.y + camera.visibleWorld.height)
  const visibility = Math.max(0, x1 - x0) * Math.max(0, y1 - y0) / (world.width * world.height)
  assert.ok(Number.isFinite(travelPx) && travelPx >= 45 && travelPx <= 70)
  assert.ok(visibility >= 0.45, 'at least the majority of the nominal open-area should be visible')
  outcomes.push({ screen: `${w}x${h}`, travelPx: +travelPx.toFixed(1), visibleArea: +(visibility * 100).toFixed(1) })
}
console.log('[Space V2 E drawer] preliminary screen-space geometry (NOT visual QA)', outcomes)
console.log('[Space V2 E drawer] unapproved art explicitly documented: PASS')
