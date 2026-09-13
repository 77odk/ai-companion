// UI2-03 Memory Correction · 数据链最小扩展测试
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖构建工具。
// 覆盖：
//   1. taReply optional 字段：写入 → 读取回显
//   2. source 持久化（修截断链路后的落库验证）
//   3. 无 taReply 的旧数据兼容（字段缺失不报错）
//   4. 会话缓存隔离：session1 / session2 各自独立，taReply 不串
//   5. mergeSessionMemories：后端权威内容 + 本地保留增强字段（source/taReply/pinned/explicit）
//   6. buildBookPages：Cover → Year → Month → Memory 独立页序列；无日期条目；跨年；月份计数

import { loadMemory, saveMemory, upsertMemoryItem } from '../src/lib/memory.ts'
import { getMemoriesCache, saveMemoriesCache, upsertMemoryCache, mergeSessionMemories } from '../src/lib/sessionStore.ts'
import { buildBookPages } from '../src/lib/memoryBook.ts'

// ---- Node 环境 mock：storage / window ----
const memStore = new Map()
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: (k) => memStore.delete(k),
  clear: () => memStore.clear(),
}
globalThis.window = { dispatchEvent: () => {} }
function resetStore() {
  memStore.clear()
}

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
function dateOf(y, m, d) {
  return new Date(y, m - 1, d, 12, 0, 0).getTime()
}

console.log('\n[1] taReply optional 字段：写入 → 读取回显')
{
  resetStore()
  upsertMemoryItem('喜欢话梅味的排骨', '都一个多小时了你还在刷牙吗', '饮食', true, '那下次给你做一份尝尝。')
  const items = loadMemory()
  check('写入后 1 条', items.length === 1, `got ${items.length}`)
  check('taReply 回显', items[0]?.taReply === '那下次给你做一份尝尝。', String(items[0]?.taReply))
  check('source 回显', items[0]?.source === '都一个多小时了你还在刷牙吗', String(items[0]?.source))
  check('explicit 保留', items[0]?.explicit === true)
}

console.log('\n[2] 无 taReply 的旧数据兼容（字段缺失不报错、读取正常）')
{
  resetStore()
  saveMemory([
    { id: 'old1', text: '旧记忆没有新字段', createdAt: dateOf(2025, 11, 3), explicit: true },
  ])
  const items = loadMemory()
  check('旧数据可读', items.length === 1 && items[0].text === '旧记忆没有新字段')
  check('taReply 缺省为 undefined', items[0].taReply === undefined)
  check('source 缺省为 undefined', items[0].source === undefined)
}

console.log('\n[3] 会话缓存：taReply 写入 + session 隔离')
{
  resetStore()
  const a = upsertMemoryCache('sess-a', '用户每周三调休', '周三我想调休', '工作', true, '好，周三留给你。')
  const b = upsertMemoryCache('sess-b', '用户不喜欢太甜的东西', '我不喜欢特别甜的', '饮食', false, undefined)
  check('sess-a 写入', a?.taReply === '好，周三留给你。')
  check('sess-b 无 taReply 写入', b?.taReply === undefined)
  const cacheA = getMemoriesCache('sess-a')
  const cacheB = getMemoriesCache('sess-b')
  check('session 隔离：A 只有 A 的', cacheA.length === 1 && cacheA[0].text.startsWith('用户每周'))
  check('session 隔离：B 只有 B 的', cacheB.length === 1 && cacheB[0].text.startsWith('用户不喜欢'))
  check('A 的 taReply 不串到 B', cacheB[0].taReply === undefined)
  check('A 的 taReply 保留', cacheA[0].taReply === '好，周三留给你。')
}

console.log('\n[4] mergeSessionMemories：后端权威内容 + 本地保留增强字段')
{
  resetStore()
  const local = {
    id: '42',
    text: '本地增强文本',
    createdAt: 1,
    source: '本地来源原话',
    taReply: 'TA 当时的回应',
    explicit: true,
    pinned: true,
  }
  saveMemoriesCache('sess-c', [local])
  const cloud = [
    { id: '42', text: '后端权威文本', createdAt: 1 },
    { id: '9', text: '纯后端条目', createdAt: 2 },
  ]
  const merged = mergeSessionMemories(getMemoriesCache('sess-c'), cloud)
  const byId = (id) => merged.find((m) => m.id === id)
  check('同 id 以后端文本为准', byId('42')?.text === '后端权威文本')
  check('同 id 保留本地 source', byId('42')?.source === '本地来源原话')
  check('同 id 保留本地 taReply', byId('42')?.taReply === 'TA 当时的回应')
  check('同 id 保留 pinned/explicit', byId('42')?.pinned === true && byId('42')?.explicit === true)
  check('纯后端条目无增强字段', byId('9')?.taReply === undefined && byId('9')?.source === undefined)
  check('顺序：乐观条目在前', merged[0]?.id === '42' && merged[1]?.id === '9')
}

console.log('\n[5] buildBookPages：独立 page 序列')
{
  const d = (t, text) => ({ item: { id: text, text, createdAt: t, explicit: true }, timestamp: t })
  const empty = buildBookPages([])
  check('空数组 → []', empty.length === 0)

  const single = buildBookPages([d(dateOf(2026, 9, 13), '第一条')])
  check('单条：year → month → memory', single.length === 3 && single[0].type === 'year' && single[1].type === 'month' && single[2].type === 'memory')
  check('单条年份正确', single[0].type === 'year' && single[0].year === 2026)
  check('单条月份计数 1', single[1].type === 'month' && single[1].count === 1)

  const seq = buildBookPages([
    d(dateOf(2026, 8, 8), '八月'),
    d(dateOf(2026, 9, 12), '九月甲'),
    d(dateOf(2026, 9, 13), '九月乙'),
  ])
  const kinds = seq.map((p) => p.type)
  check('升序多条：year,month,mem,month,mem,mem', JSON.stringify(kinds) === JSON.stringify(['year', 'month', 'memory', 'month', 'memory', 'memory']))
  check('同月合并只出现一次 month 章节', seq.filter((p) => p.type === 'month').length === 2)
  check('月份计数：9 月 = 2', (seq[3].type === 'month' && seq[3].count === 2) || (seq[3].type === 'month' && seq[3].count === 2))
  check('memory 页 index 指向正确条目', seq[2].type === 'memory' && seq[2].index === 0 && seq[4].type === 'memory' && seq[4].index === 1)

  const crossYear = buildBookPages([
    d(dateOf(2025, 12, 31), '跨年前'),
    d(dateOf(2026, 1, 1), '跨年后'),
  ])
  const yk = crossYear.map((p) => (p.type === 'year' ? `Y${p.year}` : p.type === 'month' ? `M${p.month + 1}` : 'mem'))
  check('跨年：Y2025,M12,mem,Y2026,M1,mem', JSON.stringify(yk) === JSON.stringify(['Y2025', 'M12', 'mem', 'Y2026', 'M1', 'mem']))

  const unknown = buildBookPages([d(null, '无日期条目'), d(dateOf(2026, 9, 1), '有日期')])
  const uk = unknown.map((p) => p.type)
  check('无日期条目：直接 memory 页（不产生章节）', uk[0] === 'memory' && uk[1] === 'year' && uk[2] === 'month' && uk[3] === 'memory')

  // 3000 条性能：构造时间不炸 + 章节数量可控（不逐条成章）
  const t0 = Date.now()
  const many = []
  const stepMs = 24 * 3600 * 1000
  for (let i = 0; i < 3000; i++) {
    many.push(d(dateOf(2023, 1, 1) + i * stepMs, `记忆 ${i}`))
  }
  const yearsSet = new Set()
  const monthsSet = new Set()
  for (const m of many) {
    const dd = new Date(m.timestamp)
    yearsSet.add(dd.getFullYear())
    monthsSet.add(`${dd.getFullYear()}-${dd.getMonth()}`)
  }
  const manyPages = buildBookPages(many)
  const manyMs = Date.now() - t0
  check('3000 条序列构造 < 500ms', manyMs < 500, `${manyMs}ms`)
  check(
    '3000 条序列长度 = 条目 + 年份章节 + 月份章节（不逐条成章）',
    manyPages.length === 3000 + yearsSet.size + monthsSet.size,
    `got ${manyPages.length}, expect ${3000 + yearsSet.size + monthsSet.size} (y=${yearsSet.size}, m=${monthsSet.size})`,
  )
}

console.log(`\n结果: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
