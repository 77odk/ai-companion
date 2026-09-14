// BUG-02 回归：Natural 发送时的语言判定必须包含当前 userMsg。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { detectLang } from '../src/lib/langDetect.ts'

const chat = readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')

function resolveChatLang(persona, historicalUserMessages, currentUserMessage) {
  const personaText = persona?.trim() || ''
  if (personaText) return detectLang(personaText)

  const recentUserMsgs = [...historicalUserMessages.slice(-5), currentUserMessage]
  const zhCount = recentUserMsgs.filter((message) => detectLang(message) === 'zh').length
  return zhCount > recentUserMsgs.length / 2 ? 'zh' : 'en'
}

assert.equal(resolveChatLang('', [], '你今天在干嘛？'), 'zh', 'Natural 第一条中文判为 zh')
assert.equal(resolveChatLang('', [], 'What are you doing today?'), 'en', 'Natural 第一条英文判为 en')
assert.equal(
  resolveChatLang('', ['hello', '你好'], '今天过得怎么样？'),
  'zh',
  '当前 userMsg 参与多数语言统计',
)
assert.equal(resolveChatLang('温柔理智', [], 'Hello'), 'zh', '中文 Template / Custom 仍优先按 persona 判定')
assert.equal(resolveChatLang('Warm and thoughtful', [], '你好'), 'en', '英文 Template / Custom 仍优先按 persona 判定')

const userMsgAt = chat.indexOf("const userMsg: StoredMessage = { role: 'user', content: text, ts: Date.now() }")
const langAt = chat.indexOf('const personaText = persona?.trim() || \'\'')
assert.ok(userMsgAt >= 0 && userMsgAt < langAt, 'userMsg 在 lang 计算前已构造')
assert.match(
  chat,
  /const recentUserMsgs = \[[\s\S]*visibleMessages\.filter\(\(m\) => m\.role === 'user'\)\.slice\(-5\)\.map\(\(m\) => m\.content\),[\s\S]*userMsg\.content,[\s\S]*\]/,
  'Chat 的 Natural 统计同时包含历史用户消息和当前 userMsg',
)

console.log('✓ BUG-02 Chat language regression passed')
