import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { projectSpaceDrawerPull, SPACE_DRAWER_OPEN_PERCENT, shouldOpenSpaceDrawer } from '../src/lib/spaceSceneDrag.ts'

const css = readFileSync('src/styles/space.css', 'utf8')
const scene = readFileSync('src/components/AISpace.tsx', 'utf8')
const painter = readFileSync('src/components/SpaceDrawerCanvas.tsx', 'utf8')
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
assert.match(scene, /drawerVisualRef\.current\.paint\(fraction\)/, 'gesture drives E/C canvas continuously')
assert.match(painter, /spaceDrawerCavityAlpha\(clamped\)/, 'shared Canvas progress reveals cavity')
assert.doesNotMatch(scene, /spaceDrawerCavityAlpha\(fraction\)/, 'no competing cavity clock')
assert.match(painter, /scenePageRef\.current\?\.style\.removeProperty\('--space-drawer-cavity-opacity'\)/, 'cleanup belongs to canvas lifecycle')
assert.doesNotMatch(scene, /style\.removeProperty\('--space-drawer-cavity-opacity'\)/, 'drag release must not flash the empty hole')
assert.match(css, /\.ai-space-page\.is-layered \.space-scene-backplate\.is-drawer-cavity\.is-visible,[\s\S]{0,260}opacity: var\(--space-drawer-cavity-opacity, 0\);\s*transition: none;/, 'opening and pulling use the same opacity variable')
assert.doesNotMatch(scene, /if \(layeredReady\) scenePageRef\.current\?\.classList\.add\('is-drawer-pulling'\)/, 'no black-hole state before canvas ready')
assert.match(scene, /room-closed\.webp/)
assert.match(scene, /room-cavity\.webp/)
assert.match(scene, /<SpaceDrawerCanvas/, 'layered drawer has one E/C canvas')
assert.doesNotMatch(scene, /space-layer-drawer-art/, 'old round-knob drawable removed')
assert.doesNotMatch(scene, /space-desk\.webp/, 'no baked photo fallback')
assert.match(lab, /open_drawer\.png/)
assert.match(lab, /room-closed\.webp/)

console.log('[Space V2 E drawer] 42% gesture maps to isolated E/C painter with fixed desk: PASS')
