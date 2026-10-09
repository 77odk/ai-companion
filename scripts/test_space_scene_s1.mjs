import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'

const aiSpace = readFileSync('src/components/AISpace.tsx', 'utf8')
const app = readFileSync('src/App.tsx', 'utf8')
const css = readFileSync('src/styles/space.css', 'utf8')
const ui2 = readFileSync('src/styles/ui2.css', 'utf8')
const asset = 'public/space/space-desk.webp'
const playerCutout = 'public/space/cutouts/music-player.png'
const bookCutout = 'public/space/cutouts/thought-book.png'
const jarCutout = 'public/space/cutouts/memory-jar.png'

assert.match(aiSpace, /className="space-scene-shell"/)
assert.ok(aiSpace.includes('space-desk.webp'), 'approved sprite remains available as fallback')
assert.match(aiSpace, /space-scene-hotspot is-photo-wall/)
assert.match(aiSpace, /space-scene-hotspot is-weekly-letter/)
assert.doesNotMatch(aiSpace, /\/space\/generated\//)
assert.match(aiSpace, /space-scene-art-crop is-photo-wall-art/)
assert.match(aiSpace, /space-object-cutout is-jar-cutout/)
assert.ok(aiSpace.includes('memory-jar.png'), 'approved sprite remains available as fallback')
assert.match(aiSpace, /space-object-cutout is-book-cutout/)
assert.ok(aiSpace.includes('thought-book.png'), 'approved sprite remains available as fallback')
assert.match(aiSpace, /space-object-cutout is-player-cutout/)
assert.ok(aiSpace.includes('music-player.png'), 'approved sprite remains available as fallback')
assert.match(aiSpace, /space-scene-art-crop is-drawer-art/)
assert.match(aiSpace, /className="space-scene-service-host"/)
assert.match(aiSpace, /\{renderPhotoWall\(\)\}/)

assert.match(
  app,
  /view === 'home' \|\| view === 'aispace' \|\| view === 'memory' \|\| view === 'notifications'/,
  'Space must own the full main viewport without the old app header',
)

assert.match(css, /Direction v6 · S1 Space scene composition lock/)
assert.match(css, /aspect-ratio: 941 \/ 1672/)
assert.match(css, /\.space-scene-shell,\s*\.space-scene-hotspots \{[\s\S]{0,420}width: min\(100%, calc\(100dvh \* 941 \/ 1672\)\)/)
assert.match(css, /object-fit: fill/)
assert.doesNotMatch(css.slice(css.lastIndexOf('Mobile visual baseline')), /object-fit: cover/)
assert.match(css, /space-scene-service-host/)
assert.match(css, /Mobile object pixels: crop the approved scene/)
assert.match(css, /space-photo-slot-mask/)
assert.match(css, /backdrop-filter: blur\(7px\)/)
assert.match(css, /space-scene-hotspot\.is-photo-wall/)
assert.match(ui2, /\.app:has\(\.ai-space-page\) \.app-main \{\s*padding-bottom: 0;/)
assert.match(css, /prefers-reduced-motion: reduce/)

const bytes = statSync(asset).size
assert.ok(bytes > 20_000, 'confirmed scene artwork should not be an empty placeholder')
assert.ok(bytes < 300_000, 'scene artwork must stay inside the v2 asset budget')
for (const cutout of [playerCutout, bookCutout, jarCutout]) {
  const cutoutBytes = statSync(cutout).size
  assert.ok(cutoutBytes > 2_000, 'real transparent cutout must not be an empty placeholder')
  assert.ok(cutoutBytes < 300_000, 'each transparent cutout stays inside the asset budget')
}

console.log('[Space S1] fixed scene shell / artwork / photo archive guard 全通过')
