import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { projectSpaceDrawerPull, SPACE_DRAWER_OPEN_PERCENT, shouldOpenSpaceDrawer } from '../src/lib/spaceSceneDrag.ts'

const css = readFileSync('src/styles/space.css', 'utf8')
const scene = readFileSync('src/components/AISpace.tsx', 'utf8')
const lab = readFileSync('docs/space/G0B_motion_lab_20261009.html', 'utf8')

// The E-variant desk itself must not move. Only the independent drawer layer moves.
assert.equal(SPACE_DRAWER_OPEN_PERCENT, 42)
assert.equal(projectSpaceDrawerPull(100, 300, 100), SPACE_DRAWER_OPEN_PERCENT)
assert.equal(projectSpaceDrawerPull(100, 142, 100), SPACE_DRAWER_OPEN_PERCENT)
assert.equal(projectSpaceDrawerPull(100, 115, 100), 15)
assert.equal(shouldOpenSpaceDrawer(21), false)
assert.equal(shouldOpenSpaceDrawer(22), true)

const openKey = '.ai-space-page.is-layered .space-scene-hotspot.is-weekly-letter.is-opening .space-drawer-peek'
const closedKey = '.ai-space-page.is-layered .space-scene-hotspot.is-weekly-letter .space-drawer-peek'
const liveEnd = css.slice(css.indexOf('/* Drawer is not present twice:'), css.indexOf('/* A distinct cavity state'))
assert.ok(liveEnd.includes(openKey))
assert.ok(liveEnd.includes(closedKey))
assert.match(liveEnd, /is-opening \.space-drawer-peek\s*\{\s*opacity: 1;\s*transform: translate3d\(0, 42%, 0\) scale\(1\);/)
assert.match(liveEnd, /@keyframes space-layer-drawer-return\s*\{\s*from \{ opacity: 1; transform: translate3d\(0, 42%, 0\) scale\(1\); \}/)
assert.match(liveEnd, /transform 620ms cubic-bezier/)
assert.match(scene, /const delay = window\.matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\)\.matches \? 1 : 760/)
assert.match(scene, /drag\.element\.style\.opacity = String\(Math\.min\(1, pull \/ SPACE_DRAWER_OPEN_PERCENT\)\)/)
assert.match(scene, /room-closed\.webp/)
assert.match(scene, /room-cavity\.webp/)
assert.match(scene, /space-layer-drawer-art/)
assert.doesNotMatch(scene, /space-desk\.webp/, 'no baked photo fallback')
assert.match(lab, /open_drawer\.png/)
assert.match(lab, /room-closed\.webp/)

console.log('[Space V2 E drawer] 42% open travel, drag match, nonmoving desk, return animation: PASS')
