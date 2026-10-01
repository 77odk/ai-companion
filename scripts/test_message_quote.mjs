import assert from 'node:assert/strict'
import fs from 'node:fs'
import { formatQuotedMessage, messageEvidenceText, parseQuotedMessage } from '../src/lib/messageQuote.ts'

console.log('[message quote] round-trip + evidence isolation')

const quotedTa = formatQuotedMessage(
  { speaker: 'assistant', text: '我们明天一起去看电影吧\n记得带伞' },
  '好呀，我六点下班',
)
assert.equal(
  quotedTa,
  '> [TA] 我们明天一起去看电影吧\n> 记得带伞\n\n好呀，我六点下班',
  'quote format is stable plain text',
)
assert.deepEqual(
  parseQuotedMessage(quotedTa),
  {
    quote: { speaker: 'assistant', text: '我们明天一起去看电影吧\n记得带伞' },
    body: '好呀，我六点下班',
  },
  'assistant quote round-trips',
)
assert.equal(messageEvidenceText(quotedTa), '好呀，我六点下班', 'quoted TA text is not new user evidence')

const quotedMe = formatQuotedMessage(
  { speaker: 'user', text: '我喜欢猫' },
  '不过最近更想养狗',
)
assert.deepEqual(
  parseQuotedMessage(quotedMe),
  {
    quote: { speaker: 'user', text: '我喜欢猫' },
    body: '不过最近更想养狗',
  },
  'user quote round-trips',
)
assert.equal(messageEvidenceText(quotedMe), '不过最近更想养狗', 'quoted own prior text is not re-asserted evidence')

const ordinaryMarkdown = '> 这只是我自己手写的一行\n下一行'
assert.deepEqual(
  parseQuotedMessage(ordinaryMarkdown),
  { quote: null, body: ordinaryMarkdown },
  'ordinary > text is never guessed as a product quote',
)
assert.equal(messageEvidenceText(ordinaryMarkdown), ordinaryMarkdown.trim(), 'ordinary content remains evidence')

assert.equal(
  formatQuotedMessage({ speaker: 'assistant', text: '' }, '正文'),
  '正文',
  'empty quote safely falls back to body',
)

const chat = fs.readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
const bubble = fs.readFileSync(new URL('../src/components/MessageBubble.tsx', import.meta.url), 'utf8')

assert.match(chat, /userText:\s*text/, 'current Event candidate uses newly typed body only')
assert.match(chat, /recordChatTopic\(text,/, 'FutureIntent\/Space topic capture uses newly typed body only')
assert.match(chat, /messageEvidenceText\(m\.content\)/, 'historical quoted rows are stripped before Event evidence reuse')
assert.match(chat, /formatQuotedMessage\(quote, text\)/, 'stored session message keeps quote context in normal content')
assert.match(chat, /const userMsg: StoredMessage = \{[\s\S]*?content: messageText,[\s\S]*?ts: Date\.now\(\)/, 'normal send persists quoted content')
assert.match(chat, /handleBusySend\(messageText\)/, 'busy send preserves the same quoted content')
assert.match(chat, /const handleBusySend = \(text: string\)[\s\S]*?const userMsg: StoredMessage = \{[\s\S]*?content: text,[\s\S]*?ts: Date\.now\(\)/, 'busy helper remains scoped to its own argument')
assert.match(chat, /onQuote=\{handleQuoteMessage\}/, 'Chat wires quote action into bubbles')
assert.match(bubble, /copyVisibleText\(visibleCopyText\)/, 'copy uses cleaned visible text')
assert.match(bubble, /parseQuotedMessage\(message\.content\)/, 'quoted session content renders through stable parser')

console.log('message quote/actions contract: PASS')
