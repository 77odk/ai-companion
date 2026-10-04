import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  forkConversation,
  resolveConversationMessages,
} from '../src/lib/conversationState.ts'

const raw = [
  { id: 1, role: 'user', content: '你好', ts: 100 },
  { id: 2, role: 'assistant', content: '旧回复', ts: 200 },
  { id: 3, role: 'user', content: '后续', ts: 300 },
  { id: 4, role: 'assistant', content: '后续回复', ts: 400 },
]

console.log('[message regenerate] old reply stays on old branch')
const regenerated = forkConversation(null, 'regen', raw, {
  forkAfterMessageId: 1,
  reason: 'regenerate',
  now: 1000,
})
assert.deepEqual(
  resolveConversationMessages(regenerated, raw).map(message => message.id),
  [1],
  'new regenerate branch inherits only through the source user message',
)
assert.deepEqual(
  resolveConversationMessages({ ...regenerated, activeBranchId: 'root' }, raw).map(message => message.id),
  [1, 2, 3, 4],
  'old assistant reply and suffix stay recoverable on the old branch',
)

console.log('[message regenerate] edited user is the source for the new reply')
const edited = forkConversation(null, 'edit-regen', raw, {
  forkAfterMessageId: 1,
  contentOverrides: { 1: '你好（改）' },
  reason: 'edit',
  now: 2000,
})
assert.deepEqual(
  resolveConversationMessages(edited, raw).map(message => [message.id, message.content]),
  [[1, '你好（改）']],
)

const chat = fs.readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
const bubble = fs.readFileSync(new URL('../src/components/MessageBubble.tsx', import.meta.url), 'utf8')

console.log('[message regenerate] one reply pipeline, no duplicate user side effects')
assert.match(chat, /existingRound\?: \{[\s\S]*userMessage: StoredMessage[\s\S]*visibleHistory: StoredMessage\[\][\s\S]*branchId: string/)
assert.match(chat, /const replayExistingUser = Boolean\(existingRound\)/)
assert.match(chat, /const rawWithUser = replayExistingUser[\s\S]*setReplyLifecycle\(messages, userMsg\.ts, null, 'pending'\)[\s\S]*: \[\.\.\.messages, userMsg\]/)
assert.match(chat, /if \(roundSessionId\) \{[\s\S]*persistMessages\(roundSessionId, rawWithUser\)[\s\S]*if \(!replayExistingUser\) uploadMessage\(roundSessionId, userMsg\)/)
assert.match(
  chat,
  /if \(!replayExistingUser\) \{[\s\S]*?recordChatTopic\([\s\S]*?roundBranchId \?\? conversationState\?\.activeBranchId \?\? 'root'[\s\S]*?\)[\s\S]*?\}/,
)
assert.match(chat, /if \(!replayExistingUser\) \{[\s\S]*processEventCandidate\(/)
assert.match(chat, /const flushMemoryWrites = \(rawText: string\) => \{[\s\S]*if \(replayExistingUser\) return false/)
assert.match(chat, /spacePairEligibleRef\.current = !replayExistingUser/)
assert.match(chat, /const correctionIntent = !replayExistingUser/)
assert.match(chat, /const explicitCorrectionProposal = replayExistingUser \? null : extractMemoryCorrectionProposal\(raw\)/)

console.log('[message regenerate] branch-specific runtime + retry')
assert.match(chat, /const branchFinal = roundBranchId/)
assert.match(chat, /dropRepeatedReplies\(hygienicParts, roundVisibleMessages\)/)
assert.match(chat, /loadConversationState\(activeSessionId\)\?\.activeBranchId === roundBranchId/)
assert.match(chat, /enterBusyRef\.current\(roundSessionId, [^\n]+roundVisibleMessages\)/)

console.log('[message regenerate] regenerate and edit share one existing-user reply entry')
assert.match(chat, /const replyFromExistingUserBranch = \(/)
assert.match(chat, /const commitConversationRegenerate = \(assistant: StoredMessage\) =>/)
assert.match(chat, /reason: 'regenerate'/)
assert.match(chat, /send\(body, parsed\.quote, \{[\s\S]*userMessage: branchUser,[\s\S]*visibleHistory: branchVisibleMessages,[\s\S]*branchId: next\.activeBranchId/)
assert.match(chat, /commitConversationEdit[\s\S]*replyFromExistingUserBranch\(/)

console.log('[message regenerate] UI action is assistant-only')
assert.match(bubble, /onRegenerate\?: \(\) => void/)
assert.match(bubble, /const regenerateLabel = sessionLang === 'en' \? 'Regenerate' : '重新生成'/)
assert.match(bubble, /!isUser && onRegenerate/)
assert.match(chat, /onRegenerate=\{!streaming && !contextBusy && !isBusy && regenerationSourceUser\(m\)/)
assert.match(chat, /disabled=\{streaming\}>\{chatUiLang === 'en' \? 'Undo' : '撤销'\}/)

console.log('message regenerate contract: PASS')
