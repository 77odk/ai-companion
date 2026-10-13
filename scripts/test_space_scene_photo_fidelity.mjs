import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { SPACE_LAYER_REQUIRED } from '../src/lib/spaceSceneAssets.ts'
import { computeSpaceCamera } from '../src/lib/spaceWorldCamera.ts'

const view = readFileSync('src/components/AISpace.tsx', 'utf8')
const css = readFileSync('src/styles/space.css', 'utf8')

const activeManifest = JSON.parse(readFileSync('public/space/layered/manifest.json', 'utf8'))
assert.equal(SPACE_LAYER_REQUIRED.includes('photo_wall_board.png'), false, 'unused board must not download in preload')
assert.equal(activeManifest.assets.includes('photo_wall_board.png'), false, 'active manifest must match rendered photos')
assert.ok(statSync('public/space/layered/photo_wall_board.png').size > 0, 'original cutout must stay intact')


// No sample photos/board are allowed in either the normal or fallback scene.
assert.doesNotMatch(view, /\/space\/space-desk\.webp/, 'demo-composite must not render')
assert.doesNotMatch(view, /is-photo-board-cutout|photo_wall_board\.png/, 'wood-and-string board differs from approved pinned-photo artwork')
assert.doesNotMatch(view, /space-photo-slot-mask/, 'empty spaces must stay empty')
assert.match(view, /const scenePhotos = visiblePhotos\.slice\(0, 8\)/)
assert.match(view, /scenePhotos\.map\(\(photo, index\) =>/)
assert.match(view, /src=\{photo\.dataUrl \?\? photoUrl\(photo\.id, token\)\}/)
assert.match(view, /loadLocalPhotos\(sid\)/, 'photo records must stay scoped to active session')
assert.match(view, /visiblePhotos = useMemo\(\(\) => photos\.filter\(\(photo\) => photo\.sessionId === sid\)/,
  'new role must not briefly render the previous role photos')
assert.match(view, /photos=\{visiblePhotos\}/, 'full photo wall also uses session-filtered photos')
assert.match(view, /cloudRows\.some\(\(photo\) => !isValidCloudPhotoRow\(photo\) \|\| photo\.sessionId !== sid\)/,
  'cross-session photo response must not be merged')
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
assert.match(css.slice(css.lastIndexOf('G0-A wall-photo fidelity') - 250), /\.space-scene-hotspot\.is-photo-wall\s*\{\s*clip-path:\s*none;/, 'legacy fallback polygon must not clip user photos')
assert.match(css, /\.space-scene-hotspot\.is-photo-wall \.space-live-photo-board::before,[\s\S]*?::after\s*\{\s*content:\s*none;/)
assert.match(css, /\.space-live-photo::before\s*\{/, 'existing single-photo pin appearance should remain')

console.log('[Space V2 photos] real session photos, empty wall, consistent preload geometry: PASS')


// Only defaults are normalized here. Persisted user placements remain untouched.
// Prevent new thumbnails from being clipped by cover-cropped 390/430 px displays.
const definition = view.match(/const defaults = \[([\s\S]*?)\]\s*return defaults\[index % defaults\.length\]/)
assert.ok(definition, 'default scene positions missing')
const placements = [...definition[1].matchAll(/\{\s*x:\s*(\d+),\s*y:\s*(\d+),\s*rotate:\s*(-?\d+)\s*\}/g)]
  .map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))
assert.equal(placements.length, 8)
const photoWidth = css.match(/\.space-live-photo\s*\{[^}]*?width:\s*([\d.]+)%/) 
assert.ok(photoWidth, 'photo thumbnail width not found')
const frame = normal.slice(1).map(Number)
const [fx, fy, fw, fh] = frame
const worldWidth = 941, worldHeight = 1672
const thumbWorldWidth = fw / 100 * worldWidth * Number(photoWidth[1]) / 100
for (const [width, height] of [[390, 844], [390, 690], [430, 932]]) {
  const camera = computeSpaceCamera({ x: 0, y: 0, width, height })
  assert.ok(camera)
  const visible = camera.visibleWorld
  for (const [index, p] of placements.entries()) {
    const left = worldWidth * (fx / 100 + fw / 100 * p.x / 100)
    const top = worldHeight * (fy / 100 + fh / 100 * p.y / 100)
    const right = left + thumbWorldWidth
    const bottom = top + thumbWorldWidth / .78
    assert.ok(left >= visible.x - 0.05 && right <= visible.x + visible.width + 0.05,
      'default photo ' + (index + 1) + ' clips horizontally at ' + width + 'x' + height)
    assert.ok(top >= visible.y - 0.05 && bottom <= visible.y + visible.height + 0.05,
      'default photo ' + (index + 1) + ' clips vertically at ' + width + 'x' + height)
  }
}
console.log('[Space V2 photos] all 8 default thumbnails fit 390x844, 390x690, 430x932: PASS')
