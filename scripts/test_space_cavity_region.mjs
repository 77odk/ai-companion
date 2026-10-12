import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SPACE_DRAWER_ART_ROI } from '../src/lib/spaceDrawerComposite.ts'
import { SPACE_WORLD_WIDTH, SPACE_WORLD_HEIGHT } from '../src/lib/spaceWorldCamera.ts'

const css = readFileSync('src/styles/space.css','utf8')
const app = readFileSync('src/components/AISpace.tsx','utf8')
const manifest = JSON.parse(readFileSync('public/space/layered/manifest.json','utf8'))
const cavityStart = css.indexOf('.ai-space-page.is-layered .space-scene-backplate.is-drawer-cavity {')
assert.ok(cavityStart !== -1, 'layered cavity CSS exists')
const cavity = css.slice(cavityStart, css.indexOf('}', cavityStart)+1)
const match = cavity.match(/clip-path:\s*polygon\(\s*([\d.]+)%\s+([\d.]+)%,\s*100%\s+\2%,\s*100%\s+100%,\s*\1%\s+100%\s*\)/)
assert.ok(match,'only a lower-right cavity is allowed to crossfade')
const left = Number(match[1]) / 100 * SPACE_WORLD_WIDTH
const top = Number(match[2]) / 100 * SPACE_WORLD_HEIGHT
assert.ok(left < SPACE_DRAWER_ART_ROI.x && top < SPACE_DRAWER_ART_ROI.y,
  'cavity blend region must enclose the entire moving drawer ROI')
assert.ok(left > SPACE_WORLD_WIDTH*.40 && top > SPACE_WORLD_HEIGHT*.73,
  'do not crossfade the rest of the desk, wall, sunlight or plants')
assert.match(app,/room-closed\.webp/)
assert.match(app,/room-content-cavity-v2\.webp/)
assert.match(css,/opacity:\s*var\(--space-drawer-cavity-opacity, 0\)/)
assert.equal(manifest.enabled,false)
assert.equal(manifest.artApproved,false)
console.log('[G0-A] background cavity confined to lower-right drawer, no whole-room crossfade: PASS')
