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

const chat = fs.readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8') + '\n' + fs.readFileSync(new URL('../src/lib/chatStreamEngine.ts', import.meta.url), 'utf8')
const chatAll = chat + '\n' + fs.readFileSync(new URL('../src/lib/chatContextBuild.ts', import.meta.url), 'utf8')
const bubble = fs.readFileSync(new URL('../src/components/MessageBubble.tsx', import.meta.url), 'utf8')
// C 级拆分第 1 刀：三条状态提示条（含撤销按钮）已搬到 ChatNotices.tsx，断言随之改读新文件（契约不变）。
const notices = fs.readFileSync(new URL('../src/components/ChatNotices.tsx', import.meta.url), 'utf8')

console.log('[message regenerate] one reply pipeline, no duplicate user side effects')
assert.match(chatAll, /existingRound\?: \{[\s\S]*userMessage: StoredMessage[\s\S]*visibleHistory: StoredMessage\[\][\s\S]*branchId: string/)
assert.match(chatAll, /const replayExistingUser = Boolean\(existingRound\)/)
assert.match(chatAll, /const rawWithUser = replayExistingUser[\s\S]*setReplyLifecycle\(messages, userMsg\.ts, null, 'pending'\)[\s\S]*: \[\.\.\.messages, userMsg\]/)
assert.match(chatAll, /if \(roundSessionId\) \{[\s\S]*persistMessages\(roundSessionId, rawWithUser\)[\s\S]*if \(!replayExistingUser\) \{[\s\S]*void uploadMessage\(roundSessionId, userMsg,/)
assert.match(chatAll,
  /if \(!replayExistingUser\) \{[\s\S]*?recordChatTopic\([\s\S]*?roundBranchId \?\? conversationState\?\.activeBranchId \?\? 'root'[\s\S]*?\)[\s\S]*?\}/,
)
assert.match(chatAll, /if \(!replayExistingUser\) \{[\s\S]*processEventCandidate\(/)
assert.match(chatAll, /const flushMemoryWrites = \(rawText: string\) => \{[\s\S]*if \(replayExistingUser\) return false/)
assert.match(chatAll, /spacePairEligibleRef\.current = !replayExistingUser/)
assert.match(chatAll, /const correctionIntent = !replayExistingUser/)
assert.match(chatAll, /const explicitCorrectionProposal = replayExistingUser \? null : extractMemoryCorrectionProposal\(raw\)/)

console.log('[message regenerate] branch-specific runtime + retry')
assert.match(chatAll, /const branchFinal = roundBranchId/)
assert.match(chatAll, /dropRepeatedReplies\(hygienicParts, roundVisibleMessages\)/)
assert.match(chatAll, /loadConversationState\(activeSessionId\)\?\.activeBranchId === roundBranchId/)
assert.match(chatAll, /enterBusyRef\.current\(roundSessionId, [^\n]+roundVisibleMessages\)/)

console.log('[message regenerate] regenerate and edit share one existing-user reply entry')
assert.match(chatAll, /const replyFromExistingUserBranch = \(/)
assert.match(chatAll, /const commitConversationRegenerate = \(assistant: StoredMessage\) =>/)
assert.match(chatAll, /reason: 'regenerate'/)
assert.match(chatAll, /send\(body, parsed\.quote, \{[\s\S]*userMessage: branchUser,[\s\S]*visibleHistory: branchVisibleMessages,[\s\S]*branchId: next\.activeBranchId/)
assert.match(chatAll, /commitConversationEdit[\s\S]*replyFromExistingUserBranch\(/)

console.log('[message regenerate] UI action is assistant-only')
assert.match(bubble, /onRegenerate\?: \(\) => void/)
assert.match(bubble, /const regenerateLabel = sessionLang === 'en' \? 'Regenerate' : '重新生成'/)
assert.match(bubble, /!isUser && onRegenerate/)
assert.match(chatAll, /onRegenerate=\{!streaming && !contextBusy && !isBusy && regenerationSourceUser\(m\)/)
assert.match(notices, /disabled=\{streaming\}>\{lang === 'en' \? 'Undo' : '撤销'\}/)

console.log('message regenerate contract: PASS')
