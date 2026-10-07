import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'

const aiSpace = readFileSync('src/components/AISpace.tsx', 'utf8')
const app = readFileSync('src/App.tsx', 'utf8')
const css = readFileSync('src/styles/space.css', 'utf8')
const ui2 = readFileSync('src/styles/ui2.css', 'utf8')
const asset = 'public/space/space-desk.webp'

assert.match(aiSpace, /className="space-scene-shell"/)
assert.match(aiSpace, /src="\/space\/space-desk\.webp"/)
assert.match(aiSpace, /className="space-scene-hotspot is-photo-wall"/)
assert.match(aiSpace, /className="space-scene-hotspot is-weekly-letter"/)
assert.match(aiSpace, /className="space-scene-service-host"/)
assert.match(aiSpace, /\{renderPhotoWall\(\)\}/)

assert.match(
  app,
  /view === 'home' \|\| view === 'aispace' \|\| view === 'memory' \|\| view === 'notifications'/,
  'Space must own the full main viewport without the old app header',
)

assert.match(css, /Direction v6 · S1 Space scene composition lock/)
assert.match(css, /object-fit: cover/)
assert.match(css, /space-scene-service-host/)
assert.match(css, /space-scene-hotspot\.is-photo-wall/)
assert.match(ui2, /\.app:has\(\.ai-space-page\) \.app-main \{\s*padding-bottom: 0;/)
assert.match(css, /prefers-reduced-motion: reduce/)

const bytes = statSync(asset).size
assert.ok(bytes > 20_000, 'confirmed scene artwork should not be an empty placeholder')
assert.ok(bytes < 300_000, 'scene artwork must stay inside the v2 asset budget')

console.log('[Space S1] fixed scene shell / artwork / photo archive guard 全通过')
