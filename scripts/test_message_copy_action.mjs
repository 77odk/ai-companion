import assert from 'node:assert/strict'
import fs from 'node:fs'

const bubble = fs.readFileSync(new URL('../src/components/MessageBubble.tsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const chat = fs.readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')

console.log('[message-copy] copy action stays inside MessageBubble')
assert.match(bubble, /className="message-action-trigger"/)
assert.match(bubble, /className="message-action-menu" role="menu"/)
assert.match(bubble, /role="menuitem"/)

console.log('[message-copy] copy exactly what the user sees')
assert.match(bubble, /navigator\.clipboard\.writeText\(displayText\)/)
assert.doesNotMatch(bubble, /navigator\.clipboard\.writeText\(message\.content\)/)
assert.match(bubble, /!typing && displayText\.trim\(\)/)

console.log('[message-copy] no history or composer mutation is introduced')
assert.doesNotMatch(bubble, /saveMessages|saveMessagesCache|postMessage|setInput|onQuote/)
assert.doesNotMatch(chat, /message-action-trigger|handleCopy|onCopy/)

console.log('[message-copy] menu is compact and on-demand')
assert.match(css, /\.message-action-slot\s*\{[\s\S]*position:\s*relative/)
assert.match(css, /\.message-action-menu\s*\{[\s\S]*position:\s*absolute/)
assert.match(css, /\.message-action-trigger\s*\{[\s\S]*width:\s*28px;[\s\S]*height:\s*28px/)

console.log('message copy action: PASS')
