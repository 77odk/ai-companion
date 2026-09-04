// TASK-LM1 显式记忆指令：detectMemoryInstruction / isMemoryRetort / stripMemoryKeyword / 保底写入去重
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_memory_instruction.mjs（npm test 入口会自动带上）
// 覆盖：显式指令检测（含 fact 提取、过短给 null、反问不误判）/ 反问识别 / 去掉关键词 /
//       保底写入去重（本地库 + 会话缓存）/ explicit 标记
import {
  detectMemoryInstruction,
  isMemoryRetort,
  stripMemoryKeyword,
  upsertMemoryItem,
  loadMemory,
  MEMORY_INSTRUCTION_KEYWORDS,
} from '../src/lib/memory.ts'
import { upsertMemoryCache, getMemoriesCache } from '../src/lib/sessionStore.ts'
// localStorage / window mock：Node 没有这两样，memory.ts / sessionStore.ts 在函数体内引用它们
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
function ok(cond, name) {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}
function eq(actual, expected, name) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  ok(a === b, `${name}（得 ${a}，期望 ${b}）`)
}
console.log('\n[1] detectMemoryInstruction：显式指令硬触发')
eq(detectMemoryInstruction('帮我记一下我早班7:50-15:50上班'), { isInstruction: true, fact: '我早班7:50-15:50上班' }, '帮我记一下+事实 → isInstruction=true 且 fact 去掉关键词')
eq(detectMemoryInstruction('你要记住我叫阿七'), { isInstruction: true, fact: '我叫阿七' }, '你要记住 → 命中且 fact 干净')
eq(detectMemoryInstruction('帮我记住我叫阿七'), { isInstruction: true, fact: '我叫阿七' }, '帮我记住 → 命中的是"帮我记住"而不是"帮我记"')
eq(detectMemoryInstruction('今天天气不错'), { isInstruction: false, fact: null }, '普通句子 → 不命中')
eq(detectMemoryInstruction('记住'), { isInstruction: true, fact: null }, '单独"记住" → 命中但没事实给 null')
eq(detectMemoryInstruction('帮我记一下'), { isInstruction: true, fact: null }, '单独"帮我记一下" → 命中但没事实给 null')
eq(detectMemoryInstruction(''), { isInstruction: false, fact: null }, '空字符串 → 不命中')
eq(detectMemoryInstruction('记住了吗'), { isInstruction: false, fact: null }, '"记住了吗"含"记住"但是反问 → 不算显式指令')
console.log('\n[2] isMemoryRetort：反问/催促识别')
ok(isMemoryRetort('你不记一下吗') === true, '"你不记一下吗" → 反问')
ok(isMemoryRetort('记住了吗') === true, '"记住了吗" → 反问')
ok(isMemoryRetort('记一下啊') === true, '"记一下啊" → 反问')
ok(isMemoryRetort('你记住了没') === true, '"你记住了没" → 反问')
ok(isMemoryRetort('嗯嗯') === false, '"嗯嗯" → 不是反问')
ok(isMemoryRetort('') === false, '空字符串 → 不是反问')
console.log('\n[3] stripMemoryKeyword：去掉指令关键词')
eq(stripMemoryKeyword('帮我记一下我早班7:50-15:50上班'), '我早班7:50-15:50上班', '去掉"帮我记一下"')
eq(stripMemoryKeyword('你要记住我叫阿七'), '我叫阿七', '去掉"你要记住"')
eq(stripMemoryKeyword('今天天气不错'), '今天天气不错', '无关键词原样返回')
console.log('\n[4] 保底写入去重：本地记忆库同一内容只留一条')
resetStore()
upsertMemoryItem('我早班7:50-15:50上班', '来源', '工作', true)
upsertMemoryItem('我早班7:50-15:50上班', '来源2', '工作', true)
eq(loadMemory().length, 1, '同一内容写两次 → 只留一条')
eq(loadMemory()[0].explicit, true, '第一条写入带 explicit=true')
// 模型标记提取（不带 explicit）再写一次同内容 → 去重，不新增
upsertMemoryItem('我早班7:50-15:50上班', '来源3')
eq(loadMemory().length, 1, '模型标记提取与保底写入同内容 → 不重复建条目')
console.log('\n[5] 保底写入去重：会话记忆缓存同一内容只留一条')
resetStore()
upsertMemoryCache('s1', '我早班7:50-15:50上班', '来源', '工作', true)
upsertMemoryCache('s1', '我早班7:50-15:50上班', '来源2', '工作', true)
eq(getMemoriesCache('s1').length, 1, '会话缓存同一内容写两次 → 只留一条')
eq(getMemoriesCache('s1')[0].explicit, true, '会话缓存保底写入带 explicit=true')
console.log('\n[6] 关键词导出与 explicit 缺省行为')
eq(MEMORY_INSTRUCTION_KEYWORDS, ['帮我记一下', '帮我记', '记一下', '记住', '记下来', '别忘了', '你要记住', '你记着', '你记住', 'remember this', 'note this', 'keep this in mind', "don't forget", 'memorize this', 'write this down'], '导出数组与任务定义一致（含英文关键词）')
resetStore()
upsertMemoryItem('喜欢下雨', '来源')
eq(loadMemory()[0].explicit ?? false, false, '不带 explicit → 缺省推断（不标 explicit）')
console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
