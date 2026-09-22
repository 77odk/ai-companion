// Memory 写失败复核：假成功判定修复的专项测试
// A setItem throw / B 回读不一致 / C upsertMemoryCache 失败返回 null / D-E-F-G 成功提示绑定真实写入 / H 去重 / I marker 回归
const LIB = new URL('../src/lib/', import.meta.url)
const { readFileSync } = await import('node:fs')
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

const store = new Map()
let mode = 'ok' // ok | throw | phantom（写入不生效：回读拿旧值）
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => {
    if (mode === 'throw') throw new Error('QuotaExceededError')
    if (mode === 'phantom') return          // 假装写了，实际没写进去
    store.set(k, String(v))
  },
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}

const mem = await import(new URL('memory.ts', LIB).href)
const ss = await import(new URL('sessionStore.ts', LIB).href)
const st = await import(new URL('storage.ts', LIB).href)

const R = []
const ok = (v, name, extra = '') => { R.push([name, !!v, extra]); console.log(`${v ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`) }

// ---- A：setItem throw → saveMemoriesCache = false ----
mode = 'ok'; ss.saveMemoriesCache('sA', [{ id: '1', text: '基线', createdAt: 1 }])
mode = 'throw'
const aRes = ss.saveMemoriesCache('sA', [{ id: '2', text: '写不进去', createdAt: 2 }])
mode = 'ok'
ok(aRes === false, 'A setItem 抛错 → saveMemoriesCache 返回 false', `ret=${aRes}`)

// ---- B：回读不一致 → false ----
mode = 'phantom'
const bRes = ss.saveMemoriesCache('sA', [{ id: '3', text: '幽灵', createdAt: 3 }])
mode = 'ok'
ok(bRes === false, 'B 写入后回读不一致（幽灵写）→ 返回 false', `ret=${bRes}`)
ok((store.get('ai_companion_mem_sA') || '').includes('写不进去') === false, 'B2 缓存里确实没有幽灵条目')

// ---- C：upsertMemoryCache 本地失败 → null 且缓存无新条目 ----
mode = 'ok'; ss.saveMemoriesCache('sC', [])
mode = 'throw'
const cItem = ss.upsertMemoryCache('sC', '我妈身体很好', '我妈身体很好')
const cLen = ss.getMemoriesCache('sC').length
mode = 'ok'
ok(cItem === null, 'C1 本地写失败 → upsertMemoryCache 返回 null', `item=${cItem}`)
ok(cLen === 0, 'C2 缓存里没有这条（不出现假数据）', `len=${cLen}`)

// ---- C3：addMemoryCacheItem 同源（另一个写入口）也要 null ----
mode = 'throw'
const c3 = ss.addMemoryCacheItem ? ss.addMemoryCacheItem('sC', '另一个入口', '其他', true) : null
mode = 'ok'
ok(c3 === null, 'C3 addMemoryCacheItem 写失败同样返回 null', `item=${c3}`)

// ---- D：global 侧写失败 → upsertMemoryItem 返回未变更列表 ----
mode = 'ok'; mem.saveMemory([])
mode = 'throw'
const dAfter = mem.upsertMemoryItem('global 写不进去', undefined, '其他', true)
mode = 'ok'
ok(dAfter.length === 0, 'D global 写失败 → 返回未变更列表（调用方据此判定失败）', `len=${dAfter.length}`)

// ---- E/F/G：两个成功提示的判定依据 ----（源码契约 + 行为）
const chatSrc = read('src/components/Chat.tsx')
const bubbleSrc = read('src/components/MessageBubble.tsx')
ok(/if \(!item\) return \{ ok: false, created: false \}/.test(chatSrc), 'E1 writeMemory：本地写失败立即返回 ok:false/created:false（不再继续当成功）')
ok(/if \(res\.created\) created = true/.test(chatSrc) && /if \(created\) userMsg\.memorySaved = true/.test(chatSrc), 'E2 flushMemoryWrites：只有「真实新增(created)」才置 memorySaved（不再要求 explicit）')
ok(/if \(memoryWroteThisTurn && assistantMsgs\.length > 0\)/.test(chatSrc), 'E3 TA 消息的「已记住」标记也来自真实写入结果')
ok(
  /const hasMemory = !isUser && message\.memorySaved === true/.test(bubbleSrc) &&
    !/message\.memorySaved === true && extractMemories\(message\.content\)/.test(bubbleSrc),
  'F1 「已记住」只看真实写入结果 memorySaved===true（正文 marker 已剥离，不再参与展示判断）',
)
const badgeMerged = ss.mergeSessionMessages(
  [{ role: 'assistant', content: '我记住了', ts: 101, memorySaved: true }],
  [{ role: 'assistant', content: '我记住了', ts: 101 }],
)
ok(badgeMerged[0]?.memorySaved === true, 'F2 云端消息回填后仍保留本地 memorySaved，提示不会消失')
ok(st.shouldShowMemorySaved({ role: 'user', content: 'x', ts: 1, memorySaved: true }) === true, 'G1 写成功 → 「✅已帮你记下」显示')
ok(st.shouldShowMemorySaved({ role: 'user', content: 'x', ts: 1 }) === false, 'G2 写失败（未标 memorySaved）→ 不显示')
ok(st.shouldShowMemorySaved({ role: 'user', content: 'x', ts: 1, memorySaved: false }) === false, 'G3 memorySaved=false → 不显示')

// ---- H：同轮去重仍只有 1 条 ----
mode = 'ok'; ss.saveMemoriesCache('sH', [])
const h1 = ss.upsertMemoryCache('sH', '重复测试', '重复测试')
const h2 = ss.upsertMemoryCache('sH', '重复测试', '重复测试')
ok(h1 !== null && h2 === null, 'H1 第二次相同写入返回 null（去重）', `h2=${h2}`)
ok(ss.getMemoriesCache('sH').filter((m) => m.text === '重复测试').length === 1, 'H2 最终只有 1 条')

// ---- I：marker 剥离/提取回归 ----
const zh = '好的\n【记忆·工作】每周要调休。'
const brk = '嗯\n〖记忆・习惯〗十一点半睡。'
const plain = '这句〖普通内容〗不能删。'
const en = 'Sure\n[Memory: Work] weekly rotation.'
ok(mem.extractMemories(zh).length === 1 && !mem.stripMemoryMarkers(zh).includes('记忆·'), 'I1 标准 marker：提取 ✓ 不泄漏 ✓')
ok(mem.extractMemories(brk).length === 1 && !mem.stripMemoryMarkers(brk).includes('记忆'), 'I2 兼容 marker：提取 ✓ 不泄漏 ✓')
ok(mem.stripMemoryMarkers(plain).includes('普通内容'), 'I3 普通〖内容〗不被误删')
ok(mem.extractMemories(en).length === 1 && !mem.stripMemoryMarkers(en).includes('Memory:'), 'I4 英文 marker：提取 ✓ 不泄漏 ✓')

const p = R.filter(([, v]) => v).length
console.log(`\n=== PASS ${p} / ${R.length} ===`)
for (const [n, v, e] of R) if (!v) console.log(`FAIL: ${n} [${e}]`)
process.exit(p === R.length ? 0 : 1)
