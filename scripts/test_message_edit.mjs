import assert from 'node:assert/strict'
import fs from 'node:fs'
import { formatQuotedMessage, parseQuotedMessage } from '../src/lib/messageQuote.ts'
import { forkConversation, resolveConversationMessages } from '../src/lib/conversationState.ts'

const raw = [
  { id: 1, role: 'user', content: '第一句', ts: 1 },
  { id: 2, role: 'assistant', content: '旧回复', ts: 2 },
  { id: 3, role: 'user', content: '后续', ts: 3 },
  { id: 4, role: 'assistant', content: '后续回复', ts: 4 },
]

console.log('[message edit] branch semantics')
const edited = forkConversation(null, 's-edit', raw, {
  forkAfterMessageId: 1,
  contentOverrides: { 1: '第一句（改）' },
  reason: 'edit',
  now: 100,
})
assert.deepEqual(
  resolveConversationMessages(edited, raw).map(message => [message.id, message.content]),
  [[1, '第一句（改）']],
  'editing keeps edited user message and removes the old suffix from the active branch',
)
assert.equal(raw[0].content, '第一句', 'raw backend message remains immutable')
assert.deepEqual(
  resolveConversationMessages({ ...edited, activeBranchId: 'root' }, raw).map(message => message.id),
  [1, 2, 3, 4],
  'old branch remains recoverable',
)

console.log('[message edit] quoted context stays immutable while only body changes')
const originalQuoted = formatQuotedMessage({ speaker: 'assistant', text: '你刚才说的话' }, '原正文')
const parsed = parseQuotedMessage(originalQuoted)
assert.ok(parsed.quote)
const editedQuoted = formatQuotedMessage(parsed.quote, '新正文')
assert.deepEqual(parseQuotedMessage(editedQuoted), {
  quote: { speaker: 'assistant', text: '你刚才说的话' },
  body: '新正文',
})

console.log('[message edit] UI wiring is branch-only')
const chat = fs.readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8') + '\n' + fs.readFileSync(new URL('../src/lib/useChatScroll.ts', import.meta.url), 'utf8') + '\n' + fs.readFileSync(new URL('../src/lib/useChatMessages.ts', import.meta.url), 'utf8')
const bubble = fs.readFileSync(new URL('../src/components/MessageBubble.tsx', import.meta.url), 'utf8')
assert.match(chat, /const commitConversationEdit = \(message: StoredMessage, nextBody: string\) =>/)
assert.match(chat, /forkConversation\(conversationState, activeSessionId, messages, \{[\s\S]*forkAfterMessageId: message\.id,[\s\S]*contentOverrides: \{ \[message\.id\]: editedContent \},[\s\S]*reason: 'edit'/)
assert.match(chat, /const parsed = parseQuotedMessage\(message\.content\)/)
assert.match(chat, /parsed\.quote \? formatQuotedMessage\(parsed\.quote, body\) : body/)
assert.doesNotMatch(chat.slice(chat.indexOf('const commitConversationEdit'), chat.indexOf('const undoConversationBranchAction')), /postMessage\(|uploadMessage\(|processEventCandidate\(|recordChatTopic\(|writeMemory\(/)
assert.match(bubble, /onEdit\?: \(text: string\) => void/)
assert.match(bubble, /setEditDraft\(displayText\)/)
assert.match(bubble, /className="message-edit-input"/)
assert.match(bubble, /onEdit\(next\)/)

console.log('message edit contract: PASS')
