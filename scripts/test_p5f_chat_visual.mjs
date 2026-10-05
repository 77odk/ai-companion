import assert from 'node:assert/strict'
import fs from 'node:fs'

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')
const chatCss = fs.readFileSync(new URL('../src/styles/chat.css', import.meta.url), 'utf8')
const chat = fs.readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
const bubble = fs.readFileSync(new URL('../src/components/MessageBubble.tsx', import.meta.url), 'utf8')
const controls = fs.readFileSync(new URL('../src/components/ChatCompanionControls.tsx', import.meta.url), 'utf8')

function expectPressAfterLift(activeSelector, hoverSelector, focusSelector) {
  const activeIndex = chatCss.lastIndexOf(activeSelector)
  const hoverIndex = chatCss.lastIndexOf(hoverSelector)
  const focusIndex = chatCss.lastIndexOf(focusSelector)
  assert.ok(activeIndex >= 0, 'missing active selector: ' + activeSelector)
  assert.ok(hoverIndex >= 0, 'missing hover selector: ' + hoverSelector)
  assert.ok(focusIndex >= 0, 'missing focus selector: ' + focusSelector)
  assert.ok(
    activeIndex > hoverIndex && activeIndex > focusIndex,
    activeSelector + ' must win the cascade over hover/focus Lift',
  )
}

console.log('[P5-F] Chat visual layer is loaded last without touching Chat components')
const chatImport = main.indexOf("import './styles/chat.css'")
const keyGuideImport = main.indexOf("import './styles/keyGuide.css'")
assert.ok(chatImport > keyGuideImport, 'chat.css must be the final CSS integration layer')
assert.equal(chat.includes("import '../styles/chat.css'"), false)
assert.equal(bubble.includes("import '../styles/chat.css'"), false)
assert.equal(controls.includes("import '../styles/chat.css'"), false)
assert.ok(chat.includes('className="chat-composer-panel"'))
assert.ok(bubble.includes('message-actions-trigger'))
assert.ok(controls.includes('chat-control-capsule'))

console.log('[P5-F] compact bubbles stay content surfaces; depth belongs to real layers')
assert.match(chatCss, /\.chat-page \.bubble-user,[\s\S]*\.chat-page \.bubble-assistant \{[\s\S]*box-shadow: var\(--el-shadow-surface/)
assert.match(chatCss, /\.chat-page \.chat-composer-panel \{[\s\S]*box-shadow: var\(--el-shadow-raised/)
assert.match(chatCss, /\.chat-page \.chat-control-menu,[\s\S]*\.chat-page \.context-meter-popover,[\s\S]*\.chat-page \.message-actions-menu \{[\s\S]*box-shadow: var\(--el-shadow-floating/)
assert.equal(chatCss.includes('translateX('), false, 'P5-F must not introduce horizontal motion or overflow risk')
assert.equal(chatCss.includes('perspective:'), false, 'Chat must remain faux-depth, not a 3D scene')
assert.equal(chatCss.includes('translateZ('), false, 'Chat bubbles/controls must not create a large compositor stack')

console.log('[P5-F] Press wins over Lift for primary Chat controls')
expectPressAfterLift(
  '.chat-page .msg-avatar-btn:active',
  '.chat-page .msg-avatar-btn:hover',
  '.chat-page .msg-avatar-btn:focus-visible',
)
expectPressAfterLift(
  '.chat-page .think-bar:active',
  '.chat-page .think-bar:hover',
  '.chat-page .think-bar:focus-visible',
)
expectPressAfterLift(
  '.chat-page .message-actions-trigger:active',
  '.chat-page .message-actions-trigger:hover',
  '.chat-page .message-actions-trigger:focus-visible',
)
expectPressAfterLift(
  '.chat-page .chat-control-capsule:active',
  '.chat-page .chat-control-capsule:hover',
  '.chat-page .chat-control-capsule:focus-visible',
)
expectPressAfterLift(
  '.chat-page .context-meter-circle:active',
  '.chat-page .context-meter-circle:hover',
  '.chat-page .context-meter-circle:focus-visible',
)
expectPressAfterLift(
  '.chat-page .btn-action-narration:active:not(:disabled)',
  '.chat-page .btn-action-narration:hover:not(:disabled)',
  '.chat-page .btn-action-narration:focus-visible',
)
expectPressAfterLift(
  '.chat-page .btn-send:active:not(:disabled)',
  '.chat-page .btn-send:hover:not(:disabled)',
  '.chat-page .btn-send:focus-visible',
)
expectPressAfterLift(
  '.chat-page .btn-stop:active:not(:disabled)',
  '.chat-page .btn-stop:hover:not(:disabled)',
  '.chat-page .btn-stop:focus-visible',
)

console.log('[P5-F] desktop hover is fine-pointer only and keyboard focus stays visible')
const hoverMedia = chatCss.indexOf('@media (hover: hover) and (pointer: fine)')
assert.ok(hoverMedia >= 0)
const pressComment = chatCss.indexOf('/* Press stays after focus / hover')
assert.ok(pressComment > hoverMedia)
const beforeHoverMedia = chatCss.slice(0, hoverMedia)
assert.equal(beforeHoverMedia.includes(':hover'), false, 'no P5-F hover behavior may leak outside fine-pointer media')
assert.match(chatCss, /\.chat-page \.message-actions-menu button:focus-visible,[\s\S]*outline: 2px solid/)
assert.match(chatCss, /\.chat-page \.chat-control-menu button:focus-visible,[\s\S]*outline: 2px solid/)

console.log('[P5-F] reduced motion removes continuous / interactive movement')
const reducedStart = chatCss.indexOf('@media (prefers-reduced-motion: reduce)')
assert.ok(reducedStart >= 0)
const reduced = chatCss.slice(reducedStart)
assert.ok(reduced.includes('transition: none;'))
assert.ok(reduced.includes('transform: none;'))
assert.ok(reduced.includes('.chat-page .typing i'))
assert.ok(reduced.includes('animation: none !important;'))
assert.ok(reduced.includes('opacity: .9;'))
assert.equal(chatCss.includes('@keyframes'), false, 'P5-F adds no new ambient/keyframe animation')

console.log('[P5-F] hidden pages pause the one existing continuous Chat animation')
assert.match(chatCss, /html\[data-el-page-hidden='true'\] \.chat-page \.typing i/)
assert.match(chatCss, /animation-play-state: paused !important;/)

console.log('[P5-F] style-only boundary: no runtime/data mechanisms are added')
for (const forbidden of [
  'localStorage',
  'sessionStorage',
  'fetch(',
  'postMessage(',
  'requestAnimationFrame',
  'setInterval(',
  'setTimeout(',
  '<canvas',
]) {
  assert.equal(chatCss.includes(forbidden), false, 'chat.css must not contain runtime mechanism: ' + forbidden)
}

console.log('P5-F Chat visual closure tests passed')
