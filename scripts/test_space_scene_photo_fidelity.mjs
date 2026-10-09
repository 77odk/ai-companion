import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const view = readFileSync('src/components/AISpace.tsx', 'utf8')
const css = readFileSync('src/styles/space.css', 'utf8')

// No sample photos/board are allowed in either the normal or fallback scene.
assert.doesNotMatch(view, /\/space\/space-desk\.webp/, 'demo-composite must not render')
assert.doesNotMatch(view, /is-photo-board-cutout|photo_wall_board\.png/, 'wood-and-string board differs from approved pinned-photo artwork')
assert.doesNotMatch(view, /space-photo-slot-mask/, 'empty spaces must stay empty')
assert.match(view, /const scenePhotos = photos\.slice\(0, 8\)/)
assert.match(view, /scenePhotos\.map\(\(photo, index\) =>/)
assert.match(view, /src=\{photo\.dataUrl \?\? photoUrl\(photo\.id, token\)\}/)
assert.match(view, /loadLocalPhotos\(sid\)/, 'photo records must stay scoped to active session')
assert.match(view, /saveLocalPhotoMetadata\(next, sid\)/, 'drag placement still saves in existing metadata')
assert.match(view, /\{renderPhotoWall\(\)\}/, 'full photo wall remains mounted')

// CSS geometry must be identical before and after layered resources load.
// Otherwise photos appear to jump while manifest/preload finishes.
const normal = css.match(/\.space-scene-hotspot\.is-photo-wall\s*\{\s*left:\s*([\d.]+)%;\s*top:\s*([\d.]+)%;\s*width:\s*([\d.]+)%;\s*height:\s*([\d.]+)%;/m)
const layered = css.match(/\.ai-space-page\.is-layered \.space-scene-hotspot\.is-photo-wall\s*\{[^}]*?left:\s*([\d.]+)%;\s*top:\s*([\d.]+)%;\s*width:\s*([\d.]+)%;\s*height:\s*([\d.]+)%;/m)
assert.ok(normal, 'normal wall geometry missing')
assert.ok(layered, 'layered wall geometry missing')
assert.deepEqual(normal.slice(1), layered.slice(1), 'photo placement frame changes on preload')
assert.ok(normal.slice(1).every(v => Number.isFinite(Number(v))))
assert.match(css, /\.ai-space-page\.is-layered \.space-live-photo-board\s*\{\s*inset:\s*0;/)
assert.match(css, /\.space-scene-hotspot\.is-photo-wall \.space-live-photo-board::before,[\s\S]*?::after\s*\{\s*content:\s*none;/)
assert.match(css, /\.space-live-photo::before\s*\{/, 'existing single-photo pin appearance should remain')

console.log('[Space V2 photos] real session photos, empty wall, consistent preload geometry: PASS')
