import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { computeSpaceCamera, SPACE_WORLD_WIDTH, SPACE_WORLD_HEIGHT } from '../src/lib/spaceWorldCamera.ts'
import { SPACE_DRAWER_OPEN_PERCENT, projectSpaceDrawerPull } from '../src/lib/spaceSceneDrag.ts'
import { SPACE_DRAWER_ART_ROI } from '../src/lib/spaceDrawerComposite.ts'

const css = readFileSync('src/styles/space.css', 'utf8')
const app = readFileSync('src/components/AISpace.tsx', 'utf8')
const manual = readFileSync('docs/space/G0A_E_drawer_visual_gate.md', 'utf8')

assert.equal(SPACE_WORLD_WIDTH, 941)
assert.equal(SPACE_WORLD_HEIGHT, 1672)
assert.equal(SPACE_DRAWER_OPEN_PERCENT, 42)
assert.match(app, /room-closed\.webp/)
assert.match(app, /room-content-cavity-v2\.webp/)
assert.match(app, /<SpaceDrawerCanvas/, 'drawer displays only the new E/C canvas')
assert.doesNotMatch(app, /open_drawer\.png/, 'wrong round handle may not display')
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

// Real drawable bounds, not just the rectangular hit target. Keep the CSS
// sprite anchored to exactly the same 941×1672 world coordinates.
const artCss = css.match(/\.ai-space-page\.is-layered \.space-v2-drawer-canvas\s*\{[^}]*?left:\s*([\d.]+)%;\s*top:\s*([\d.]+)%;\s*width:\s*([\d.]+)%;\s*height:\s*([\d.]+)%;/)
assert.ok(artCss, 'new Canvas world rectangle must remain measurable')
const actualCss = artCss.slice(1).map(Number)
const expectedCss = [
  SPACE_DRAWER_ART_ROI.x / SPACE_WORLD_WIDTH * 100,
  SPACE_DRAWER_ART_ROI.y / SPACE_WORLD_HEIGHT * 100,
  SPACE_DRAWER_ART_ROI.width / SPACE_WORLD_WIDTH * 100,
  SPACE_DRAWER_ART_ROI.height / SPACE_WORLD_HEIGHT * 100,
]
for (let i = 0; i < 4; i++) {
  assert.ok(Math.abs(actualCss[i] - expectedCss[i]) < .002,
    'sprite world coordinate must not drift from CSS: ' + i)
}
const visibleAreaFraction = (a, b) => {
  const x0=Math.max(a.x,b.x),y0=Math.max(a.y,b.y)
  const x1=Math.min(a.x+a.width,b.x+b.width)
  const y1=Math.min(a.y+a.height,b.y+b.height)
  return Math.max(0,x1-x0)*Math.max(0,y1-y0)/(a.width*a.height)
}
const outcomes = []
for (const [w, h] of [[390, 844], [390, 690], [430, 932]]) {
  const camera = computeSpaceCamera({ x: 0, y: 0, width: w, height: h })
  assert.ok(camera)
  const actualSpriteVisible = visibleAreaFraction(SPACE_DRAWER_ART_ROI,camera.visibleWorld)
  assert.ok(actualSpriteVisible >= .79,
    `At ${w}x${h} less than 79% of real drawer artwork is visible`)
  const clickableVisible = visibleAreaFraction(world,camera.visibleWorld)
  assert.ok(clickableVisible > .45, 'tap area must overlap the visible viewport')
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
  outcomes.push({ screen: `${w}x${h}`, travelPx: +travelPx.toFixed(1), hotArea: +(visibility * 100).toFixed(1), spriteVisible: +(actualSpriteVisible * 100).toFixed(1) })
}
console.log('[Space V2 E drawer] preliminary screen-space geometry (NOT visual QA)', outcomes)
console.log('[Space V2 E drawer] unapproved art explicitly documented: PASS')
