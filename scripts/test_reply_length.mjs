// #12 回复长度最终口径：自然 / 简洁 / 适中 / 详细
// 默认自然=不注入；全局 + 单 TA 覆盖；详细模式优先整段、少碎泡。
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
  splitDetailedAssistantReply,
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

console.log('\n[1] 默认自然：老用户不被新增规则干预')
mem.clear()
check('默认全局 natural', DEFAULT_GLOBAL_REPLY_LENGTH === 'natural')
check('未设置账号 → natural', getGlobalReplyLength('A') === 'natural')
check('未设置不伪造显式值', getStoredGlobalReplyLength('A') === null)
check('自然中文不注入', buildReplyLengthInstruction('natural', 'zh') === '')
check('自然英文不注入', buildReplyLengthInstruction('natural', 'en') === '')

console.log('\n[2] UI 名称与轻量 prompt')
check('natural → 自然', replyLengthLabel('natural') === '自然')
check('short → 简洁', replyLengthLabel('short') === '简洁')
check('medium → 适中', replyLengthLabel('medium') === '适中')
check('long → 详细', replyLengthLabel('long') === '详细')

const zhShort = buildReplyLengthInstruction('short', 'zh')
const zhMedium = buildReplyLengthInstruction('medium', 'zh')
const zhLong = buildReplyLengthInstruction('long', 'zh')
check('简洁文案准确', zhShort === '【回复偏好】回复简洁自然，省掉不必要的展开。', zhShort)
check('适中文案准确', zhMedium === '【回复偏好】保持适中的展开程度，把该说的说完整，不必刻意拉长。', zhMedium)
check('详细文案准确', zhLong === '【回复偏好】可以更充分地展开，把相关细节和想法说完整，但不要为了变长重复或堆无关内容。', zhLong)
for (const [name, value] of [['简洁', zhShort], ['适中', zhMedium], ['详细', zhLong]]) {
  check(`${name}不含数字配额`, !/\d/.test(value), value)
  check(`${name}不写句数/字数`, !/(句|字以内|不超过|最多)/.test(value), value)
}
for (const mode of ['short', 'medium', 'long']) {
  const en = buildReplyLengthInstruction(mode, 'en')
  check(`英文 ${mode} 不含数字`, !/\d/.test(en), en)
}

console.log('\n[3] 全局：账号级，natural = 没有显式值')
mem.clear()
check('A 全局可设 detailed(long)', saveGlobalReplyLength('A', 'long') === true)
check('A 读回 long', getGlobalReplyLength('A') === 'long')
check('B 不串 A', getGlobalReplyLength('B') === 'natural')
check('A 设回自然', saveGlobalReplyLength('A', 'natural') === true)
check('A 回 natural', getGlobalReplyLength('A') === 'natural')
check('自然删除显式 global', getStoredGlobalReplyLength('A') === null)

console.log('\n[4] 单 TA：跟随全局 与 明确自然 分开')
mem.clear()
saveGlobalReplyLength('A', 'medium')
check('A/1 无 override → 跟随适中', getEffectiveReplyLength('A', '1') === 'medium')
check('A/1 明确自然可保存', saveReplyLengthOverride('A', '1', 'natural') === true)
check('A/1 override 是 natural', getReplyLengthOverride('A', '1') === 'natural')
check('A/1 自然压过全局适中', getEffectiveReplyLength('A', '1') === 'natural')
check('A/2 仍跟随适中', getEffectiveReplyLength('A', '2') === 'medium')
check('B/1 不串账号', getReplyLengthOverride('B', '1') === null)
check('collect 保留显式 natural override', collectStoredReplyLengthOverrides('A', ['1']).get('1') === 'natural')
clearReplyLengthOverride('A', '1')
check('跟随全局 = 删除 override', getReplyLengthOverride('A', '1') === null)
check('删除后回适中', getEffectiveReplyLength('A', '1') === 'medium')

console.log('\n[5] Cloud State 语义')
mem.clear()
check('cloud global long', applyGlobalReplyLengthFromCloud('A', { mode: 'long' }) === 'long')
check('cloud global 恢复', getGlobalReplyLength('A') === 'long')
check('cloud override natural', applyReplyLengthOverrideFromCloud('A', '2', { mode: 'natural' }) === 'natural')
check('override natural 生效', getEffectiveReplyLength('A', '2') === 'natural')
check('非法 global 拒绝', applyGlobalReplyLengthFromCloud('A', { mode: 'huge' }) === null)
check('非法 override 拒绝', applyReplyLengthOverrideFromCloud('A', '2', { mode: 'huge' }) === null)
deleteReplyLengthOverrideFromCloud('A', '2')
check('删 override → 跟随 global', getEffectiveReplyLength('A', '2') === 'long')
deleteGlobalReplyLengthFromCloud('A')
check('删 global → natural', getGlobalReplyLength('A') === 'natural')

console.log('\n[6] 详细模式：整段优先，过长才按语义少量拆')
const normalDetailed = '我觉得这件事可以慢慢说清楚。你刚才提到的几个点其实是连在一起的，我想把它们放在一起回答，这样不会显得一条一句特别碎。'
const normalParts = splitDetailedAssistantReply(normalDetailed, 100)
check('正常详细回复保持一个气泡', normalParts.length === 1, String(normalParts.length))
check('正文原样保留', normalParts[0]?.content === normalDetailed)

const paragraphs = '第一段把一件事说完整，不急着切开。\n\n第二段再说另一个相关的想法。'
const paragraphParts = splitDetailedAssistantReply(paragraphs, 101)
check('自然段可成为少量独立气泡', paragraphParts.length === 2, String(paragraphParts.length))
check('自然段内容不丢', paragraphParts.map((p) => p.content).join('') === paragraphs.replace(/\n\s*\n+/g, ''))

const sentence = '这是一个用来验证详细模式长回复分组是否自然的完整句子。'
const veryLong = sentence.repeat(30)
const longParts = splitDetailedAssistantReply(veryLong, 102)
check('超长详细回复会拆', longParts.length > 1)
check('但不会一句一泡', longParts.length < 10, String(longParts.length))
check('拆分后内容不丢', longParts.map((p) => p.content).join('') === veryLong)

console.log('\n[7] 源码 contract')
const chatSrc = readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
const settingsSrc = readFileSync(new URL('../src/components/Settings.tsx', import.meta.url), 'utf8')
const chatSettingsSrc = readFileSync(new URL('../src/components/ChatSettings.tsx', import.meta.url), 'utf8')
const partialSrc = readFileSync(new URL('../src/lib/partialReply.ts', import.meta.url), 'utf8')
const storeSrc = readFileSync(new URL('../src/lib/sessionStore.ts', import.meta.url), 'utf8')
const cloudSrc = readFileSync(new URL('../src/lib/cloudStateResources.ts', import.meta.url), 'utf8')

check('Chat 不再 push 第二条长度 system', !/apiMessages\.push\(\{\s*role:\s*'system',\s*content:\s*buildReplyLengthInstruction/.test(chatSrc))
check('长度偏好拼进同一主 system content', chatSrc.includes('replyPreference') && chatSrc.includes("replyPreference ? '\\n\\n' + replyPreference : ''"))
check('详细模式最终提交使用大气泡 splitter', chatSrc.includes("replyLength === 'long' ? splitDetailedAssistantReply"))
check('详细模式流式显示也使用大气泡 splitter', chatSrc.includes("replyLength === 'long'\n        ? splitDetailedAssistantReply"))
check('半截回复也保留详细模式', partialSrc.includes("replyLength === 'long'") && partialSrc.includes('splitDetailedAssistantReply'))
check('全局 UI 是自然/简洁/适中/详细', ['自然', '简洁', '适中', '详细'].every((label) => settingsSrc.includes(`title: '${label}'`)))
check('单 TA 有跟随全局 + 四档', chatSettingsSrc.includes("title: '跟随全局'") && ['自然', '简洁', '适中', '详细'].every((label) => chatSettingsSrc.includes(`title: '${label}'`)))
check('reply_length_global 仍注册', cloudSrc.includes("registerCloudStateAdapter('reply_length_global'"))
check('reply_length override 仍注册', cloudSrc.includes("registerCloudStateAdapter('reply_length'"))
check('session_start 已注册跨设备同步', cloudSrc.includes("registerCloudStateAdapter('session_start'"))
check('session_start 只往前推进', cloudSrc.includes('if (local > ts)'))
check('原普通拆泡函数签名不变', /export function splitAssistantReplies\(content: string, ts: number\)/.test(storeSrc))
check('原普通拆泡 60 字逻辑仍在', (storeSrc.match(/chunkText\([^\n]*, 60\)/g) || []).length >= 2)

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
