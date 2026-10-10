import assert from 'node:assert/strict'
import fs from 'node:fs'

const chat = fs.readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8') + '\n' + fs.readFileSync(new URL('../src/lib/useChatScroll.ts', import.meta.url), 'utf8') + '\n' + fs.readFileSync(new URL('../src/lib/chatStreamEngine.ts', import.meta.url), 'utf8') + '\n' + fs.readFileSync(new URL('../src/lib/useChatMessages.ts', import.meta.url), 'utf8')

console.log('[chat round owner] async replies stay bound to the session that started the round')

assert.match(
  chat,
  /const persistMessages = useCallback\(\(sid: string \| null, msgs: StoredMessage\[\]\) =>/,
  'message persistence requires an explicit session owner',
)
assert.match(
  chat,
  /const uploadMessage = useCallback\(\([\s\S]*sid: string \| null,[\s\S]*msg: StoredMessage,/ ,
  'message upload requires an explicit session owner',
)
assert.match(
  chat,
  /const roundSessionId = activeSessionId \|\| null/,
  'each send captures its session owner once',
)
assert.match(
  chat,
  /persistMessages\(roundSessionId, rawWithUser\)/,
  'the user turn is persisted to the captured session',
)

const commitStart = chat.indexOf('const commitFinal = (final: StoredMessage[]) =>')
const commitEnd = commitStart >= 0 ? chat.indexOf('const finalize = () =>', commitStart) : -1
assert.ok(commitStart >= 0 && commitEnd > commitStart, 'commitFinal block exists')
const commit = chat.slice(commitStart, commitEnd)
assert.match(commit, /persistMessages\(roundSessionId, branchFinal\)/, 'final reply persists to the captured session')
assert.match(commit, /const sid = roundSessionId/, 'final upload/broadcast owner is the captured session')
assert.match(commit, /uploadMessage\(roundSessionId, m\)/, 'assistant uploads to the captured session')
assert.match(commit, /syncTaRuntimeFromAssistantText\(roundSessionId \|\| undefined/, 'TA runtime update stays on the captured session')
assert.match(commit, /detail: \{ sid: roundSessionId \}/, 'background completion notifies the captured session')
assert.doesNotMatch(commit, /const sid = getActiveSessionId\(\)/, 'final commit never rebinds data ownership to the UI current session')

assert.match(
  chat,
  /const partialSessionIdRef = useRef<string \| null>\(null\)/,
  'pagehide partial recovery stores the round session owner',
)
assert.match(
  chat,
  /const sid = partialSessionIdRef\.current/,
  'pagehide partial recovery uses the round owner instead of current UI session',
)
assert.match(
  chat,
  /enterBusyRef\.current\(roundSessionId,/,
  'busy transition inherits the same round owner',
)

console.log('chat round session owner: PASS')
