import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync('src/App.tsx', 'utf8')
const aiSpace = readFileSync('src/components/AISpace.tsx', 'utf8')
const thought = readFileSync('src/components/ThoughtBook.tsx', 'utf8')
const listen = readFileSync('src/components/ListenTogether.tsx', 'utf8')
const css = readFileSync('src/styles/space.css', 'utf8')

console.log('[Space S2] four approved desk objects are real entry points')
for (const klass of ['is-star-jar', 'is-thought-book', 'is-player', 'is-weekly-letter']) {
  assert.match(aiSpace, new RegExp(`space-scene-hotspot ${klass}`))
}
assert.match(aiSpace, /onClick=\{onOpenStarJar\}/)
assert.match(aiSpace, /onClick=\{onOpenThoughts\}/)
assert.match(aiSpace, /onClick=\{onOpenListen\}/)
assert.match(aiSpace, /const openWeeklyFromDrawer/)
assert.match(aiSpace, /onClick=\{openWeeklyFromDrawer\}/)
assert.match(aiSpace, /onOpenWeekly\(\)/)

console.log('[Space S2] photo archive compatibility entry remains reachable; S3 moves shared experiences to Chaomu')
assert.match(aiSpace, /space-scene-hotspot is-photo-wall/)
assert.match(aiSpace, /\{renderPhotoWall\(\)\}/)
assert.doesNotMatch(aiSpace, /space-scene-hotspot is-moments/)
assert.doesNotMatch(aiSpace, /<EventArchive/)

console.log('[Space S2] secondary destinations are routed without changing primary navigation')
assert.match(app, /lazy\(\(\) => import\('\.\/components\/ThoughtBook'\)\)/)
assert.match(app, /lazy\(\(\) => import\('\.\/components\/ListenTogether'\)\)/)
assert.match(app, /view === 'thoughts'/)
assert.match(app, /view === 'listen'/)
assert.match(app, /onOpenThoughts=\{\(\) => navigate\('thoughts'\)\}/)
assert.match(app, /onOpenListen=\{\(\) => navigate\('listen'\)\}/)

console.log('[Space S2] listening is local-only')
assert.match(listen, /accept="audio\/\*"/)
assert.match(listen, /URL\.createObjectURL\(file\)/)
assert.match(listen, /URL\.revokeObjectURL/)
assert.match(listen, /<audio/)
assert.doesNotMatch(listen, /fetch\(|axios|upload|postMessage|postMemory|api\.eluvin/)

console.log('[Space S2] thought book keeps its own material language')
assert.match(thought, /thought-book-cover/)
assert.match(thought, /TA 自己想过的/)
assert.match(css, /Direction v6 · S2 desk object interaction/)
assert.match(css, /space-object-glint/)
assert.match(css, /space-object-paper-edge/)
assert.match(css, /space-object-screen-glow/)
assert.match(css, /prefers-reduced-motion: reduce/)

console.log('[Space S2] object entries / local player / material separation 全通过')
