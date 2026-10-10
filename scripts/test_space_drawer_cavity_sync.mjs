import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { drawerFrameProgress, spaceDrawerCavityAlpha } from '../src/lib/spaceDrawerComposite.ts'

const view = readFileSync('src/components/AISpace.tsx', 'utf8')
const renderer = readFileSync('src/components/SpaceDrawerCanvas.tsx', 'utf8')
const css = readFileSync('src/styles/space.css', 'utf8')
const manifest = JSON.parse(readFileSync('public/space/layered/manifest.json', 'utf8'))

assert.equal(manifest.enabled, false)
assert.equal(manifest.artApproved, false)
assert.match(view, /scenePageRef=\{scenePageRef\}/)
assert.match(view, /drawerVisualRef\.current\.paint\(fraction\)/)
assert.doesNotMatch(view, /style\.setProperty\('--space-drawer-cavity-opacity'/,
  'parent must not maintain another clock')
assert.doesNotMatch(view, /style\.removeProperty\('--space-drawer-cavity-opacity'/,
  'gesture finishing must not flash cavity to closed before the auto-open begins')
assert.match(renderer, /paintedRef\.current = clamped[\s\S]{0,250}scenePageRef\.current\?\.style\.setProperty\('--space-drawer-cavity-opacity', String\(spaceDrawerCavityAlpha\(clamped\)\)\)/)
assert.match(renderer, /paintSpaceDrawer\(ctx, art, clamped\)/)
assert.match(renderer, /scenePageRef\.current\?\.style\.removeProperty\('--space-drawer-cavity-opacity'\)/)
assert.match(css, /\.space-scene-backplate\.is-drawer-cavity\.is-visible,[\s\S]{0,260}opacity: var\(--space-drawer-cavity-opacity, 0\);/)
const cavityBlock = css.slice(css.lastIndexOf('/* A distinct cavity state'), css.lastIndexOf('/* Photo thumbnails'))
assert.ok(cavityBlock.includes('transition: none;'))
assert.doesNotMatch(cavityBlock, /\.is-visible,[\s\S]{0,170}opacity: 1;/)
assert.equal(spaceDrawerCavityAlpha(0),0)
assert.equal(spaceDrawerCavityAlpha(0.25),0.5)
assert.equal(spaceDrawerCavityAlpha(0.5),1)
assert.equal(spaceDrawerCavityAlpha(1),1)
for (const t of [0, 100, 250, 380, 500, 760]) {
  const progress = drawerFrameProgress(t)
  const cavity = spaceDrawerCavityAlpha(progress)
  assert.ok(progress >= 0 && progress <= 1)
  assert.ok(cavity >= 0 && cavity <= 1)
}
console.log('[Space G0-B] cavity visibility and E/C sprite share the SAME progress in drag/open/return: PASS')
