// #12 回复长度（2026-09-20 重做版）：四档 自然/短/中/长 + 全局/单 TA 两层 + Cloud State
// 硬口径：默认「自然」= 不注入任何东西；只有显式选择才注入一行篇幅感，无句数、无字数
import { readFileSync } from 'node:fs'

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
}
globalThis.window = new EventTarget()

const {
  DEFAULT_GLOBAL_REPLY_LENGTH,
  getStoredGlobalReplyLength,
  getGlobalReplyLength,
  saveGlobalReplyLength,
  applyGlobalReplyLengthFromCloud,
  deleteGlobalReplyLengthFromCloud,
  getReplyLengthOverride,
  saveReplyLengthOverride,
  clearReplyLengthOverride,
  getEffectiveReplyLength,
  applyReplyLengthOverrideFromCloud,
  deleteReplyLengthOverrideFromCloud,
  collectStoredReplyLengthOverrides,
  replyLengthLabel,
  buildReplyLengthInstruction,
} = await import('../src/lib/replyLength.ts')

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) passed++
  else {
    failed++
    console.log(`  ✗ FAIL: ${name}${detail ? ' → ' + detail : ''}`)
  }
}

console.log('\n[1] 默认自然：什么都不注入、不存值')
mem.clear()
check('默认全局是 natural', DEFAULT_GLOBAL_REPLY_LENGTH === 'natural')
check('未设置 A → natural', getGlobalReplyLength('A') === 'natural')
check('未设置不伪造 stored 值', getStoredGlobalReplyLength('A') === null)
check('natural 指令是空串', buildReplyLengthInstruction('natural') === '')
check('natural 英文指令也是空串', buildReplyLengthInstruction('natural', 'en') === '')

console.log('\n[2] 四档只注入一行篇幅感，不含句数/字数')
const zhShort = buildReplyLengthInstruction('short')
const zhMedium = buildReplyLengthInstruction('medium')
const zhLong = buildReplyLengthInstruction('long')
check('短 = 简短自然', zhShort === '【回复偏好】简短自然，几句话说完。', zhShort)
check('中 = 保持适中长度', zhMedium === '【回复偏好】保持适中长度。', zhMedium)
check('长 = 可以多说一点', zhLong === '【回复偏好】可以多说一点，按话题自然展开。', zhLong)
for (const [name, s] of [['短', zhShort], ['中', zhMedium], ['长', zhLong]]) {
  check(`${name}档不含数字句数`, !/\d/.test(s), s)
  check(`${name}档不含「小作文」`, !s.includes('小作文'))
  check(`${name}档不含「字」上限`, !s.includes('字以内') && !s.includes('不超过'))
}
const enShort = buildReplyLengthInstruction('short', 'en')
check('英文短档可用', /short and natural/i.test(enShort), enShort)
check('英文档不含句数数字', !/\d/.test(enShort))

console.log('\n[3] 全局：账号级、自然=没有显式值')
mem.clear()
check('A 可设 long', saveGlobalReplyLength('A', 'long') === true)
check('A 读回 long', getGlobalReplyLength('A') === 'long')
check('A 有显式值', getStoredGlobalReplyLength('A') === 'long')
check('B 不串 A', getGlobalReplyLength('B') === 'natural')
check('A 设回自然 → 删掉显式值', saveGlobalReplyLength('A', 'natural') === true)
check('A 读回 natural', getGlobalReplyLength('A') === 'natural')
check('A 显式值已清', getStoredGlobalReplyLength('A') === null)
check('A 的 storage key 真的没了', ![...mem.keys()].some((k) => k.includes('reply_length_global_') && k.includes('A')))

console.log('\n[4] 单 TA：跟随全局 vs 明确「自然」是两件事')
mem.clear()
saveGlobalReplyLength('A', 'short')
check('A/1 无 override = 跟随全局 short', getEffectiveReplyLength('A', '1') === 'short')
check('A/1 明确选自然', saveReplyLengthOverride('A', '1', 'natural') === true)
check('A/1 override 存在但值为 natural', getReplyLengthOverride('A', '1') === 'natural')
check('A/1 生效 natural（压过全局 short）', getEffectiveReplyLength('A', '1') === 'natural')
check('A/1 注入为空', buildReplyLengthInstruction(getEffectiveReplyLength('A', '1')) === '')
check('保存 natural override 不算「跟随全局」', getReplyLengthOverride('A', '1') !== null)
check('A/2 仍跟随全局 short', getEffectiveReplyLength('A', '2') === 'short')
check('B/1 不串 A/1', getReplyLengthOverride('B', '1') === null)
check('收集到的 override 含 natural', collectStoredReplyLengthOverrides('A', ['1', '2']).get('1') === 'natural')
clearReplyLengthOverride('A', '1')
check('点「跟随全局」后 override 没了', getReplyLengthOverride('A', '1') === null)
check('又跟回全局 short', getEffectiveReplyLength('A', '1') === 'short')

console.log('\n[5] Cloud State：全局/单 TA 分层，natural 语义不丢')
mem.clear()
check('cloud 全局 long', applyGlobalReplyLengthFromCloud('A', { mode: 'long' }) === 'long')
check('本地读到 long', getGlobalReplyLength('A') === 'long')
check('cloud 全局 natural → 清显式值', applyGlobalReplyLengthFromCloud('A', { mode: 'natural' }) === 'natural')
check('本地回到 natural', getGlobalReplyLength('A') === 'natural')
check('删掉后仍 natural', getStoredGlobalReplyLength('A') === null)
check('cloud override natural', applyReplyLengthOverrideFromCloud('A', '2', { mode: 'natural' }) === 'natural')
check('override natural 生效', getEffectiveReplyLength('A', '2') === 'natural')
check('cloud override 非法值拒绝', applyReplyLengthOverrideFromCloud('A', '2', { mode: 'huge' }) === null)
check('cloud 全局非法值拒绝', applyGlobalReplyLengthFromCloud('A', { mode: 123 }) === null)
check('delete override 回跟随全局', (deleteReplyLengthOverrideFromCloud('A', '2'), getReplyLengthOverride('A', '2') === null))
check('delete 全局回 natural', (deleteGlobalReplyLengthFromCloud('A'), getGlobalReplyLength('A') === 'natural'))

console.log('\n[6] 标签')
check('自然标签', replyLengthLabel('natural') === '自然')
check('短标签', replyLengthLabel('short') === '短')
check('中标签', replyLengthLabel('medium') === '中')
check('长标签', replyLengthLabel('long') === '长')

console.log('\n[7] 静态断言：长度不再单独占一条 system')
const chatSrc = readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
check('Chat 里不再 push 长度 system', !/apiMessages\.push\(\{\s*role:\s*'system',\s*content:\s*buildReplyLengthInstruction/.test(chatSrc))
check('Chat 把偏好拼进主 system', chatSrc.includes('replyPreference'))
check('主 system 拼接处带换行', chatSrc.includes("(replyPreference ? '\\n\\n' + replyPreference : '')"))

console.log('\n[8] 静态断言：会话起点（刷新对话）已进 Cloud State')
const cloudSrc = readFileSync(new URL('../src/lib/cloudStateResources.ts', import.meta.url), 'utf8')
check("注册了 session_start adapter", cloudSrc.includes("registerCloudStateAdapter('session_start'"))
check('有 captureSessionStarts', cloudSrc.includes('function captureSessionStarts'))
check('切账号会重置快照', cloudSrc.includes('resetSessionStartSnapshot()'))

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)
