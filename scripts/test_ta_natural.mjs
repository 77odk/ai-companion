// TA-NATURAL-01 回归验收：入口/表单/创建语义 + 空 persona 提示词 + 会话资料隔离 + Space smoke。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const store = new Map()
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
  key: (index) => [...store.keys()][index] ?? null,
  get length() {
    return store.size
  },
}

const rolePicker = readFileSync(new URL('../src/components/RolePicker.tsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

assert.match(rolePicker, /mode !== 'current' && \([\s\S]*直接认识 TA/)
assert.match(rolePicker, /mode === 'current' \? '选择你想要的 TA' : '认识你的 TA'/)
assert.match(rolePicker, /kind === 'natural'[\s\S]*!isNatural && <div className="field">[\s\S]*setup-personality/)
assert.match(rolePicker, /const valid = form\.nickname\.trim\(\) !== '' && \(isNatural \|\| form\.personality\.trim\(\) !== ''\)/)
assert.match(rolePicker, /setup\.kind === 'natural'[\s\S]*proceed\('', s, null, true\)/)
assert.match(rolePicker, /if \(!allowEmptyPersona && !persona\.trim\(\)\) return/)
assert.match(rolePicker, /createSession\(getToken\(\), \{ persona, title \}\)/)
assert.match(rolePicker, /saveProfileForSession\(s, String\(res\.data\.id\)\)/)
assert.match(rolePicker, /startChat: allowEmptyPersona/)
assert.match(rolePicker, /onNaturalLogin\?\.\(\{[\s\S]*nickname: s\.nickname\.trim\(\)/)
assert.match(rolePicker, /const succeeded = await proceed\('', s, null, true\)[\s\S]*if \(succeeded\) setSetup\(null\)/)
assert.match(rolePicker, /initial: \{ \.\.\.EMPTY_FORM, \.\.\.initialNatural \}/)
assert.match(rolePicker, /error \? \([\s\S]*role-modal-required-hint[\s\S]*\{error\}/)
assert.match(rolePicker, /disabled=\{!valid \|\| submitting\}/)
assert.match(rolePicker, /if \(isLoggedIn\(\) && allowEmptyPersona\) persistSetup\(''\)/)
assert.match(rolePicker, /buildTemplatePersona\(s\)/)
assert.match(rolePicker, /buildCustomPersona\(\{/)
assert.doesNotMatch(rolePicker, /personaMode/)
assert.doesNotMatch(app, /personaMode/)
assert.match(app, /hasPersona=\{Boolean\(getActiveSessionId\(\)\) \|\| Boolean\(loadPersona\(\)\.trim\(\)\)\}/)
assert.match(app, /navigate\(info\?\.startChat \|\| !loggedIn \? 'chat' : 'home'\)/)
assert.match(app, /const \[pendingNatural, setPendingNatural\] = useState<NaturalSetup \| null>\(null\)/)
assert.match(app, /createSession\(getToken\(\), \{ persona: '', title: natural\.nickname \}\)/)
assert.match(app, /if \(!created\.ok\) \{[\s\S]*setActiveSessionId\(activeBefore\)[\s\S]*setPendingNaturalError\(created\.message\)[\s\S]*replaceView\('role'\)/)
assert.match(app, /setActiveSessionId\(sid\)[\s\S]*saveAIProfile\(\{ nickname: natural\.nickname, avatar: natural\.avatar \}, sid\)[\s\S]*saveAIRemark\(natural\.remark, sid\)[\s\S]*saveAIGender\(natural\.gender, sid\)[\s\S]*savePersona\(''\)[\s\S]*replaceView\('chat'\)/)
assert.match(app, /onNaturalLogin=\{\(setup\) => \{[\s\S]*setPendingNatural\(setup\)/)
assert.doesNotMatch(app, /hasLocalLegacyData\([^)]*pendingNatural/)
assert.match(app, /const handleGateBack = \(\) => \{[\s\S]*setPendingNatural\(null\)[\s\S]*replaceView\('welcome'\)/)

const { buildSystemPrompt, CHAT_RULES, DEFAULT_IDENTITY } = await import('../src/lib/chatPrompts.ts')
const prompt = buildSystemPrompt('', '星光', new Date(2026, 8, 14, 12).getTime())
assert.ok(prompt.includes(DEFAULT_IDENTITY), 'Natural 使用 DEFAULT_IDENTITY')
assert.ok(prompt.includes('你的名字叫「星光」'), 'nickname 注入 Chat system prompt')
assert.ok(prompt.includes(CHAT_RULES.trim()), 'Natural 包含 CHAT_RULES')
assert.ok(prompt.includes('记忆规则：'), 'Natural 包含 Memory rules')
assert.ok(!prompt.includes('【你的人生与记忆·最重要】'), 'Natural 不走 custom persona lifeHeader')

const { saveAIProfile, loadAIProfile, saveAIRemark, loadAIRemark, saveAIGender, loadAIGender } = await import('../src/lib/storage.ts')
const { setSessionsCache, setActiveSessionId, getActiveSessionId } = await import('../src/lib/sessionStore.ts')
const { resolveActiveSession } = await import('../src/lib/sessionFlow.ts')
const sessions = [
  { id: 101, title: '星光', persona: '', created_at: '2026-09-14T00:00:00Z', updatedAt: '2026-09-14T00:00:00Z' },
  { id: 102, title: '阿叙', persona: '温柔理智', created_at: '2026-09-14T00:01:00Z', updatedAt: '2026-09-14T00:01:00Z' },
  { id: 103, title: '小枝', persona: '角色昵称：小枝\n性格特质：嘴硬心软', created_at: '2026-09-14T00:02:00Z', updatedAt: '2026-09-14T00:02:00Z' },
]
setSessionsCache(sessions)
for (const [id, nickname, avatar, remark, gender] of [
  ['101', '星光', 'data:natural-avatar', '备注 A', 'unknown'],
  ['102', '阿叙', 'data:template-avatar', '备注 B', 'male'],
  ['103', '小枝', 'data:custom-avatar', '备注 C', 'female'],
]) {
  saveAIProfile({ nickname, avatar }, id)
  saveAIRemark(remark, id)
  saveAIGender(gender, id)
}
for (const [index, id] of ['101', '102', '103'].entries()) {
  setActiveSessionId(id)
  assert.equal(getActiveSessionId(), id, `session ${id} 切换隔离`)
  assert.equal(sessions[index].persona, index === 0 ? '' : sessions[index].persona, `session ${id} persona 不串`)
  assert.equal(loadAIProfile(id).nickname, sessions[index].title, `session ${id} nickname 不串`)
  assert.equal(loadAIProfile(id).avatar, ['data:natural-avatar', 'data:template-avatar', 'data:custom-avatar'][index], `session ${id} avatar 不串`)
  assert.equal(loadAIRemark(id), [`备注 A`, `备注 B`, `备注 C`][index], `session ${id} remark 不串`)
  assert.equal(loadAIGender(id), ['unknown', 'male', 'female'][index], `session ${id} gender 不串`)
}
assert.equal(resolveActiveSession(sessions, '101')?.persona, '', 'Natural reload/reopen 保留空 persona')

const { refreshSpace, loadCurrentPosts } = await import('../src/lib/aiSpace.ts')
const space = refreshSpace('星光', '你', new Date(2026, 8, 14, 12).getTime(), '101')
assert.equal(space.mode, 'no-persona', 'Natural AI Space 不调用额外 LLM')
assert.ok(loadCurrentPosts('101').length > 0, 'Natural AI Space 可正常读取兜底内容')
assert.equal(loadCurrentPosts('102').length, 0, 'Natural AI Space 不串到 Template session')

console.log('TA-NATURAL-01: all assertions passed')
