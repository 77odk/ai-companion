import assert from 'node:assert/strict'
import fs from 'node:fs'

const space = fs.readFileSync(new URL('../src/styles/space.css', import.meta.url), 'utf8')
const photos = fs.readFileSync(new URL('../src/styles/photoWallArchive.css', import.meta.url), 'utf8')
const aiSpace = fs.readFileSync(new URL('../src/components/AISpace.tsx', import.meta.url), 'utf8')
const memory = fs.readFileSync(new URL('../src/components/Memory.tsx', import.meta.url), 'utf8')
const photoWall = fs.readFileSync(new URL('../src/components/PhotoWallArchive.tsx', import.meta.url), 'utf8')

function expectPressAfterLift(css, activeSelector, hoverSelector, focusSelector) {
  const activeIndex = css.lastIndexOf(activeSelector)
  const hoverIndex = css.lastIndexOf(hoverSelector)
  const focusIndex = css.lastIndexOf(focusSelector)
  assert.ok(activeIndex >= 0, 'missing active selector: ' + activeSelector)
  assert.ok(hoverIndex >= 0, 'missing hover selector: ' + hoverSelector)
  assert.ok(focusIndex >= 0, 'missing focus selector: ' + focusSelector)
  assert.ok(
    activeIndex > hoverIndex && activeIndex > focusIndex,
    activeSelector + ' must win the cascade over hover/focus Lift',
  )
}

console.log('[P5-D] Space uses existing objects as the depth layers')
assert.ok(space.includes('.space-letter-envelope {'))
assert.ok(space.includes('perspective: 720px;'))
assert.ok(space.includes('transform-style: preserve-3d;'))
assert.ok(space.includes('.space-letter-envelope-back'))
assert.ok(space.includes('transform: translateZ(-6px);'))
assert.ok(space.includes('.space-letter-envelope-paper'))
assert.ok(space.includes('transform: translateZ(2px);'))
assert.ok(space.includes('.space-letter-envelope-flap'))
assert.ok(space.includes('transform: translateZ(4px);'))
assert.ok(space.includes('.space-letter-wax'))
assert.ok(space.includes('translateZ(8px)'))

console.log('[P5-D] Space Press / Lift / Settle keeps Press authoritative')
expectPressAfterLift(space, '.space-letter-envelope:active', '.space-letter-envelope:hover', '.space-letter-envelope:focus-visible')
expectPressAfterLift(space, '.event-archive-preview-item:active', '.event-archive-preview-item:hover', '.event-archive-preview-item:focus-visible')
expectPressAfterLift(space, '.space-archive-home .ai-space-v2-all:active', '.space-archive-home .ai-space-v2-all:hover', '.space-archive-home .ai-space-v2-all:focus-visible')
assert.ok(space.includes('@media (hover: hover) and (pointer: fine)'))

console.log('[P5-D] Photo preview gets bounded Z depth; the long archive remains faux depth')
assert.ok(photos.includes('.photo-stack-preview {'))
assert.ok(photos.includes('perspective: 780px;'))
assert.ok(photos.includes('transform-style: preserve-3d;'))
assert.ok(photos.includes('.photo-stack-felt'))
assert.ok(photos.includes('transform: translateZ(-4px);'))
assert.ok(photos.includes('.photo-stack-card'))
assert.ok(photos.includes('translateZ(4px)'))
const p5dStart = photos.indexOf('/* ---- P5-D')
assert.ok(p5dStart >= 0)
const p5d = photos.slice(p5dStart)
const longWallTransforms = [...p5d.matchAll(/\.photo-archive-card[^\{]*\{[^}]*transform:\s*([^;]+);/gs)]
  .map((match) => match[1])
assert.ok(longWallTransforms.length >= 3, 'expected base/focus-hover/active long-wall transforms')
assert.equal(
  longWallTransforms.some((value) => value.includes('translateZ(')),
  false,
  'full photo archive cards must stay faux-depth instead of creating many 3D layers',
)

console.log('[P5-D] Photo Press wins over Lift without losing deterministic layout transforms')
expectPressAfterLift(photos, '.photo-stack-preview:active', '.photo-stack-preview:hover', '.photo-stack-preview:focus-visible')
expectPressAfterLift(photos, '.photo-archive-card:active', '.photo-archive-card:hover', '.photo-archive-card:focus-visible')
expectPressAfterLift(photos, '.photo-archive-empty:active', '.photo-archive-empty:hover', '.photo-archive-empty:focus-visible')
assert.ok(photos.includes('translateX(var(--photo-shift)) translateY(1px) rotate(var(--photo-rotate)) scale(.985)'))

console.log('[P5-D] reduced motion and coarse pointer do not depend on desktop hover')
const p5dSpaceStart = space.indexOf('/* ---- P5-D')
assert.ok(p5dSpaceStart >= 0)
const spaceReducedStart = space.indexOf('@media (prefers-reduced-motion: reduce)', p5dSpaceStart)
assert.ok(spaceReducedStart >= 0)
const spaceReduced = space.slice(spaceReducedStart, space.indexOf('/* Responsive Space', spaceReducedStart))
assert.ok(spaceReduced.includes('transition: none;'))
assert.ok(spaceReduced.includes('transform: none;'))
assert.ok(spaceReduced.includes('opacity: .9;'))

const photoReducedStart = photos.lastIndexOf('@media (prefers-reduced-motion: reduce)')
assert.ok(photoReducedStart >= 0)
const photoReduced = photos.slice(photoReducedStart, photos.indexOf('/* Responsive Photo Archive', photoReducedStart))
assert.ok(photoReduced.includes('transition: none;'))
assert.ok(photoReduced.includes('transform: translateX(var(--photo-shift)) rotate(var(--photo-rotate));'))
assert.ok(photoReduced.includes('transform: translateY(-50%);'))
assert.ok(photoReduced.includes('opacity: .9;'))
assert.ok(photos.includes('@media (hover: hover) and (pointer: fine)'))

console.log('[P5-D] no new runtime animation engine or Space data behavior')
assert.equal(aiSpace.includes('<canvas'), false)
assert.equal(aiSpace.includes('requestAnimationFrame'), false)
assert.equal(photoWall.includes('<canvas'), false)
assert.equal(photoWall.includes('requestAnimationFrame'), false)
assert.equal(photoWall.includes('pointermove'), false)
assert.equal(p5d.includes('@keyframes'), false)
assert.ok(aiSpace.includes('<PhotoWallArchive'))
assert.equal(aiSpace.includes('<EventArchive'), false)
assert.ok(memory.includes('<EventArchive'), 'approved S3 destination: shared experiences live in Chaomu')
assert.ok(photoWall.includes('const preview = sorted.slice(0, 12)'))

console.log('P5-D Space / Photo Wall depth tests passed')
