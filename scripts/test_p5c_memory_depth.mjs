import assert from 'node:assert/strict'
import fs from 'node:fs'

const css = fs.readFileSync(new URL('../src/styles/memory.css', import.meta.url), 'utf8')
const component = fs.readFileSync(new URL('../src/components/Memory.tsx', import.meta.url), 'utf8')

console.log('[P5-C] existing Memory data / book state machine remains the source of truth')
for (const needle of [
  "loadMemory",
  "getMemoriesCache",
  "mergeSessionMemories",
  "buildBookPages",
  "correctMemoryText",
  "removeMemory",
]) assert.ok(component.includes(needle), 'missing existing Memory path: ' + needle)
assert.ok(component.includes("if (prefersReduced)"))
assert.ok(component.includes("setBookPageIdx(target)"))
assert.ok(component.includes("setFlip({ dir, target })"))

console.log('[P5-C] physical book uses existing cover / paper / back layers on one Z axis')
assert.ok(css.includes('.memory-book-portal {'))
assert.ok(css.includes('transform-style: preserve-3d;'))
assert.ok(css.includes('.memory-book-portal .mbp-back'))
assert.ok(css.includes('translateZ(-9px)'))
assert.ok(css.includes('.memory-book-portal .mbp-paper-1'))
assert.ok(css.includes('translateZ(-6px)'))
assert.ok(css.includes('.memory-book-portal .mbp-paper-2'))
assert.ok(css.includes('translateZ(-3px)'))
assert.ok(css.includes('.memory-book-portal .mbp-cover'))
assert.ok(css.includes('translateZ(2px)'))
assert.ok(css.includes('.memory-book-stage'))
assert.ok(css.includes('backface-visibility: hidden;'))
assert.ok(css.includes('.memory-book-face.is-back'))
assert.ok(css.includes('translateZ(-2px)'))

console.log('[P5-C] River and Book controls reuse P5-A Press / Lift / Settle')
for (const token of [
  'var(--el-motion-settle',
  'var(--el-ease-settle',
  'var(--el-feedback-press-transform',
  'var(--el-feedback-lift-transform',
  'var(--el-shadow-raised',
]) assert.ok(css.includes(token), 'missing feedback token: ' + token)
assert.ok(css.includes('.memory-entry:active'))
assert.ok(css.includes('.memory-book-open:active'))
assert.ok(css.includes('.memory-book-turn:active:not(:disabled)'))
assert.ok(css.includes('@media (hover: hover) and (pointer: fine)'))

console.log('[P5-C] coarse pointer does not retain desktop lift')
const coarseStart=css.indexOf('@media (pointer: coarse)')
assert.ok(coarseStart>=0)
const reducedStart=css.indexOf('@media (prefers-reduced-motion: reduce)',coarseStart)
const coarse=css.slice(coarseStart,reducedStart)
assert.ok(coarse.includes('.memory-book-portal:hover .mbp-cover'))
assert.ok(coarse.includes('.memory-book-entry:hover'))
assert.ok(coarse.includes('transform: none;'))

console.log('[P5-C] reduced motion removes interactive movement but preserves static thickness')
assert.ok(reducedStart>=0)
const reduced=css.slice(reducedStart,css.indexOf('/* Responsive Memory',reducedStart))
assert.ok(reduced.includes('.memory-entry:active'))
assert.ok(reduced.includes('.memory-book-open:active'))
assert.ok(reduced.includes('.memory-book-turn:active:not(:disabled)'))
assert.ok(reduced.includes('transform: none;'))
assert.ok(reduced.includes('transform: translateZ(2px) rotateX(.8deg) rotateZ(-.4deg);'))
assert.ok(reduced.includes('opacity: .9;'))

console.log('[P5-C] no new animation engine / horizontal layout transform')
assert.equal(css.includes('@keyframes'),false,'P5-C must reuse existing book flip animation, not create another animation system')
const p5Start=css.indexOf('/* P5-C')
const p5End=css.indexOf('.memory-book-open {',p5Start)
const depthBlock=css.slice(p5Start,p5End)
assert.equal(depthBlock.includes('translateX('),false,'new depth axis must not create horizontal overflow')
assert.equal(component.includes('<canvas'),false)
assert.equal(component.includes("getContext('2d')"),false)
assert.equal(component.includes('requestAnimationFrame'),true,'existing progressive render scheduling remains unchanged')

console.log('P5-C memory depth tests passed')
