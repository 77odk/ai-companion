// 性别「选一次锁定」测试（2026-09-14 七七拍板）
// 覆盖：
//   1. 老格式裸值 = 未锁定（旧角色给一次修改机会）
//   2. 选定后锁定；unknown 不锁（还没选）
//   3. 角色隔离：A 锁定不影响 B；看 A 的资料卡不再串到 B
//   4. 不再有全局副作用：写 A 不会把性别串给所有没自己记录的角色
//   6. 无会话（游客）→ 落全局兜底，全局也可锁定
//   7. 老全局裸值迁移到默认角色（幂等）
//   8. 新格式 JSON 与老格式混读兼容；损坏值降级 unknown 不崩

import { loadAIGender, loadAIGenderState, saveAIGender, collectAllGenders, applyCloudGenders } from '../src/lib/storage.ts'

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

const GKEY = 'ai_companion_ai_gender'
const SESSIONS = 'ai_companion_sessions_cache'
const reset = () => memStore.clear()

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log('  ok - ' + name + (detail ? '  | ' + detail : '')) }
  else { failed++; console.log('  FAIL - ' + name + (detail ? '  | ' + detail : '')) }
}

console.log('[1] 老格式（裸值）= 未锁定，旧角色给一次机会')
reset()
localStorage.setItem(`${GKEY}_1001`, 'male')
let st = loadAIGenderState('1001')
check('裸值可读', st.gender === 'male', JSON.stringify(st))
check('own = true（该角色自己有记录）', st.own === true)
check('locked = false（旧数据不锁，给一次机会）', st.locked === false)

console.log('[2] 选定后锁定；unknown 不锁')
saveAIGender('female', '1001')
st = loadAIGenderState('1001')
check('选定 → female', st.gender === 'female')
check('选定 → locked = true', st.locked === true)
saveAIGender('unknown', '1002')
st = loadAIGenderState('1002')
check('unknown 不算选定（locked = false，仍可再选）', st.gender === 'unknown' && st.locked === false, JSON.stringify(st))

console.log('[3] 角色隔离：锁 A 不影响 B')
reset()
saveAIGender('male', '1001')
const a = loadAIGenderState('1001')
const b = loadAIGenderState('1002')
check('A 锁定 = male', a.gender === 'male' && a.locked === true)
check('B 不受影响（无自己记录 → own=false、locked=false）', b.own === false && b.locked === false && b.gender === 'unknown', JSON.stringify(b))

console.log('[4] 无全局副作用（2026-09-14 根因修复）')
check('写 A 之后全局 key 仍为空（不再串给所有人）', localStorage.getItem(GKEY) == null, String(localStorage.getItem(GKEY)))
saveAIGender('female', '1002')
const b2 = loadAIGenderState('1002')
const a2 = loadAIGenderState('1001')
check('B 选 female 后 B = female/locked', b2.gender === 'female' && b2.locked === true)
check('A 仍是自己的 male（没被 B 串掉）', a2.gender === 'male' && a2.locked === true, JSON.stringify(a2))

console.log('[5] 无会话（游客）→ 全局兜底，且全局可锁定')
reset()
saveAIGender('male')
const g = loadAIGenderState()
check('无会话读全局 = male / locked', g.gender === 'male' && g.locked === true, JSON.stringify(g))
check('无会话时 loadAIGender 同值', loadAIGender() === 'male')

console.log('[6] 老全局裸值迁移到默认角色（幂等）')
reset()
localStorage.setItem(SESSIONS, JSON.stringify([{ id: 1001, title: '饺子' }]))
localStorage.setItem(GKEY, 'female')
const migrated = loadAIGenderState('1001')
check('默认角色拿到老全局值', migrated.gender === 'female', JSON.stringify(migrated))
check('迁过去的仍是未锁（给一次机会）', migrated.locked === false)
check('全局 key 保留兜底', localStorage.getItem(GKEY) === 'female')
check('迁移幂等（再读一次不重复写坏）', loadAIGenderState('1001').gender === 'female')

console.log('[7] 格式兼容与容错')
reset()
localStorage.setItem(`${GKEY}_1001`, JSON.stringify({ g: 'male', locked: true }))
check('新格式 JSON 可读且锁定', loadAIGenderState('1001').locked === true)
localStorage.setItem(`${GKEY}_1002`, JSON.stringify({ gender: 'female', locked: false }))
check('JSON 字段名兼容（gender/locked）', loadAIGenderState('1002').gender === 'female')
localStorage.setItem(`${GKEY}_1003`, '{"g":"??","locked":true}')
check('非法值降级 unknown 不崩', loadAIGenderState('1003').gender === 'unknown')
localStorage.setItem(`${GKEY}_1004`, 'not-json{{{')
check('损坏值降级 unknown 不崩', loadAIGenderState('1004').gender === 'unknown' && loadAIGenderState('1004').locked === false)

console.log('[8] 云同步：收集本机性别（各角色 + __global 兜底）')
reset()
saveAIGender('male', '1001')
saveAIGender('female', '1002')
saveAIGender('female')
const collected = collectAllGenders()
check('收集到两个角色 + 全局兜底', Object.keys(collected).length === 3 && collected['1001'].g === 'male' && collected['1002'].g === 'female' && collected.__global.g === 'female', JSON.stringify(collected))
check('收集值带 locked', collected['1001']?.locked === true)

console.log('[9] 云同步：应用云端性别（只增不改）')
reset()
localStorage.setItem(SESSIONS, JSON.stringify([{ id: 1001, title: '饺子' }]))
applyCloudGenders({ '1001': { g: 'male', locked: true }, '1002': { g: 'female', locked: true }, __global: { g: 'male', locked: true } })
check('本机没有 → 用云端的（新设备首次登录）', loadAIGenderState('1001').gender === 'male' && loadAIGenderState('1001').locked === true)
check('另一个角色也带回锁定态', loadAIGenderState('1002').gender === 'female' && loadAIGenderState('1002').locked === true)
check('游客兜底（__global）也带回', loadAIGenderState().gender === 'male')
// 本地未锁 + 云端锁 → 用云端
reset()
localStorage.setItem(`${GKEY}_1001`, 'female') // 老格式裸值 = 未锁
applyCloudGenders({ '1001': { g: 'male', locked: true } })
check('本地未锁、云端锁定 → 用云端那份', loadAIGenderState('1001').gender === 'male' && loadAIGenderState('1001').locked === true)
// 本地已锁 → 不动
reset()
saveAIGender('female', '1001')
applyCloudGenders({ '1001': { g: 'male', locked: true } })
check('本地已锁定 → 云端不覆盖（选好的不会被改）', loadAIGenderState('1001').gender === 'female')
// 脏数据跳过、不误删
reset()
saveAIGender('male', '1001')
applyCloudGenders({ '1002': { g: 'unknown', locked: true }, '1003': { g: '???' }, '1004': null })
check('unknown / 脏数据一律跳过', loadAIGenderState('1002').gender === 'unknown' && loadAIGenderState('1003').gender === 'unknown')
check('跳过时不动本地已有记录', loadAIGenderState('1001').gender === 'male')
applyCloudGenders(null)
check('云端没有这个字段（旧 blob）→ 安全跳过', loadAIGenderState('1001').gender === 'male')

console.log('[10] 静态检查：sync 全量 blob 真的带上了性别')
const fs = await import('node:fs')
const syncSrc = fs.readFileSync(new URL('../src/lib/sync.ts', import.meta.url), 'utf8')
check('collectData 带 genders', /genders:\s*collectAllGenders\(\)/.test(syncSrc))
check('applyData 调 applyCloudGenders', /applyCloudGenders\(d\.genders\)/.test(syncSrc))
check('SyncData 声明 genders 可选字段', /genders\?:\s*Record<string,\s*\{\s*g:\s*AIGender;\s*locked:\s*boolean\s*\}>/.test(syncSrc))

console.log(`\n结果：${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
