import assert from 'node:assert/strict'
import {
  SPACE_WORLD_WIDTH, SPACE_WORLD_HEIGHT, computeSpaceCamera,
  isSpacePointVisible, spaceWorldToScreen, spaceScreenToWorld,
  spaceScreenDeltaToWorld,
} from '../src/lib/spaceWorldCamera.ts'

const close = (a, b, tolerance = 1e-8) =>
  assert.ok(Math.abs(a - b) <= tolerance, String(a) + ' != ' + String(b))

// Three mobile shapes, original art size, and an embedded/off-origin viewport.
for (const view of [
  { x: 0, y: 0, width: 390, height: 844 },
  { x: 0, y: 0, width: 390, height: 690 },
  { x: 0, y: 0, width: 430, height: 932 },
  { x: 0, y: 0, width: SPACE_WORLD_WIDTH, height: SPACE_WORLD_HEIGHT },
  { x: 19, y: 33, width: 390, height: 844 },
]) {
  const cam = computeSpaceCamera(view)
  assert.ok(cam)
  close(cam.scale, Math.max(view.width / SPACE_WORLD_WIDTH, view.height / SPACE_WORLD_HEIGHT))
  assert.ok(cam.scale * SPACE_WORLD_WIDTH >= view.width - 1e-8)
  assert.ok(cam.scale * SPACE_WORLD_HEIGHT >= view.height - 1e-8)

  for (const world of [
    { x: 0, y: 0 }, { x: 470.5, y: 836 },
    { x: 941, y: 1672 }, { x: 117.13, y: 999.2 },
  ]) {
    const screen = spaceWorldToScreen(world, cam)
    const back = spaceScreenToWorld(screen, cam)
    close(back.x, world.x)
    close(back.y, world.y)
  }
  const center = spaceWorldToScreen(
    { x: SPACE_WORLD_WIDTH / 2, y: SPACE_WORLD_HEIGHT / 2 }, cam,
  )
  close(center.x, view.x + view.width / 2)
  close(center.y, view.y + view.height / 2)
  assert.ok(isSpacePointVisible(
    spaceScreenToWorld({ x: center.x, y: center.y }, cam), cam,
  ))
  const delta = spaceScreenDeltaToWorld({ x: 20, y: -13 }, cam)
  close(delta.x * cam.scale, 20)
  close(delta.y * cam.scale, -13)
}

const viewport = { x: 12, y: 25, width: 390, height: 844 }
const noSafe = computeSpaceCamera(viewport)
const safe = computeSpaceCamera(viewport, { top: 50, right: 15, bottom: 90, left: 20 })
assert.ok(noSafe && safe)
assert.deepEqual(safe.origin, noSafe.origin)
assert.ok(safe.safeVisibleWorld.width < safe.visibleWorld.width)
assert.ok(safe.safeVisibleWorld.height < safe.visibleWorld.height)
for (const screen of [
  { x: viewport.x + 20, y: viewport.y + 50 },
  { x: viewport.x + viewport.width - 15, y: viewport.y + viewport.height - 90 },
]) assert.ok(isSpacePointVisible(spaceScreenToWorld(screen, safe), safe, true))
assert.equal(isSpacePointVisible(
  spaceScreenToWorld({ x: viewport.x + 3, y: viewport.y + 70 }, safe),
  safe, true,
), false)
assert.equal(isSpacePointVisible({ x: Number.NaN, y: 0 }, safe), false)

for (const bad of [
  { x: 0, y: 0, width: 0, height: 844 },
  { x: 0, y: 0, width: 390, height: Infinity },
  { x: 0, y: NaN, width: 390, height: 844 },
]) assert.equal(computeSpaceCamera(bad), null)
assert.equal(computeSpaceCamera(viewport, { top: 844, right: 0, bottom: 0, left: 0 }), null)
assert.equal(computeSpaceCamera(viewport, { top: 0, right: 200, bottom: 0, left: 200 }), null)
assert.equal(computeSpaceCamera(viewport, { top: -1, right: 0, bottom: 0, left: 0 }), null)

console.log('[Space V2 camera] world/screen, cover, safe area, inverse input: PASS')
