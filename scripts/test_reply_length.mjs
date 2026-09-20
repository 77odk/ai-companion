// #12 回复长度：每 TA 独立 + Cloud State + 主聊天注入回归
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
  DEFAULT_REPLY_LENGTH,
  getReplyLength,
  getStoredReplyLength,
  saveReplyLength,
  clearReplyLength,
  applyReplyLengthFromCloud,
  deleteReplyLengthFromCloud,
  collectStoredReplyLengths,
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

console.log('\n[1] 默认值 + 账号/角色隔离')
mem.clear()
check('默认值是 medium', DEFAULT_REPLY_LENGTH === 'medium')
check('未设置 A/1 → medium', getReplyLength('A', '1') === 'medium')
check('未设置不伪造显式值', getStoredReplyLength('A', '1') === null)
check('A/1 可设 short', saveReplyLength('A', '1', 'short') === true)
check('A/1 读回 short', getReplyLength('A', '1') === 'short')
check('A/2 不串 A/1', getReplyLength('A', '2') === 'medium')
check('B/1 不串 A/1', getReplyLength('B', '1') === 'medium')
check('A/2 可独立设 long', saveReplyLength('A', '2', 'long') === true)
check('A/2 读回 long', getReplyLength('A', '2') === 'long')
check('A/1 仍是 short', getReplyLength('A', '1') === 'short')

console.log('\n[2] 中也是显式选择，可跨设备保持')
check('A/3 可显式设 medium', saveReplyLength('A', '3', 'medium') === true)
check('A/3 stored 为 medium', getStoredReplyLength('A', '3') === 'medium')
const collected = collectStoredReplyLengths('A', ['1', '2', '3', '4'])
check('collect 收到 3 个显式设置', collected.size === 3)
check('collect 值正确', collected.get('1') === 'short' && collected.get('2') === 'long' && collected.get('3') === 'medium')

console.log('\n[3] clear / cloud apply-delete')
clearReplyLength('A', '1')
check('clear 后回默认 medium', getReplyLength('A', '1') === 'medium')
check('cloud apply long', applyReplyLengthFromCloud('A', '1', { mode: 'long' }) === 'long')
check('cloud apply 后 A/1=long', getReplyLength('A', '1') === 'long')
check('坏 cloud payload 忽略', applyReplyLengthFromCloud('A', '1', { mode: 'huge' }) === null)
check('坏 payload 不覆盖现值', getReplyLength('A', '1') === 'long')
deleteReplyLengthFromCloud('A', '1')
check('cloud delete 后回默认', getReplyLength('A', '1') === 'medium')
check('cloud delete 不影响 A/2', getReplyLength('A', '2') === 'long')

console.log('\n[4] 文案 contract')
check('标签短中长', replyLengthLabel('short') === '短' && replyLengthLabel('medium') === '中' && replyLengthLabel('long') === '长')
const zhShort = buildReplyLengthInstruction('short', 'zh')
const zhMedium = buildReplyLengthInstruction('medium', 'zh')
const zhLong = buildReplyLengthInstruction('long', 'zh')
check('短明确 1–2 句', zhShort.includes('1–2 句'))
check('中明确 2–4 句', zhMedium.includes('2–4 句'))
check('长明确 4–7 句', zhLong.includes('4–7 句'))
check('长模式禁止灌水重复', zhLong.includes('不灌水') && zhLong.includes('不重复'))
check('英文三档都有 Reply length', ['short','medium','long'].every((v) => buildReplyLengthInstruction(v, 'en').includes('[Reply length]')))

console.log('\n[5] 源码契约')
const chatSrc = readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
const settingsSrc = readFileSync(new URL('../src/components/Settings.tsx', import.meta.url), 'utf8')
const storeSrc = readFileSync(new URL('../src/lib/sessionStore.ts', import.meta.url), 'utf8')
const cloudSrc = readFileSync(new URL('../src/lib/cloudStateResources.ts', import.meta.url), 'utf8')
const rolesSrc = readFileSync(new URL('../src/components/RolesPage.tsx', import.meta.url), 'utf8')

check('Chat 读取当前角色 reply length', chatSrc.includes('getReplyLength(accountId, activeSessionId)'))
check('Chat 追加独立 system 长度指令', chatSrc.includes("apiMessages.push({ role: 'system', content: buildReplyLengthInstruction(replyLength, lang) })"))
check('没有把长度塞进 persona/buildSystemPrompt 参数', !/buildSystemPrompt\([^\n]*replyLength/.test(chatSrc))
check('Settings 关于 TA 有回复长度入口', settingsSrc.includes('label="回复长度"') && settingsSrc.includes('ReplyLengthDetail'))
check('三档 UI 都存在', settingsSrc.includes("value: 'short'") && settingsSrc.includes("value: 'medium'") && settingsSrc.includes("value: 'long'"))
check('Cloud State 注册 reply_length', cloudSrc.includes("registerCloudStateAdapter('reply_length'"))
check('Cloud queue 带 session scope', cloudSrc.includes("queue('reply_length', sessionId, { mode: value.mode }, false, sessionId)"))
check('删除角色会清 reply length', rolesSrc.includes('clearReplyLength(accountId, id)'))
check('splitAssistantReplies 签名未被回复长度污染', /export function splitAssistantReplies\(content: string, ts: number\)/.test(storeSrc))
check('拆泡仍维持原 60 目标', (storeSrc.match(/chunkText\([^\n]*, 60\)/g) || []).length >= 2)

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
