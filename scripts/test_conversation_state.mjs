import assert from 'node:assert/strict'
import {
  activateConversationBranch,
  appendMessageToActiveBranch,
  createConversationState,
  forkConversation,
  getActiveConversationBranchCreatedAt,
  mergeConversationStates,
  normalizeConversationState,
  resolveConversationMessages,
} from '../src/lib/conversationState.ts'

const raw = [
  { id: 1, role: 'user', content: '一', ts: 100 },
  { id: 2, role: 'assistant', content: '二', ts: 200 },
  { id: 3, role: 'user', content: '三', ts: 300 },
  { id: 4, role: 'assistant', content: '四', ts: 400 },
]

console.log('[conversation state] root is the immutable backend transcript')
assert.deepEqual(resolveConversationMessages(null, raw).map(m => m.id), [1, 2, 3, 4])

console.log('[conversation state] edit forks at the edited user message and drops the old suffix')
const edited = forkConversation(null, 's1', raw, {
  forkAfterMessageId: 3,
  contentOverrides: { 3: '三（改）' },
  reason: 'edit',
  now: 1000,
})
assert.deepEqual(resolveConversationMessages(edited, raw).map(m => [m.id, m.content]), [
  [1, '一'], [2, '二'], [3, '三（改）'],
])
assert.equal(raw[2].content, '三', 'raw backend transcript stays immutable')

const optimisticOnBranch = [
  ...raw,
  { role: 'assistant', content: '还没拿到 server id', ts: 450, conversationBranchId: edited.activeBranchId },
]
assert.deepEqual(
  resolveConversationMessages(edited, optimisticOnBranch).map(m => m.content),
  ['一', '二', '三（改）', '还没拿到 server id'],
  'branch-tagged optimistic message is visible before server id reconciliation',
)

console.log('[conversation state] new reply belongs only to the active branch')
const rawWithNew = [...raw, { id: 5, role: 'assistant', content: '新四', ts: 500 }]
const editedWithReply = appendMessageToActiveBranch(edited, 's1', rawWithNew, 5, 1100)
assert.ok(editedWithReply)
assert.deepEqual(resolveConversationMessages(editedWithReply, rawWithNew).map(m => m.id), [1, 2, 3, 5])

const oldBranchId = edited.branches[edited.activeBranchId].parentBranchId
assert.equal(oldBranchId, 'root')
const restoredRoot = { ...editedWithReply, activeBranchId: 'root' }
assert.deepEqual(resolveConversationMessages(restoredRoot, rawWithNew).map(m => m.id), [1, 2, 3, 4],
  'old branch remains recoverable and does not absorb branch-only replies')

console.log('[conversation state] delete hides only one message while keeping the later transcript')
const deleted = forkConversation(null, 's2', raw, {
  forkAfterMessageId: 4,
  hideMessageIds: [2],
  reason: 'delete',
  now: 2000,
})
assert.deepEqual(resolveConversationMessages(deleted, raw).map(m => m.id), [1, 3, 4])
assert.equal(getActiveConversationBranchCreatedAt(deleted), 2000, 'branch boundary is the mutation time')
const deleteParent = deleted.branches[deleted.activeBranchId].parentBranchId
assert.ok(deleteParent)
const deleteUndone = activateConversationBranch(deleted, deleteParent, 2100)
assert.deepEqual(resolveConversationMessages(deleteUndone, raw).map(m => m.id), [1, 2, 3, 4], 'undo switches back without rebuilding raw history')

console.log('[conversation state] rollback keeps the prefix and archives the suffix')
const rolledBack = forkConversation(null, 's3', raw, {
  forkAfterMessageId: 2,
  reason: 'rollback',
  now: 3000,
})
assert.deepEqual(resolveConversationMessages(rolledBack, raw).map(m => m.id), [1, 2])
assert.deepEqual(resolveConversationMessages({ ...rolledBack, activeBranchId: 'root' }, raw).map(m => m.id), [1, 2, 3, 4])

console.log('[conversation state] regenerate is a fork after the preceding user message')
const regenerate = forkConversation(null, 's4', raw, {
  forkAfterMessageId: 1,
  reason: 'regenerate',
  now: 4000,
})
const rawRegenerated = [...raw, { id: 6, role: 'assistant', content: '二（重生）', ts: 600 }]
const regenerateWithReply = appendMessageToActiveBranch(regenerate, 's4', rawRegenerated, 6, 4100)
assert.deepEqual(resolveConversationMessages(regenerateWithReply, rawRegenerated).map(m => m.id), [1, 6])

console.log('[conversation state] continuing from a sealed branch creates a child instead of mutating history')
const secondFork = forkConversation(editedWithReply, 's1', rawWithNew, {
  forkAfterMessageId: 3,
  reason: 'rollback',
  now: 5000,
})
const rawContinued = [...rawWithNew, { id: 7, role: 'assistant', content: '另一条', ts: 700 }]
const continued = appendMessageToActiveBranch(secondFork, 's1', rawContinued, 7, 5100)
assert.ok(continued)
assert.notEqual(continued.activeBranchId, editedWithReply.activeBranchId)
assert.deepEqual(resolveConversationMessages(continued, rawContinued).map(m => m.id), [1, 2, 3, 7])

console.log('[conversation state] multi-device merge keeps distinct branches instead of choosing one history')
const left = forkConversation(null, 's5', raw, {
  forkAfterMessageId: 2,
  reason: 'rollback',
  now: 6000,
})
const right = forkConversation(null, 's5', raw, {
  forkAfterMessageId: 3,
  contentOverrides: { 3: '三（另一设备改）' },
  reason: 'edit',
  now: 7000,
})
const merged = mergeConversationStates(left, right)
assert.ok(Object.keys(merged.branches).length >= 3)
assert.equal(merged.activeBranchId, right.activeBranchId, 'latest head wins while the other branch remains recoverable')
assert.ok(merged.branches[left.activeBranchId])
assert.ok(merged.branches[right.activeBranchId])

console.log('[conversation state] invalid payloads are rejected')
const blank = createConversationState('safe', 8000)
assert.deepEqual(normalizeConversationState(blank, 'safe'), blank)
assert.equal(normalizeConversationState({ ...blank, sessionId: 'other' }, 'safe'), null)

console.log('conversation branch state: PASS')
