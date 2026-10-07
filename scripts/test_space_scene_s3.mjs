import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  captureLatestTaCommitment,
  detectTaCommitment,
  saveTaCommitment,
  collectDueTaCommitments,
  markCommitmentReminded,
} from '../src/lib/commitmentStore.ts'
import { saveMessagesCache } from '../src/lib/sessionStore.ts'
import {
  appendMemoryAudit,
  loadMemoryAudit,
} from '../src/lib/memoryAudit.ts'

const app = readFileSync('src/App.tsx', 'utf8')
const aiSpace = readFileSync('src/components/AISpace.tsx', 'utf8')
const memory = readFileSync('src/components/Memory.tsx', 'utf8')
const chaomuState = readFileSync('src/components/ChaomuState.tsx', 'utf8')
const taState = readFileSync('src/lib/taState.ts', 'utf8')
const bubble = readFileSync('src/components/MessageBubble.tsx', 'utf8')
const chat = readFileSync('src/components/Chat.tsx', 'utf8')
const memoryCss = readFileSync('src/styles/memory.css', 'utf8')
const spaceCss = readFileSync('src/styles/space.css', 'utf8')
const cloudResources = readFileSync('src/lib/cloudStateResources.ts', 'utf8')
const memoryLib = readFileSync('src/lib/memory.ts', 'utf8')
const commitmentSource = readFileSync('src/lib/commitmentStore.ts', 'utf8')

const store = new Map()
globalThis.localStorage = {
  getItem: (key) => store.has(key) ? store.get(key) : null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  key: (index) => [...store.keys()][index] ?? null,
  get length() { return store.size },
}
globalThis.window = { dispatchEvent: () => {} }

function login(account = 'a@example.com') {
  store.set('ai_companion_account', JSON.stringify({ token: 'token-' + account, account }))
}
login()

console.log('[S3] 星星罐从空间页独立进入，不再把物件直接送进朝暮')
assert.match(aiSpace, /onOpenStarJar/)
assert.match(aiSpace, /onClick=\{onOpenStarJar\}/)
assert.match(app, /view === 'starjar'/)
assert.match(app, /<StarJar onBack=/)
assert.match(spaceCss, /S3 · Star Jar/)
assert.match(spaceCss, /star-paper-open/)
assert.match(spaceCss, /steps\(6, end\)/)

console.log('[S3] 朝暮只以状态 / 记忆长河 / 一起经历过为根层级')
assert.match(memory, /className="memory-title">朝暮</)
assert.match(memory, /<ChaomuState dashboard=\{stateDashboard\} \/>/)
assert.match(memory, /MEMORY RIVER/)
assert.match(memory, /<EventArchive sessionId=\{sessionId \|\| undefined\} \/>/)
assert.doesNotMatch(aiSpace, /space-scene-hotspot is-moments/)
assert.doesNotMatch(aiSpace, /<EventArchive/)
assert.doesNotMatch(memory.slice(memory.indexOf('// ---- 朝暮')), /memory-book-portal/)
assert.match(app, />\s*记忆\s*<\/button>/, 'bottom nav label stays unchanged until separately decided')
assert.match(memory, /type="search"/)
assert.match(memoryCss, /memory-search/)
assert.match(memoryCss, /memory-audit-panel/)
assert.doesNotMatch(memoryLib, /triggerWords\??:|moodSnapshot\??:/, 'MemoryItem schema stays frozen')

console.log('[S3] 消息可手动存为记忆，写入链仍复用现有 memories API')
assert.match(bubble, /Save to memory|存为记忆/)
assert.match(chat, /handleSaveMessageAsMemory/)
assert.match(chat, /messageEvidenceText\(String\(text/)
assert.match(chat, /m\.role === 'user'[\s\S]*handleSaveMessageAsMemory\(m\.content\)/)
assert.match(chat, /postMemory\(token, sid/)
assert.match(chat, /appendMemoryAudit/)
assert.match(memoryLib, /deriveMemoryTriggerWords/)

console.log('[S3] 记忆编辑/删除留痕并可回退')
store.clear()
login()
const before = { id: 'm1', text: '旧版本', createdAt: 1 }
const audit = appendMemoryAudit({
  sessionId: '7',
  memoryKind: 'session',
  memoryId: 'm1',
  action: 'edit',
  before,
  after: { ...before, text: '新版本' },
  source: 'detail',
})
assert.ok(audit)
assert.equal(loadMemoryAudit('7')[0]?.before?.text, '旧版本')
login('b@example.com')
assert.equal(loadMemoryAudit('7').length, 0, '账号 B 不得读到账号 A 的审计')
login('a@example.com')
assert.equal(loadMemoryAudit('7')[0]?.before?.text, '旧版本', '切回账号 A 后只看到 A 自己的审计')
assert.match(memory, /rollbackAuditEntry/)
assert.match(memory, /回退到之前/)
assert.match(memory, /parentAuditId/)
assert.match(cloudResources, /registerCloudStateAdapter\('memory_audit'/)

console.log('[S3] TA 承诺单独建档；只有真实承诺才进入，明确到点时可生成 dueAt')
store.clear()
login()
const sourceTs = new Date(2026, 9, 7, 10, 0).getTime()
const promise = detectTaCommitment('我答应你明天晚上8点提醒你喝水。', '7', sourceTs, 42)
assert.ok(promise)
assert.equal(promise.sessionId, '7')
assert.ok(typeof promise.dueAt === 'number')
const genericPromise = detectTaCommitment('我明天晚上8点会提醒你喝水。', '7', sourceTs, 43)
assert.ok(genericPromise)
assert.ok(typeof genericPromise.dueAt === 'number')
assert.equal(detectTaCommitment('今天天气不错。', '7', sourceTs, 44), null)
assert.equal(detectTaCommitment('我觉得你明天会好一点。', '7', sourceTs, 45), null, 'TA 对用户的预测不能误当承诺')
assert.equal(detectTaCommitment('我明天不能提醒你喝水。', '7', sourceTs, 46), null, '否定的 SELF 行为不能误当承诺')
assert.equal(detectTaCommitment('我明天不会陪你去医院。', '7', sourceTs, 47), null, '不会做的事不能反转成承诺')
assert.equal(detectTaCommitment('我觉得他明天会告诉你结果。', '7', sourceTs, 48), null, '第三方 actor 不能误当 SELF 承诺')
assert.ok(detectTaCommitment('我答应你明天早点休息。', '7', sourceTs, 49), '明确“我答应你”即使不是提醒类动词也应建档')

const batchTs = sourceTs + 1234
saveMessagesCache('7', [
  { role: 'assistant', content: '我明天晚上8点提醒你喝水。', ts: batchTs, replyState: 'complete' },
  { role: 'assistant', content: '晚安。', ts: batchTs, replyState: 'complete' },
])
const batchedPromise = captureLatestTaCommitment('7')
assert.ok(batchedPromise, '同一轮多 assistant bubble 必须整批检查承诺')
assert.match(batchedPromise?.text ?? '', /提醒你喝水/)


const due = { ...promise, dueAt: sourceTs - 1, createdAt: sourceTs - 1000 }
assert.equal(saveTaCommitment(due), true)
assert.equal(collectDueTaCommitments(sourceTs).length, 1)
login('b@example.com')
assert.equal(collectDueTaCommitments(sourceTs).length, 0, '账号 B 不得看到账号 A 的承诺')
login('a@example.com')
assert.equal(collectDueTaCommitments(sourceTs).length, 1)
assert.ok(markCommitmentReminded(due.id, sourceTs))
assert.equal(collectDueTaCommitments(sourceTs).length, 0)
assert.match(cloudResources, /registerCloudStateAdapter\('ta_commitment'/)
assert.match(cloudResources, /resetCommitmentSnapshot\(\)[\s\S]{0,100}notifyDataChanged\(\)/)
assert.match(commitmentSource, /message\.replyState !== 'interrupted'/)
assert.match(app, /nextTaCommitmentCheckAt/)
assert.match(app, /const onDataChange = \(\) => \{[\s\S]{0,220}checkDueCommitment\(\)[\s\S]{0,220}armDueTimer\(\)/)
assert.match(app, /setTimeout\(\(\) => \{[\s\S]*checkDueCommitment\(\)/)
assert.match(chat, /window\.dispatchEvent\(new CustomEvent\('yiwem:ai-reply-committed'/)

console.log('[S3] 朝暮状态由同一份真实 2 轴 + 7 倾向数据驱动，不造装饰数值')
assert.match(memory, /getTaStateDashboard/)
assert.match(chaomuState, /dashboard\.score/)
for (const key of ['relaxedTense','quietActive','connection','expression','exploration','involvement','reminiscence','space','energy']) {
  assert.match(chaomuState + taState, new RegExp('\\\\b' + key + '\\\\b'))
}
assert.match(taState, /function stateScore/)
assert.match(taState, /history\?: TaStateHistoryPoint\[\]/)
assert.match(chaomuState, /dashboard\.history/)
assert.match(chaomuState, /pulsePath\(dashboard\.score\)/)
assert.doesNotMatch(chaomuState, /Math\.random/)
assert.match(memoryCss, /S3 · 朝暮/)

console.log('[Space S3] 星星罐 / 朝暮 / 手动存记忆 / 审计回退 / 关键词激活 / 承诺建档 全通过')
