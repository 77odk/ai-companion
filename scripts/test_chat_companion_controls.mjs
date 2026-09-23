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

test('context meter is compact, token-based, and placed after model controls', () => {
  assert.match(chat, /className="context-meter-circle"/)
  assert.match(chat, /className="context-meter-ring"/)
  assert.match(chat, /formatTokenCount\(contextMeter\.used\)/)
  assert.match(chat, /source: 'estimate'/)
  assert.match(chat, /source: 'actual'/)
  assert.match(chat, /真实值/)
  assert.match(chat, /估算/)
  assert.match(chat, /还没有数据/)
  assert.match(chat, /'整理'/)
  assert.match(chat, /'承接'/)
  assert.ok(
    chat.indexOf('<ChatCompanionControls sessionId={activeSessionId} />') < chat.indexOf('className="context-meter-slot"'),
    'Context 控件在身份/模型控件之后',
  )
  assert.doesNotMatch(chat, /CONTEXT_SOFT_BUDGET/)
  assert.doesNotMatch(chat, /context-meter-bar/)
  const inline = cssBlock('.chat-page .chat-inline-controls')
  assert.match(inline, /display:\s*flex/)
  assert.match(inline, /align-items:\s*center/)
  assert.match(inline, /overflow:\s*visible/)
  assert.doesNotMatch(inline, /overflow-x:\s*auto/)
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
  assert.match(row, /min-width:\s*0/)
  assert.match(row, /gap:\s*8px/)
  assert.match(row, /flex-wrap:\s*nowrap/)
})

test('control popovers stay bounded on mobile and model menu clamps to its button', () => {
  const menu = cssBlock('.chat-control-menu')
  assert.match(menu, /bottom:\s*calc\(100% \+ 8px\)/)
  assert.match(menu, /max-height:/)
  assert.match(menu, /overflow-y:\s*auto/)
  assert.match(cssBlock('.chat-identity-menu'), /100vw - 28px/)
  assert.match(cssBlock('.chat-model-menu'), /100vw - 24px/)
  assert.match(controls, /modelButtonRef/)
  assert.match(controls, /getBoundingClientRect\(\)/)
  assert.match(controls, /Math\.max\(12, Math\.min\(centered, viewportWidth - menuWidth - 12\)\)/)
  assert.match(controls, /position: 'fixed'/)
  const meter = cssBlock('.chat-page .context-meter-popover')
  assert.match(meter, /right:\s*0/)
  assert.match(meter, /100vw - 24px/)
})

test('immersion control shows only the selected value while keeping approved choices/help', () => {
  assert.doesNotMatch(controls, /沉浸感 · \{identityDisplayLabel/)
  assert.match(controls, /\{identityDisplayLabel\(identityMode\)\}/)
  assert.match(controls, /return mode === 'ai' \? 'AI本体'/)
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
