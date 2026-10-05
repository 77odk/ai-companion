import assert from 'node:assert/strict'
import fs from 'node:fs'

const tokens = fs.readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')
const primitives = fs.readFileSync(new URL('../src/styles/primitives.css', import.meta.url), 'utf8')
const ui2 = fs.readFileSync(new URL('../src/styles/ui2.css', import.meta.url), 'utf8')

console.log('[P5-A] motion / depth tokens')
for (const token of [
  '--el-motion-press',
  '--el-motion-settle',
  '--el-ease-settle',
  '--el-feedback-press-transform',
  '--el-feedback-lift-transform',
  '--el-shadow-surface',
  '--el-shadow-raised',
  '--el-shadow-floating',
]) {
  assert.ok(tokens.includes(token), 'missing token: ' + token)
}
assert.ok(tokens.includes('--el-feedback-press-transform: translateY(1px) scale(.992);'))
assert.ok(tokens.includes('--el-feedback-lift-transform: translateY(-1px);'))

console.log('[P5-A] shared Press / Lift / Settle')
assert.ok(primitives.includes('.btn:active:not(:disabled)'))
assert.ok(primitives.includes('var(--el-feedback-press-transform'))
assert.ok(primitives.includes('.btn:focus-visible'))
assert.ok(primitives.includes('var(--el-feedback-lift-transform'))
assert.ok(primitives.includes('var(--el-shadow-raised'))
assert.ok(primitives.includes('.switch-role-option:active'))
assert.ok(primitives.includes('.el-depth-surface'))
assert.ok(primitives.includes('.el-depth-raised'))
assert.ok(primitives.includes('.el-depth-floating'))

console.log('[P5-A] hover 只属于 fine pointer；coarse 不依赖 hover')
assert.ok(primitives.includes('@media (hover: hover) and (pointer: fine)'))
assert.ok(ui2.includes('@media (hover: hover) and (pointer: fine)'))
assert.ok(primitives.includes('.btn:hover:not(:disabled)'))
assert.ok(ui2.includes('.app-nav .nav-btn:hover'))
assert.equal(primitives.includes('@media (pointer: coarse)'), false)
assert.equal(ui2.includes('@media (pointer: coarse)'), false)

console.log('[P5-A] reduced motion 去掉位移/缩放，保留状态反馈')
const primitiveReduced = primitives.slice(primitives.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
assert.ok(primitiveReduced.includes('transform: none;'))
assert.ok(primitiveReduced.includes('opacity: 0.9;'))
const navStart = ui2.indexOf('.app-nav .nav-btn {')
const navEnd = ui2.indexOf('/* 4. active', navStart)
const navFoundation = ui2.slice(navStart, navEnd)
assert.ok(navFoundation.includes('var(--el-motion-settle'))
assert.ok(navFoundation.includes('.app-nav .nav-btn:active'))
const navReducedStart = ui2.indexOf('@media (prefers-reduced-motion: reduce)', navStart)
const navReducedEnd = ui2.indexOf('/* 4. active', navReducedStart)
const navReduced = ui2.slice(navReducedStart, navReducedEnd)
assert.ok(navReduced.includes('transform: none;'))
assert.ok(navReduced.includes('opacity: 0.9;'))

console.log('[P5-A] 390px 主路径安全：基础反馈不做横向位移或放大')
const pressLine = tokens.split('\n').find((line) => line.includes('--el-feedback-press-transform')) ?? ''
const liftLine = tokens.split('\n').find((line) => line.includes('--el-feedback-lift-transform')) ?? ''
assert.equal(pressLine.includes('translateX'), false)
assert.equal(liftLine.includes('translateX'), false)
const pressScale = Number(pressLine.match(/scale\(([^)]+)\)/)?.[1] ?? NaN)
assert.ok(Number.isFinite(pressScale) && pressScale <= 1, 'Press 只能缩小或等比，不能放大制造横向溢出')
assert.equal(liftLine.includes('scale('), false, 'Lift 只做纵向位移，不放大宽度')

console.log('[P5-A] Chat 不纳入本批 shared primitive 视觉选择器')
assert.equal(primitives.includes('.chat-page'), false)
assert.equal(primitives.includes('.composer'), false)
assert.equal(primitives.includes('.message-'), false)

console.log('P5-A foundation tests passed')
