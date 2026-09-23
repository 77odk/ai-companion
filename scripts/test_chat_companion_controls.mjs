import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/styles/ui2.css', import.meta.url), 'utf8')
const controls = readFileSync(new URL('../src/components/ChatCompanionControls.tsx', import.meta.url), 'utf8')
const chat = readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

function cssBlock(selector) {
  const escaped = selector.replace(/[.*+?^$()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(escaped + '\\s*\\{([\\s\\S]*?)\\}'))
  assert.ok(match, `missing CSS block: ${selector}`)
  return match[1]
}

test('composer and companion controls share one visual panel', () => {
  assert.match(chat, /<div className="chat-composer-panel">/)
  assert.match(chat, /<div className="chat-inline-controls">/)
  assert.match(chat, /<ChatCompanionControls sessionId=\{activeSessionId\} \/>/)
  assert.doesNotMatch(app, /<ChatCompanionControls/)
  assert.match(cssBlock('.chat-page .chat-composer-panel'), /border-radius:\s*20px/)
  assert.match(cssBlock('.chat-page .chat-composer-panel'), /env\(safe-area-inset-bottom\)/)
})

test('context meter is a circle on the same horizontal row as the capsules', () => {
  assert.match(chat, /className="context-meter-circle"/)
  assert.match(chat, /className="context-meter-ring"/)
  assert.match(chat, /CONTEXT_SOFT_BUDGET/)
  assert.match(chat, /整理后继续聊/)
  assert.match(chat, /承接到新一段/)
  assert.doesNotMatch(chat, /context-meter-bar/)
  const inline = cssBlock('.chat-page .chat-inline-controls')
  assert.match(inline, /display:\s*flex/)
  assert.match(inline, /align-items:\s*center/)
  assert.match(inline, /overflow-x:\s*auto/)
  const ring = cssBlock('.chat-page .context-meter-ring')
  assert.match(ring, /border-radius:\s*50%/)
  assert.match(ring, /width:\s*28px/)
  assert.match(ring, /height:\s*28px/)
})

test('model capsule stays beside the identity capsule instead of being pushed right', () => {
  const modelSlot = cssBlock('.chat-model-slot')
  assert.doesNotMatch(modelSlot, /margin-left:\s*auto/)
  const row = cssBlock('.chat-companion-controls')
  assert.match(row, /width:\s*auto/)
  assert.match(row, /gap:\s*8px/)
  assert.match(row, /flex-wrap:\s*nowrap/)
})

test('control popovers still open upward and stay bounded on mobile', () => {
  const menu = cssBlock('.chat-control-menu')
  assert.match(menu, /bottom:\s*calc\(100% \+ 8px\)/)
  assert.match(menu, /max-height:/)
  assert.match(menu, /overflow-y:\s*auto/)
  assert.match(cssBlock('.chat-identity-menu'), /100vw - 28px/)
  assert.match(cssBlock('.chat-model-menu'), /100vw - 28px/)
  const meter = cssBlock('.chat-page .context-meter-popover')
  assert.match(meter, /bottom:\s*calc\(100% \+ 8px\)/)
  assert.match(meter, /100vw - 36px/)
})

test('immersion control keeps the approved choices and help copy', () => {
  assert.match(controls, /沉浸感 ·/)
  assert.match(controls, /AI 本体/)
  assert.match(controls, /note: '完整真人感'/)
  assert.match(controls, /note: '平衡真人感与 AI'/)
  assert.match(controls, /note: '保留 AI 身份'/)
  assert.match(controls, /查看沉浸感说明/)
  assert.match(controls, /记忆、关系和性格不会因此改变。/)
})

test('chat still resolves controls from active session id before cache hydration', () => {
  assert.match(app, /const activeChatSessionId = getActiveSessionId\(\)/)
  assert.match(chat, /activeSessionId && \(/)
  assert.doesNotMatch(app, /headerSession && <ChatCompanionControls/)
})
