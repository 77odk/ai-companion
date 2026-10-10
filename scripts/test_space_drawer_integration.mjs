import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SPACE_LAYER_REQUIRED } from '../src/lib/spaceSceneAssets.ts'
const scene=readFileSync('src/components/AISpace.tsx','utf8')
const view=readFileSync('src/components/SpaceDrawerCanvas.tsx','utf8')
const css=readFileSync('src/styles/space.css','utf8')
const manifest=JSON.parse(readFileSync('public/space/layered/manifest.json','utf8'))

// The same real weekly-letter route still handles tapping and pointer release.
assert.match(scene, /onOpenWeekly\(\)/)
assert.match(scene, /onClick=\{\(\) => \{[\s\S]*?openWeeklyFromDrawer\(\)/)
assert.match(scene, /if \(shouldOpenSpaceDrawer\(pull\)\) openWeeklyFromDrawer\(\)/)
assert.match(scene, /else drawerVisualRef\.current\?\.reset\(\)/)
assert.match(scene, /drawerVisualRef\.current\.paint\(fraction\)/)
assert.match(scene, /spaceDrawerCavityAlpha\(fraction\)/)
assert.match(css, /opacity: var\(--space-drawer-cavity-opacity, 0\)/)
assert.match(scene, /onPointerCancel=\{\(event\)/)
assert.match(scene, /onLostPointerCapture=\{\(event\)/)
assert.match(scene, /setDrawerReturning\(false\), reduce \? 1 : 620/)
assert.match(scene, /onOpenWeekly\(\)/)
assert.match(scene, /photos\.filter\(\(photo\) => photo\.sessionId === sid\)/)
assert.match(scene, /saveLocalPhotoMetadata/)

// One compositing plane. Book (z4) stays above drawer (z3), cavity beneath.
assert.match(scene, /<SpaceDrawerCanvas opening=\{drawerOpening\} returning=\{drawerReturning\}/)
assert.match(css, /\.ai-space-page\.is-layered \.space-v2-drawer-canvas\s*\{[^}]*z-index: 3;/)
assert.match(css, /\.ai-space-page\.is-layered \.space-scene-hotspot\.is-thought-book\s*\{[^}]*z-index: 4;/)
assert.match(css, /\.ai-space-page\.is-layered \.space-drawer-peek\s*\{[^}]*visibility: hidden;/)
assert.doesNotMatch(scene, /space-layer-drawer-art|open_drawer\.png/)
assert.match(scene, /room-cavity\.webp/)
assert.match(view, /aria-hidden="true"/)
assert.match(view, /document\.hidden/)
assert.match(view, /requestAnimationFrame/)
assert.match(view, /smoothedFrameMs > 43 \? 1000 \/ 12 : 1000 \/ 30/,
  'slow phones must degrade to a 12fps drawer')
assert.match(view, /prefers-reduced-motion: reduce/)
assert.match(view, /\.catch\(\(\) => \{[\s\S]*?setReady\(false\)/)
assert.doesNotMatch(view, /localStorage|sessionStorage|fetch\(|photoUrl|uploadPhoto/)

// Both new image sources are strictly staged, and no prior image was deleted.
for(const n of ['e_drawer_hq_v2.webp','c_drawer_depth_hq_v2.webp']){
  assert.ok(SPACE_LAYER_REQUIRED.includes(n), n)
  assert.ok(manifest.assets.includes(n), n)
}
assert.ok(!SPACE_LAYER_REQUIRED.includes('open_drawer.png'))
assert.ok(!manifest.assets.includes('open_drawer.png'))
assert.equal(manifest.enabled, false)
assert.equal(manifest.artApproved, false, 'art gate stays closed before mobile visual QA')
console.log('[Space V2 E/C integration] gesture, weekly route, role isolation and art depth order: PASS')
