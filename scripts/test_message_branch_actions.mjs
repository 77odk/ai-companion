import assert from 'node:assert/strict'
import fs from 'node:fs'

const chat = fs.readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
const bubble = fs.readFileSync(new URL('../src/components/MessageBubble.tsx', import.meta.url), 'utf8')
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

console.log('[message branch actions] recoverable delete / rollback wiring')

assert.match(bubble, /onDelete\?: \(\) => void/, 'MessageBubble exposes delete only through callback')
assert.match(bubble, /onRollback\?: \(\) => void/, 'MessageBubble exposes rollback only through callback')
assert.match(bubble, /'回溯'/, 'Chinese rollback action uses the short label')
assert.match(bubble, /message-action-danger/, 'delete is visually distinguished')
assert.match(bubble, /document\.addEventListener\('pointerdown'/, 'message action menu closes on outside pointerdown')
assert.match(bubble, /document\.addEventListener\('keydown'/, 'message action menu closes on Escape')
assert.match(bubble, /setActionsOpen\(false\)[\s\S]*copyVisibleText/, 'copy closes the menu before reporting result')
assert.match(bubble, /message-copy-toast/, 'copy result has a short visible status')
assert.match(app, /!\(view === 'settings' && settingsPrivacyOpen\)/, 'settings child-page nav visibility is controlled by App')

assert.match(
  chat,
  /const commitConversationBranchAction = \(message: StoredMessage, reason: 'delete' \| 'rollback'\)/,
  'Chat owns branch mutation semantics',
)
assert.match(chat, /forkConversation\(conversationState, activeSessionId, messages, \{/, 'actions fork from raw history + current state')
assert.match(chat, /hideMessageIds: \[message\.id\]/, 'delete hides only the selected stable message in the new branch')
assert.match(chat, /reason === 'rollback' \? message\.id/, 'rollback forks exactly after the selected message')
assert.match(chat, /saveConversationState\(next\)/, 'new active branch is persisted and cloud-synced')
assert.match(chat, /activateConversationBranch\(current, branchActionNotice\.previousBranchId\)/, 'undo restores the previous branch')
assert.match(chat, /clearContextBridge\(sessionId\)/, 'branch mutation invalidates old bridge context')
assert.match(chat, /setContextCompactAt\(0, sessionId\)/, 'branch mutation invalidates old compact context')
assert.match(chat, /clearContextUsage\(sessionId, false\)/, 'branch mutation invalidates old context meter')
assert.match(chat, /const contextBoundary = Math\.max\(sessionStart, conversationBranchBoundary\)/, 'context validity includes the active branch boundary')
assert.match(chat, /compactedAt >= contextBoundary/, 'old compact summary cannot cross a branch boundary')
assert.match(chat, /stored\.bridgedAt >= contextBoundary/, 'old bridge cannot cross a branch boundary')
assert.match(chat, /stored\.updatedAt >= contextBoundary/, 'old context meter cannot cross a branch boundary')
assert.match(
  app,
  /const ensureStartupConversationReady = useCallback\(async \(sessionId: string\): Promise<boolean> => \{[\s\S]*?await hydrateCloudState\(\)[\s\S]*?if \(loadConversationState\(sessionId\)\) return true[\s\S]*?setStartupHydrationFailed\(true\)[\s\S]*?return false/,
  'all existing-session startup writes share one authoritative Cloud State readiness gate',
)
assert.match(
  app,
  /if \(active\) \{[\s\S]*?if \(!await ensureStartupConversationReady\(activeId\)\) return[\s\S]*?setActiveSessionId\(activeId\)/,
  'normal cloud-session restore waits for the readiness gate before becoming writable',
)
assert.match(
  app,
  /else if \(getActiveSessionId\(\)\) \{[\s\S]*?const fallbackSessionId = getActiveSessionId\(\)[\s\S]*?if \(!await ensureStartupConversationReady\(fallbackSessionId\)\) return[\s\S]*?replaceView\('chat'\)/,
  'offline/session-list fallback cannot bypass startup conversation hydration',
)

assert.match(
  chat,
  /onDelete=\{!streaming && !contextBusy && typeof m\.id === 'number'/,
  'delete is unavailable for optimistic messages or while generation/context jobs run',
)
assert.match(
  chat,
  /onRollback=\{!streaming && !contextBusy && typeof m\.id === 'number'/,
  'rollback is unavailable for optimistic messages or while generation/context jobs run',
)

// The feature must never mutate the raw transcript as its delete/rollback mechanism.
const actionSection = chat.slice(
  chat.indexOf('const invalidateDerivedContextForBranchChange'),
  chat.indexOf('const handleQuoteMessage'),
)
assert.doesNotMatch(actionSection, /setMessages\(|saveMessagesCache\(|\.splice\(/, 'delete/rollback never rewrite raw message history')

console.log('message branch actions contract: PASS')
