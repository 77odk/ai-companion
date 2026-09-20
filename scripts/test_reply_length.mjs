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
  getReplyLengthPreference,
  getStoredReplyLengthPreference,
  saveReplyLengthOverride,
  saveReplyLengthPreference,
  saveReplyLengthFollowGlobal,
  saveReplyLengthMode,
  clearReplyLengthOverride,
  getEffectiveReplyLength,
  applyReplyLengthOverrideFromCloud,
  applyReplyLengthPreferenceFromCloud,
  deleteReplyLengthOverrideFromCloud,
  collectStoredReplyLengthOverrides,
  collectStoredReplyLengthPreferences,
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

console.log('\n[4b] 跟随全局开关：锁住但不删除当前 TA 已选')
mem.clear()
saveGlobalReplyLength('A', 'medium')
check('先保存 TA=详细且不跟随全局', saveReplyLengthPreference('A', '1', { mode: 'long', followGlobal: false }) === true)
check('关闭全局时 TA 详细生效', getEffectiveReplyLength('A', '1') === 'long')
check('打开跟随全局成功', saveReplyLengthFollowGlobal('A', '1', true) === true)
let pref = getReplyLengthPreference('A', '1')
check('打开后 followGlobal=true', pref.followGlobal === true)
check('打开后仍记住 TA 自己的详细', pref.mode === 'long')
check('打开后实际按全局适中', getEffectiveReplyLength('A', '1') === 'medium')
check('兼容 override 读取在跟随全局时为空', getReplyLengthOverride('A', '1') === null)
check('跟随全局期间只改全局即可实时生效', saveGlobalReplyLength('A', 'short') === true && getEffectiveReplyLength('A', '1') === 'short')
check('关闭跟随全局成功', saveReplyLengthFollowGlobal('A', '1', false) === true)
check('关闭后恢复之前详细', getEffectiveReplyLength('A', '1') === 'long')
check('单独改 TA 档位不改开关', saveReplyLengthMode('A', '1', 'short') === true && getReplyLengthPreference('A', '1').followGlobal === false)
check('TA 新档位简洁生效', getEffectiveReplyLength('A', '1') === 'short')

console.log('\n[4c] 旧数据迁移：已有 override 继续按 TA 自己生效')
mem.clear()
mem.set('ai_companion_reply_length_override_A_legacy', 'long')
const legacyPref = getStoredReplyLengthPreference('A', 'legacy')
check('旧字符串读取为详细', legacyPref?.mode === 'long')
check('旧字符串迁移语义 followGlobal=false', legacyPref?.followGlobal === false)
check('旧 override 不会被升级成全局覆盖', getEffectiveReplyLength('A', 'legacy') === 'long')

console.log('\n[5] Cloud State 语义')
mem.clear()
check('cloud global long', applyGlobalReplyLengthFromCloud('A', { mode: 'long' }) === 'long')
check('cloud global 恢复', getGlobalReplyLength('A') === 'long')
check('cloud 新格式可恢复 mode + followGlobal', !!applyReplyLengthPreferenceFromCloud('A', '2', { mode: 'natural', followGlobal: true }))
check('cloud 跟随全局时实际用 global', getEffectiveReplyLength('A', '2') === 'long')
check('cloud 仍记住 TA 自己 natural', getReplyLengthPreference('A', '2').mode === 'natural')
check('cloud followGlobal=true 保留', getReplyLengthPreference('A', '2').followGlobal === true)
check('cloud 旧格式仍按 override 恢复', applyReplyLengthOverrideFromCloud('A', '3', { mode: 'natural' }) === 'natural')
check('cloud 旧格式 natural 生效', getEffectiveReplyLength('A', '3') === 'natural')
check('非法 global 拒绝', applyGlobalReplyLengthFromCloud('A', { mode: 'huge' }) === null)
check('非法 preference 拒绝', applyReplyLengthPreferenceFromCloud('A', '2', { mode: 'huge', followGlobal: true }) === null)
const collectedPrefs = collectStoredReplyLengthPreferences('A', ['2', '3'])
check('collect 会保留跟随全局中的已选值', collectedPrefs.get('2')?.mode === 'natural' && collectedPrefs.get('2')?.followGlobal === true)
deleteReplyLengthOverrideFromCloud('A', '2')
check('删 preference → 回默认跟随 global', getEffectiveReplyLength('A', '2') === 'long')
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
check('聊天设置有跟随全局 switch', chatSettingsSrc.includes('role="switch"') && chatSettingsSrc.includes('saveReplyLengthFollowGlobal'))
check('聊天设置是一条四档 range', chatSettingsSrc.includes('type="range"') && ['自然', '简洁', '适中', '详细'].every((label) => chatSettingsSrc.includes(`label: '${label}'`)))
check('跟随全局开启会锁住 range', chatSettingsSrc.includes('disabled={preference.followGlobal}'))
check('提示文案是当前全局 + 开启覆盖', chatSettingsSrc.includes('当前全局：{replyLengthLabel(globalValue)} · 开启将覆盖已选'))
check('reply_length_global 仍注册', cloudSrc.includes("registerCloudStateAdapter('reply_length_global'"))
check('reply_length preference 仍复用原 Cloud kind', cloudSrc.includes("registerCloudStateAdapter('reply_length'"))
check('Cloud payload 同步 mode + followGlobal', cloudSrc.includes('{ mode: value.mode, followGlobal: value.followGlobal }'))
check('session_start 已注册跨设备同步', cloudSrc.includes("registerCloudStateAdapter('session_start'"))
check('session_start 只往前推进', cloudSrc.includes('if (local > ts)'))
check('原普通拆泡函数签名不变', /export function splitAssistantReplies\(content: string, ts: number\)/.test(storeSrc))
check('原普通拆泡 60 字逻辑仍在', (storeSrc.match(/chunkText\([^\n]*, 60\)/g) || []).length >= 2)

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
