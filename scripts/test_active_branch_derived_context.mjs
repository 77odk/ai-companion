import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  filterChatTopicsForBranch,
  futureTopicsFromMessages,
  recordChatTopic,
  loadChatTopics,
} from '../src/lib/chatTopics.ts'
import {
  forkConversation,
  resolveConversationMessages,
} from '../src/lib/conversationState.ts'

class StorageMock {
  #values = new Map()
  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null }
  setItem(key, value) { this.#values.set(key, String(value)) }
  removeItem(key) { this.#values.delete(key) }
  clear() { this.#values.clear() }
}
globalThis.localStorage = new StorageMock()

const now = new Date(2026, 8, 9, 12, 0)
const raw = [
  { id: 1, role: 'user', content: '周五晚上我们去看那部片子吧', ts: now.getTime() },
  { id: 2, role: 'assistant', content: '好，到时候一起看。', ts: now.getTime() + 1000 },
  { id: 3, role: 'user', content: '后面这句撤回', ts: now.getTime() + 2000 },
  { id: 4, role: 'assistant', content: '旧后缀回复', ts: now.getTime() + 3000 },
]

console.log('[active derived context] FutureIntent follows active messages, not cached topics')
const activeIntent = futureTopicsFromMessages(raw)
assert.equal(activeIntent.length, 1)
assert.equal(activeIntent[0].futureDay, '2026-09-11')

const rolled = forkConversation(null, 's', raw, {
  forkAfterMessageId: 2,
  reason: 'rollback',
  now: now.getTime() + 5000,
})
const rolledMessages = resolveConversationMessages(rolled, raw)
assert.deepEqual(rolledMessages.map(message => message.id), [1, 2])
assert.equal(futureTopicsFromMessages(rolledMessages)[0]?.futureDay, '2026-09-11',
  'an agreement that remains before the rollback boundary remains active')

const edited = forkConversation(null, 's2', raw, {
  forkAfterMessageId: 1,
  contentOverrides: { 1: '今天只想休息' },
  reason: 'edit',
  now: now.getTime() + 6000,
})
const editedMessages = resolveConversationMessages(edited, raw)
assert.deepEqual(futureTopicsFromMessages(editedMessages), [],
  'editing the source user message removes the old FutureIntent without text guessing')

console.log('[active derived context] quoted prior text is not reasserted as a FutureIntent')
const quoted = [{
  id: 10,
  role: 'user',
  content: '> [TA] 周五一起去看电影吧\n\n我还没决定',
  ts: now.getTime(),
}]
assert.deepEqual(futureTopicsFromMessages(quoted), [])

console.log('[active derived context] Space topic cache is branch-scoped')
recordChatTopic('周五晚上我们去看那部片子吧', 'space-sid', now.getTime(), 'root')
recordChatTopic('明天我们去爬山吧', 'space-sid', now.getTime() + 1, 'branch-new')
const topics = loadChatTopics('space-sid')
assert.equal(filterChatTopicsForBranch(topics, 'root').length, 1)
assert.equal(filterChatTopicsForBranch(topics, 'branch-new').length, 1)
assert.ok(filterChatTopicsForBranch(topics, 'root')[0].t.includes('片子'))
assert.ok(filterChatTopicsForBranch(topics, 'branch-new')[0].t.includes('爬山'))

localStorage.setItem('ai_space_recent_topic_legacy', JSON.stringify([
  { t: '旧格式 root 素材', ts: now.getTime(), pairVersion: 1, taText: '旧回复', taTs: now.getTime() + 1 },
]))
assert.equal(filterChatTopicsForBranch(loadChatTopics('legacy'), 'root').length, 1,
  'legacy topic without branchId remains root-compatible')
assert.equal(filterChatTopicsForBranch(loadChatTopics('legacy'), 'branch-new').length, 0,
  'legacy root material never leaks into a forked branch')

console.log('[active derived context] runtime wiring uses active branch facts')
const chat = fs.readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8') + '\n' + fs.readFileSync(new URL('../src/lib/useChatScroll.ts', import.meta.url), 'utf8')
const chatAll = chat + '\n' + fs.readFileSync(new URL('../src/lib/chatContextBuild.ts', import.meta.url), 'utf8')
const space = fs.readFileSync(new URL('../src/lib/aiSpace.ts', import.meta.url), 'utf8')
const weekly = fs.readFileSync(new URL('../src/components/WeeklyPage.tsx', import.meta.url), 'utf8')

assert.match(chatAll, /buildFutureAgendaBlock\(futureTopicsFromMessages\(base\), new Date\(\), lang\)/)
assert.match(chatAll, /recordChatTopic\([\s\S]*roundBranchId \?\? conversationState\?\.activeBranchId \?\? 'root'/)

assert.match(space, /filterChatTopicsForBranch\(loadChatTopics\(sessionId\), conversationBranchId\)/)
assert.match(space, /conversationBranchStillActive = currentConversationBranchId === \(plan\.conversationBranchId \?\? 'root'\)/)
assert.match(space, /if \(source === 'conversation' && !conversationBranchStillActive\) continue/)

assert.match(weekly, /resolveConversationMessages\(loadConversationState\(currentSid\), rawMessages\)/)
assert.match(weekly, /const weekMsgs = activeMessages/)
assert.match(weekly, /futureTopicsFromMessages\(activeMessages\)/)
assert.doesNotMatch(weekly, /const weekMsgs = \(currentSid \? getMessagesCache/)

console.log('active branch derived context: PASS')
