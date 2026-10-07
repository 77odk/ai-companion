import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  captureLatestTaCommitment,
  detectTaCommitment,
  detectTaCommitments,
  saveTaCommitment,
  collectDueTaCommitments,
  collectAllTaCommitments,
  markCommitmentReminded,
  removeTaCommitmentsForSession,
} from '../src/lib/commitmentStore.ts'
import { saveMessagesCache } from '../src/lib/sessionStore.ts'
import {
  appendMemoryAudit,
  loadMemoryAudit,
} from '../src/lib/memoryAudit.ts'

const app = readFileSync('src/App.tsx', 'utf8')
const aiSpace = readFileSync('src/components/AISpace.tsx', 'utf8')
const memory = readFileSync('src/components/Memory.tsx', 'utf8')
const bubble = readFileSync('src/components/MessageBubble.tsx', 'utf8')
const chat = readFileSync('src/components/Chat.tsx', 'utf8')
const memoryCss = readFileSync('src/styles/memory.css', 'utf8')
const spaceCss = readFileSync('src/styles/space.css', 'utf8')
const cloudResources = readFileSync('src/lib/cloudStateResources.ts', 'utf8')
const memoryLib = readFileSync('src/lib/memory.ts', 'utf8')
const commitmentSource = readFileSync('src/lib/commitmentStore.ts', 'utf8')
const memoryPaper = readFileSync('src/lib/memoryPaper.ts', 'utf8')
const starJar = readFileSync('src/components/StarJar.tsx', 'utf8')
const aboutMe = readFileSync('src/components/AboutMe.tsx', 'utf8')
const rolesPage = readFileSync('src/components/RolesPage.tsx', 'utf8')

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
assert.match(memory, /STATUS/)
assert.match(memory, /MEMORY RIVER/)
assert.match(memory, /<EventArchive sessionId=\{sessionId \|\| undefined\} \/>/)
assert.doesNotMatch(aiSpace, /space-scene-hotspot is-moments/)
assert.doesNotMatch(aiSpace, /<EventArchive/)
assert.doesNotMatch(memory.slice(memory.indexOf('// ---- 朝暮')), /memory-book-portal/)
assert.match(app, />\s*记忆\s*<\/button>/, 'bottom nav label stays unchanged until separately decided')
assert.match(memory, /type="search"/)
assert.match(memoryCss, /memory-search/)
assert.match(memoryCss, /memory-audit-panel/)
assert.doesNotMatch(memory, /memory-book-entry/, 'retired Memory Book must not remain user-reachable from 朝暮')
assert.doesNotMatch(memory, /setView\('book'\)/, 'retired Memory Book must not have a live entry action')
assert.doesNotMatch(memoryLib, /triggerWords\??:|moodSnapshot\??:/, 'MemoryItem schema stays frozen')

console.log('[S3] 星星纸条在写入时一次生成，记录当时 TA 心情；旧记忆只补正文不编心情')
assert.match(memoryPaper, /const SIDECAR = 'memory_paper_v1'/)
assert.match(memoryPaper, /captureMemoryPaperMood/)
assert.match(memoryPaper, /只改写已有事实，绝不补共同经历、原因、地点、时间或感受/)
assert.match(memoryPaper, /preserveExistingMood/)
assert.match(memoryPaper, /backfillMemoryPapers/)
assert.match(memoryPaper, /generateMemoryPaper\(sid, target, \{ preserveExistingMood: true \}\)/)
assert.match(cloudResources, /initMemoryPaperCloudSync\(\)/)
assert.match(chat, /captureMemoryPaperMood/)
assert.match(chat, /generateMemoryPaper/)
assert.match(chat, /refreshMemoryPaperAfterCorrection/)
assert.match(aboutMe, /deleteMemoryPapersForMemory\('global', id\)/)
assert.match(memory, /deleteMemoryPapersForMemory/)
assert.match(starJar, /phase === 'paper'[^]*setPhase\('detail'\)/)
assert.match(starJar, /当时我的心情/)
assert.match(starJar, /旧记忆还没有补写成纸条/)
assert.match(starJar, /调用你自己的模型 Key/)
assert.match(starJar, /心情会保持空白，绝不补编/)

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

const englishPromise = detectTaCommitment("I'll remind you tomorrow at 8.", '7', sourceTs, 50)
assert.ok(englishPromise, 'English chat mode must archive SELF commitments')
assert.equal(new Date(englishPromise.dueAt).getHours(), 8)

const scopedPromise = detectTaCommitment('你明天早上8点考试，后天我会提醒你复盘。', '7', sourceTs, 51)
assert.ok(scopedPromise)
const dayAfterTomorrow = new Date(sourceTs)
dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2)
assert.equal(scopedPromise.dueDay, [
  dayAfterTomorrow.getFullYear(),
  String(dayAfterTomorrow.getMonth() + 1).padStart(2, '0'),
  String(dayAfterTomorrow.getDate()).padStart(2, '0'),
].join('-'), '承诺只能使用自己的时间子句，不能借前文用户事件的时间')
assert.equal(scopedPromise.dueAt, undefined, '承诺子句没有钟点时不能借用前一子句的 8 点')

const multiplePromises = detectTaCommitments(
  '我明天8点提醒你喝水。后天晚上9点我会告诉你结果。',
  '7',
  sourceTs,
  52,
)
assert.equal(multiplePromises.length, 2, '同一回复里的多个承诺必须分别建档')
assert.notEqual(multiplePromises[0].id, multiplePromises[1].id)
assert.notEqual(multiplePromises[0].dueDay, multiplePromises[1].dueDay)

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

store.clear()
login()
assert.equal(saveTaCommitment({ ...promise, id: 'role-7-promise', sessionId: '7' }), true)
assert.equal(saveTaCommitment({ ...promise, id: 'role-8-promise', sessionId: '8' }), true)
assert.equal(removeTaCommitmentsForSession('7'), 1)
assert.deepEqual(collectAllTaCommitments().map((item) => item.sessionId), ['8'])
assert.match(rolesPage, /removeTaCommitmentsForSession\(id\)/)

assert.match(cloudResources, /registerCloudStateAdapter\('ta_commitment'/)
assert.match(cloudResources, /resetCommitmentSnapshot\(\)[\s\S]{0,100}notifyDataChanged\(\)/)
assert.match(commitmentSource, /message\.replyState !== 'interrupted'/)
assert.match(app, /nextTaCommitmentCheckAt/)
assert.match(app, /const onDataChange = \(\) => \{[\s\S]{0,220}checkDueCommitment\(\)[\s\S]{0,220}armDueTimer\(\)/)
assert.match(app, /setTimeout\(\(\) => \{[\s\S]*checkDueCommitment\(\)/)
assert.match(chat, /window\.dispatchEvent\(new CustomEvent\('yiwem:ai-reply-committed'/)

console.log('[S3] 隐私边界：状态页只读取现有可信展示文本，不写底层数值到 UI')
assert.match(memory, /runtimeDisplayLabel/)
assert.doesNotMatch(memory, /valence|arousal|attachment|moodScore|stateScore/)
assert.match(memoryCss, /S3 · 朝暮/)

console.log('[Space S3] 星星罐 / 朝暮 / 手动存记忆 / 审计回退 / 关键词激活 / 承诺建档 全通过')
