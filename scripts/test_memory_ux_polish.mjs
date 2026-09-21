// Memory UX Polish 专项：看原对话返回详情（A 源码契约）+ 成功反馈统一（B 契约 + C 真实原语行为）
const ROOT = '/home/ubuntu/projects/ai-companion-mvp/frontend'
const fs = await import('node:fs')
const path = await import('node:path')
const B = 'file://' + ROOT + '/src/lib/'
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const store = new Map()
let mode = 'ok' // ok | throw
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => { if (mode === 'throw') throw new Error('QuotaExceededError'); store.set(k, String(v)) },
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}
globalThis.window = globalThis.window ?? { dispatchEvent: () => {}, addEventListener: () => {}, removeEventListener: () => {} }
globalThis.CustomEvent = globalThis.CustomEvent ?? class { constructor(t, o) { this.type = t; this.detail = o?.detail } }

const RES = []
const rec = (n, ok, extra = '') => { RES.push([n, ok]); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? `  [${extra}]` : '')) }

const app = read('src/App.tsx')
const memSrc = read('src/components/Memory.tsx')
const chat = read('src/components/Chat.tsx')
const bubble = read('src/components/MessageBubble.tsx')
const jumpLib = read('src/lib/chatJump.ts')
const memoryLib = read('src/lib/memory.ts')

console.log('--- 导航：看原对话 → 返回原 Detail ---')
rec('A1 return target 用稳定 identity（memoryId+kind+sessionId）',
  /interface MemoryReturnTarget\s*\{[^}]*memoryId: string[^}]*kind: 'global' \| 'session'[^}]*sessionId\?: string/s.test(jumpLib))
rec('A2 App 持有 transient pendingMemoryReturn（只 useState，不落存储）',
  /const \[pendingMemoryReturn, setPendingMemoryReturn\] = useState<MemoryReturnTarget \| null>\(null\)/.test(app))
rec('A3 只有跳转成功才记录 return target',
  /onJumpToChatLog=\{\(target, returnTarget\) => \{[\s\S]{0,240}setPendingMemoryReturn\(returnTarget \?\? null\)/.test(app))
rec('A4 Memory 接收 initialDetail / onInitialDetailConsumed',
  /initialDetail=\{pendingMemoryReturn\}/.test(app) &&
  /onInitialDetailConsumed=\{\(\) => \{[\s\S]{0,160}setPendingMemoryReturn\(null\)/.test(app))
rec('A5 返回时使用稳定 identity 在当前数据重新查（不靠 index）',
  memSrc.includes('const identity: MemorySelection = {') &&
  memSrc.includes('kind: initialDetail.kind') &&
  memSrc.includes('resolveMemoryIdAlias(initialDetail.sessionId ?? sessionId, String(initialDetail.memoryId))') &&
  memSrc.includes('matchesMemorySelection(entry, identity, sessionId)'))
rec('A6 找到才打开 Detail，找不到安全留在 River（不猜别的条目）',
  memSrc.includes('setSelectedIdentity(identity)') &&
  /if \(index >= 0\)[\s\S]{0,120}setView\('detail'\)/.test(memSrc))
rec('A7 无条件消费 target（找到/没找到都清）',
  /if \(index >= 0\)[\s\S]{0,160}\}\s*onInitialDetailConsumed\?\.\(\)/.test(memSrc))
rec('A8 跳转失败路径不碰 return target（onJumpToChatLog 只有一个调用点）',
  (memSrc.match(/onJumpToChatLog\(/g) || []).length === 1 && /ambiguous[\s\S]{0,420}showJumpNotice\('暂时无法定位原位置；当时保留的对话片段仍在这一页'\)/.test(memSrc))
rec('A9 连续查看不同 Memory：每次成功跳转覆盖 target',
  (app.match(/setPendingMemoryReturn\(returnTarget \?\? null\)/g) || []).length === 1)
rec('A10 return target 不进 localStorage / sync / backend / schema',
  !/localStorage\.setItem\([^)]{0,80}MemoryReturn/.test(app + memSrc) &&
  !/(pendingMemoryReturn|MemoryReturnTarget)[\s\S]{0,120}(postMessage|api\/sync|fetch\()/.test(app + memSrc))

console.log('--- 成功反馈：写入结果语义（契约） ---')
rec('B1 写入结果显式区分 ok / created',
  /interface MemoryWriteResult\s*\{\s*ok: boolean\s*created: boolean\s*\}/.test(memoryLib))
rec('B2 session 侧：命中已有 → ok:true created:false',
  /if \(isSimilarMemory\(getMemoriesCache\(activeSessionId\), trimmed\)\) return \{ ok: true, created: false \}/.test(chat))
rec('B3 session 侧：写失败 → ok:false created:false',
  /if \(!item\) return \{ ok: false, created: false \}/.test(chat))
rec('B4 session 侧：真实写入 → ok:true created:true',
  /notifyMemoryUpdated\(\)\s*return \{ ok: true, created: true \}/.test(chat))
rec('B5 global 侧：命中已有 → created:false；真多一条 → created:true',
  /if \(isSimilarMemory\(loadMemory\(\), trimmed\)\) return \{ ok: true, created: false \}/.test(chat) &&
  /afterGlobal\.length > beforeGlobal \? \{ ok: true, created: true \} : \{ ok: false, created: false \}/.test(chat))
rec('B6 反馈只看 created（不再要求 explicit）',
  /if \(res\.created\) created = true/.test(chat) && !/wrote && p\.explicit/.test(chat))
rec('B7 用户气泡标记只在真实新增时设置且为布尔（多条只一次）',
  /if \(created\) userMsg\.memorySaved = true/.test(chat))
rec('B8 TA「已记住」只绑定真实新增(memorySaved)，不依赖已被剥离的正文 marker',
  /const hasMemory = !isUser && message\.memorySaved === true/.test(bubble) &&
  !/message\.memorySaved === true && extractMemories\(message\.content\)/.test(bubble))

console.log('--- 行为：真实原语 ---')
const mem = await import(B + 'memory.ts')
const ss = await import(B + 'sessionStore.ts')
const SID = 'ux-polish-sid'

store.clear(); mode = 'ok'
const a = ss.upsertMemoryCache(SID, '我不喜欢黑咖啡', '记住，我不喜欢黑咖啡', undefined, true, 'snap')
rec('C1 新增 explicit → 写入成功（=created:true）', a !== null && a.explicit === true)

const b = ss.upsertMemoryCache(SID, '我周末喜欢睡到中午', '我周末喜欢睡到中午', undefined, undefined, 'snap')
rec('C2 新增 inferred（非 explicit）→ 写入成功（=created:true）', b !== null && b.explicit === undefined)

rec('C3 去重命中（同文本再写）→ isSimilarMemory=true（=created:false）',
  mem.isSimilarMemory(ss.getMemoriesCache(SID), '我不喜欢黑咖啡') === true)

const before = ss.getMemoriesCache(SID).length
mode = 'throw'
const c = ss.upsertMemoryCache(SID, '我怕打雷', '记住我怕打雷', undefined, true)
mode = 'ok'
rec('C4 写失败 → null 且缓存没有这条（=created:false，不假成功）',
  c === null && ss.getMemoriesCache(SID).length === before && !ss.getMemoriesCache(SID).some((m) => m.text === '我怕打雷'))

store.clear()
const d1 = ss.upsertMemoryCache(SID, '甲', undefined, undefined, true)
const d2 = ss.upsertMemoryCache(SID, '乙', undefined, undefined, true)
let flag = false
for (const r of [{ created: d1 !== null }, { created: d2 !== null }]) if (r.created) flag = true
rec('C5 同轮新增 2 条 → 用户标记仍是布尔（只显示一次）',
  d1 !== null && d2 !== null && flag === true && typeof flag === 'boolean')

const stripCases = [
  ['好，我记住了\n【记忆·工作】每周要调休。', '【记忆'],
  ['嗯\n【记忆·饮食】爱吃辣。', '【记忆'],
  ['ok\n[Memory: Work] weekly rotation.', '[Memory'],
  ['记下了\n〖记忆·作息〗十一点半睡。', '〖记忆'],
  ['记下了\n〖记忆・作息〗十一点半睡。', '〖记忆'],
  ['嗯\n〖记忆〗我不吃香菜。', '〖记忆'],
]
let cleanOk = true
for (const [src, mark] of stripCases) {
  const cleaned = mem.stripMemoryMarkers(src)
  if (cleaned.includes(mark)) { cleanOk = false; console.log('   ↳ marker 泄漏:', JSON.stringify(cleaned)) }
  if (!cleaned.trim()) { cleanOk = false; console.log('   ↳ 正文被清空:', JSON.stringify(src)) }
  if (mem.extractMemories(src).length !== 1) { cleanOk = false; console.log('   ↳ marker 提取失败:', JSON.stringify(src)) }
}
const plain = mem.stripMemoryMarkers('他说〖这个不是记忆〗然后走了')
if (!plain.includes('〖这个不是记忆〗')) { cleanOk = false; console.log('   ↳ 普通〖〗被误删:', JSON.stringify(plain)) }
rec('C6 marker 剥离回归：标准/兼容/英文不泄漏（提取正常），普通〖内容〗保留', cleanOk)

store.clear()
ss.upsertMemoryCache(SID, '重复的话', 'a', undefined, undefined)
ss.upsertMemoryCache(SID, '重复的话', 'b', undefined, undefined)
rec('C7 同轮同文本写两次 → 只 1 条', ss.getMemoriesCache(SID).length === 1)

const ok = RES.filter(([, o]) => o).length
console.log(`\n=== PASS ${ok} / ${RES.length} ===`)
if (ok !== RES.length) { console.log('FAILED:', RES.filter(([, o]) => !o).map(([n]) => n).join(' | ')); process.exit(1) }
