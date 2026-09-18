// 角色资料（昵称/头像）云同步 + 不再借用别人的资料（2026-09-18 七七拍板）
// 病根：新角色在手机上建好，电脑上取不到资料 → 旧规则回落全局那份（老角色「饺子」）
//       于是电脑上打开新角色，名字和头像都是饺子的。
// 覆盖：
//   1. 会话没有自己的资料 → 回落空资料，绝不借用全局那份
//   2. 会话有自己的资料 → 用自己的（不串）
//   3. collectAllAIProfiles 仍按角色汇总（含 _global）
//   4. 静态检查：Cloud State 注册了 profile 适配器、capture 挂在数据变化上、
//      apply/delete 按实体 id 落到该角色自己的 key；回落分支不再读全局
// 跑法：node scripts/test_profile_cloud_sync.mjs

import { loadAIProfile, saveAIProfile, collectAllAIProfiles } from '../src/lib/storage.ts'
import { readFileSync } from 'node:fs'

const memStore = new Map()
globalThis.localStorage = {
  get length() { return memStore.size },
  key: (i) => [...memStore.keys()][i] ?? null,
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: (k) => memStore.delete(k),
  clear: () => memStore.clear(),
}
globalThis.window = { dispatchEvent: () => {} }

const PROFILE_KEY = 'ai_companion_ai_profile'
const SESSIONS = 'ai_companion_sessions_cache'
const JIAOZI_AVATAR = 'data:image/jpeg;base64,AAAA'
const reset = () => memStore.clear()

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' → ' + detail : ''}`) }
}

console.log('[1] 会话没有自己的资料：回落空资料，不借用全局那份')
reset()
localStorage.setItem(PROFILE_KEY, JSON.stringify({ nickname: '饺子', avatar: JIAOZI_AVATAR }))
localStorage.setItem(SESSIONS, JSON.stringify([{ id: 69, title: '黎深' }]))
const fresh = loadAIProfile('69')
check('昵称不是全局那份（不显示饺子）', fresh.nickname !== '饺子', `得到 ${fresh.nickname}`)
check('头像是空的（不显示饺子的照片）', fresh.avatar === '', `得到 ${fresh.avatar.slice(0, 24)}`)
check('回落到默认资料 TA', fresh.nickname === 'TA' && fresh.avatar === '')
check('全局那份还在（老会话/无会话仍然用得到）', loadAIProfile().nickname === '饺子')
check('全局那份头像没被动', loadAIProfile().avatar === JIAOZI_AVATAR)

console.log('\n[2] 会话有自己的资料：用自己的')
saveAIProfile({ nickname: '黎深', avatar: 'data:image/png;base64,BBBB' }, '69')
const own = loadAIProfile('69')
check('昵称是自己的', own.nickname === '黎深')
check('头像是自己的', own.avatar === 'data:image/png;base64,BBBB')

console.log('\n[3] 按角色汇总（云同步采集）')
const all = collectAllAIProfiles()
check('含全局那份 _global', all._global?.nickname === '饺子')
check('含各角色自己那份', all['69']?.nickname === '黎深')
check('不会把全局那份塞给没有资料的角色', !all['70'])

console.log('\n[4] 源码契约（静态检查）')
const src = readFileSync(new URL('../src/lib/cloudStateResources.ts', import.meta.url), 'utf8')
const storageSrc = readFileSync(new URL('../src/lib/storage.ts', import.meta.url), 'utf8')
check('注册了 profile 适配器', src.includes("registerCloudStateAdapter('profile'"))
check('capture 挂在数据变化事件上', src.includes('addEventListener(ELUVIN_DATA_CHANGE, captureAiProfiles)'))
check('切换账号会重置资料快照', /ELUVIN_AUTH_CHANGE[\s\S]{0,220}resetProfileSnapshot\(\)/.test(src))
check('apply 写该角色自己的 key', src.includes('localStorage.setItem(aiProfileStorageKey(entity.entityId), JSON.stringify(value))'))
check('delete 只删该角色那份', src.includes('localStorage.removeItem(aiProfileStorageKey(entity.entityId))'))
check('会话实体带 session 作用域', /queue\('profile', entityId, value, false, entityId === GLOBAL \? undefined : entityId\)/.test(src))
check('只认 data: 开头的头像（防脏值）', src.includes("startsWith('data:')"))
const fallbackBlock = storageSrc.slice(storageSrc.indexOf('export function loadAIProfile'), storageSrc.indexOf('export function loadAIProfile') + 700)
check('回落分支不再读全局资料', !fallbackBlock.includes('normalizeAIProfile(localStorage.getItem(AI_PROFILE_KEY))'))
check('回落分支返回默认资料', fallbackBlock.includes('return DEFAULT_AI_PROFILE'))

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
