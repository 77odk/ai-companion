import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/styles/ui2.css', import.meta.url), 'utf8')
const controls = readFileSync(new URL('../src/components/ChatCompanionControls.tsx', import.meta.url), 'utf8')

function cssBlock(selector) {
  const escaped = selector.replace(/[.*+?^$()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(escaped + '\\s*\\{([\\s\\S]*?)\\}'))
  assert.ok(match, `missing CSS block: ${selector}`)
  return match[1]
}

test('chat companion controls sit below the composer in normal flow', () => {
  const shell = cssBlock('.chat-shell')
  assert.match(shell, /flex-direction:\s*column/)
  const row = cssBlock('.chat-companion-controls')
  assert.match(row, /position:\s*relative/)
  assert.doesNotMatch(row, /position:\s*absolute/)
  assert.match(row, /flex-wrap:\s*nowrap/)
  assert.match(row, /env\(safe-area-inset-bottom\)/)
  assert.match(cssBlock('.chat-shell .message-list'), /padding-bottom:\s*18px/)
})

test('control popovers open upward and stay bounded on mobile', () => {
  const menu = cssBlock('.chat-control-menu')
  assert.match(menu, /bottom:\s*calc\(100% \+ 8px\)/)
  assert.match(menu, /max-height:/)
  assert.match(menu, /overflow-y:\s*auto/)
  assert.match(cssBlock('.chat-identity-menu'), /100vw - 28px/)
  assert.match(cssBlock('.chat-model-menu'), /100vw - 28px/)
})

test('immersion control keeps choices compact and moves detail behind help', () => {
  assert.match(controls, /沉浸感 ·/)
  assert.match(controls, /AI 本体/)
  assert.match(controls, /note: '完整真人感'/)
  assert.match(controls, /note: '平衡真人感与 AI'/)
  assert.match(controls, /note: '保留 AI 身份'/)
  assert.match(controls, /查看沉浸感说明/)
  assert.match(controls, /chat-identity-help/)
  assert.match(controls, /不影响 TA 对你的记忆、关系和性格/)
  assert.match(controls, /让这段关系有靠近，也有等待/)
  assert.match(controls, /始终能回应你，但不会假装自己是真人/)
  assert.match(controls, /清醒、坦诚的 AI 伴侣陪着你/)
  const helpButton = cssBlock('.chat-control-menu .chat-control-help-button')
  assert.match(helpButton, /width:\s*26px/)
  assert.match(helpButton, /height:\s*26px/)
})
