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
assert.match(tokens, /--el-feedback-press-transform:\\s*translateY\\(1px\\) scale\\(\\.992\\)/)
assert.match(tokens, /--el-feedback-lift-transform:\\s*translateY\\(-1px\\)/)

console.log('[P5-A] shared Press / Lift / Settle')
assert.match(primitives, /\\.btn:active:not\\(:disabled\\)[\\s\\S]*--el-feedback-press-transform/)
assert.match(primitives, /\\.btn:focus-visible[\\s\\S]*--el-feedback-lift-transform[\\s\\S]*--el-shadow-raised/)
assert.match(primitives, /\\.switch-role-option:active[\\s\\S]*--el-feedback-press-transform/)
assert.match(primitives, /\\.el-depth-surface[\\s\\S]*--el-shadow-surface/)
assert.match(primitives, /\\.el-depth-raised[\\s\\S]*--el-shadow-raised/)
assert.match(primitives, /\\.el-depth-floating[\\s\\S]*--el-shadow-floating/)

console.log('[P5-A] hover 只属于 fine pointer；coarse 不依赖 hover')
assert.match(primitives, /@media \\(hover: hover\\) and \\(pointer: fine\\)[\\s\\S]*\\.btn:hover:not\\(:disabled\\)/)
assert.match(ui2, /@media \\(hover: hover\\) and \\(pointer: fine\\)[\\s\\S]*\\.app-nav \\.nav-btn:hover/)
assert.doesNotMatch(primitives, /@media[^\\{]*pointer:\\s*coarse[^\\{]*\\{[\\s\\S]{0,500}:hover/)
assert.doesNotMatch(ui2, /@media[^\\{]*pointer:\\s*coarse[^\\{]*\\{[\\s\\S]{0,500}:hover/)

console.log('[P5-A] reduced motion 去掉位移/缩放，保留状态反馈')
assert.match(primitives, /@media \\(prefers-reduced-motion: reduce\\)[\\s\\S]*\\.btn:active:not\\(:disabled\\)[\\s\\S]*transform:\\s*none/)
assert.match(primitives, /@media \\(prefers-reduced-motion: reduce\\)[\\s\\S]*opacity:\\s*0\\.9/)
assert.match(ui2, /@media \\(prefers-reduced-motion: reduce\\)[\\s\\S]*\\.app-nav \\.nav-btn:active[\\s\\S]*transform:\\s*none/)

console.log('[P5-A] 390px 主路径安全：基础反馈不做横向位移或放大')
assert.doesNotMatch(tokens, /--el-feedback-(?:press|lift)-transform:[^;]*translateX/)
const pressScale = Number(tokens.match(/--el-feedback-press-transform:[^;]*scale\\(([^)]+)\\)/)?.[1] ?? NaN)
assert.ok(Number.isFinite(pressScale) && pressScale <= 1, 'Press 只能缩小或等比，不能放大制造横向溢出')
assert.doesNotMatch(tokens, /--el-feedback-lift-transform:[^;]*scale\\((1\\.0[1-9]|1\\.[1-9])/)

console.log('[P5-A] Chat 不纳入本批基础视觉选择器')
assert.doesNotMatch(primitives, /\\.chat-page|\\.composer|\\.message-/)

console.log('P5-A foundation tests passed')
