// #12 回复长度：账号级全局 + 单 TA 覆盖 + Cloud State + 聊天设置回归
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

console.log('\n[1] 全局：账号级、默认短、显式设置可持久化')
mem.clear()
check('默认全局是 short', DEFAULT_GLOBAL_REPLY_LENGTH === 'short')
check('未设置 A → short', getGlobalReplyLength('A') === 'short')
check('未设置不伪造 stored 值', getStoredGlobalReplyLength('A') === null)
check('A 全局可设 long', saveGlobalReplyLength('A', 'long') === true)
check('A 读回 long', getGlobalReplyLength('A') === 'long')
check('B 不串 A', getGlobalReplyLength('B') === 'short')
check('B 可设 medium', saveGlobalReplyLength('B', 'medium') === true)
check('A 仍是 long', getGlobalReplyLength('A') === 'long')

console.log('\n[2] 单 TA override：override > global；无 override 实时继承')
check('A/1 无 override', getReplyLengthOverride('A', '1') === null)
check('A/1 继承 global long', getEffectiveReplyLength('A', '1') === 'long')
check('A/1 可覆盖 short', saveReplyLengthOverride('A', '1', 'short') === true)
check('A/1 生效 short', getEffectiveReplyLength('A', '1') === 'short')
check('A/2 仍继承 long', getEffectiveReplyLength('A', '2') === 'long')
check('B/1 不串 A/1', getReplyLengthOverride('B', '1') === null)
check('改 A 全局 medium', saveGlobalReplyLength('A', 'medium') === true)
check('A/2 自动跟到 medium', getEffectiveReplyLength('A', '2') === 'medium')
check('A/1 覆盖仍保持 short', getEffectiveReplyLength('A', '1') === 'short')
clearReplyLengthOverride('A', '1')
check('A/1 跟随全局 = 删除 override', getReplyLengthOverride('A', '1') === null)
check('删除 override 后实时继承 medium', getEffectiveReplyLength('A', '1') === 'medium')

console.log('\n[3] Cloud State apply/delete：全局和单 TA 分层')
check('cloud apply global long', applyGlobalReplyLengthFromCloud('A', { mode: 'long' }) === 'long')
check('cloud global 恢复后 A=long', getGlobalReplyLength('A') === 'long')
check('cloud apply A/2 short', applyReplyLengthOverrideFromCloud('A', '2', { mode: 'short' }) === 'short')
check('cloud override 优先', getEffectiveReplyLength('A', '2') === 'short')
check('坏 payload 不覆盖', applyReplyLengthOverrideFromCloud('A', '2', { mode: 'huge' }) === null && getEffectiveReplyLength('A', '2') === 'short')
deleteReplyLengthOverrideFromCloud('A', '2')
check('cloud delete override → 回 global', getEffectiveReplyLength('A', '2') === 'long')
deleteGlobalReplyLengthFromCloud('A')
check('cloud delete global → 回默认 short', getGlobalReplyLength('A') === 'short')

console.log('\n[4] collect 只收显式单 TA override')
saveReplyLengthOverride('A', '1', 'medium')
saveReplyLengthOverride('A', '3', 'long')
const collected = collectStoredReplyLengthOverrides('A', ['1', '2', '3'])
check('只收两个 override', collected.size === 2)
check('override 值正确', collected.get('1') === 'medium' && collected.get('3') === 'long')

console.log('\n[5] 文案 contract')
check('标签短中长', replyLengthLabel('short') === '短' && replyLengthLabel('medium') === '中' && replyLengthLabel('long') === '长')
check('短明确 1–2 句', buildReplyLengthInstruction('short', 'zh').includes('1–2 句'))
check('中明确 2–4 句', buildReplyLengthInstruction('medium', 'zh').includes('2–4 句'))
check('长明确 4–7 句', buildReplyLengthInstruction('long', 'zh').includes('4–7 句'))
check('英文三档都有 Reply length', ['short','medium','long'].every((v) => buildReplyLengthInstruction(v, 'en').includes('[Reply length]')))

console.log('\n[6] 源码 contract：全局入口 + 聊天设置 + refresh 搬迁')
const chatSrc = readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
const settingsSrc = readFileSync(new URL('../src/components/Settings.tsx', import.meta.url), 'utf8')
const chatSettingsSrc = readFileSync(new URL('../src/components/ChatSettings.tsx', import.meta.url), 'utf8')
const profileSrc = readFileSync(new URL('../src/components/ChatProfile.tsx', import.meta.url), 'utf8')
const appSrc = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const storeSrc = readFileSync(new URL('../src/lib/sessionStore.ts', import.meta.url), 'utf8')
const cloudSrc = readFileSync(new URL('../src/lib/cloudStateResources.ts', import.meta.url), 'utf8')

check('Chat 用 effective（override > global）', chatSrc.includes('getEffectiveReplyLength(accountId, activeSessionId)'))
check('Chat 追加独立 system 指令', chatSrc.includes("buildReplyLengthInstruction(replyLength, lang)"))
check('我的→关于 TA 有全局回复长度', settingsSrc.includes('设置所有 TA 默认一次会说多少') && settingsSrc.includes('saveGlobalReplyLength'))
check('聊天设置有跟随全局', chatSettingsSrc.includes("'global'") && chatSettingsSrc.includes('clearReplyLengthOverride'))
check('聊天设置有短中长', chatSettingsSrc.includes("value: 'short'") && chatSettingsSrc.includes("value: 'medium'") && chatSettingsSrc.includes("value: 'long'"))
check('聊天设置接管刷新对话', chatSettingsSrc.includes('setSessionStart(Date.now(), sessionId)') && chatSettingsSrc.includes('刷新对话'))
check('TA 资料页不再承载刷新对话', !profileSrc.includes('setSessionStart') && !profileSrc.includes('确认刷新'))
check('Chat 顶栏有齿轮入口', appSrc.includes('className="chat-header-settings"') && appSrc.includes("goView('chatsettings')"))
check('Cloud State 注册 global', cloudSrc.includes("registerCloudStateAdapter('reply_length_global'"))
check('Cloud State 注册 per-role override', cloudSrc.includes("registerCloudStateAdapter('reply_length'"))
check('全局 queue 无 session scope', cloudSrc.includes("queue('reply_length_global', GLOBAL"))
check('override queue 带 session scope', cloudSrc.includes("queue('reply_length', sessionId, { mode: value.mode }, false, sessionId)"))
check('splitAssistantReplies 签名没被长度设置污染', /export function splitAssistantReplies\(content: string, ts: number\)/.test(storeSrc))
check('拆泡仍维持原 60 目标', (storeSrc.match(/chunkText\([^\n]*, 60\)/g) || []).length >= 2)

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
