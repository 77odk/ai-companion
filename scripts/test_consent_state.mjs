// consentState 纯函数测试（2026-09-09 ConsentGate V1）
import { readLocalConsent, writeLocalConsent, consentNeeded, makeConsent, CURRENT_CONSENT_VERSION } from '../src/lib/consentState.ts'

let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✅', name) }
  else { fail++; console.log('  ❌', name, extra) }
}

// mock localStorage
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => { store.set(k, v) },
  removeItem: (k) => { store.delete(k) },
}

// 无记录 → 需要同意
ok('无记录 → consentNeeded=true', consentNeeded(null) === true)
// 记录版本 = 当前 → 不需要
ok('当前版本记录 → false', consentNeeded({ version: 'v1', consentedAt: '2026-09-09T00:00:00Z' }) === false)
// 旧版本记录 → 需要（改版重确认）
ok('旧版本记录(v0) → true', consentNeeded({ version: 'v0', consentedAt: '2026-09-01T00:00:00Z' }) === true)
// 未来版本（不可能但防御）→ 需要？语义：只有精确等于当前版本才算已同意
ok('未知版本(v9) → true', consentNeeded({ version: 'v9', consentedAt: '2026-09-09T00:00:00Z' }) === true)

// write + read 往返
writeLocalConsent()
const r1 = readLocalConsent()
ok('write 默认当前版本后能读回', r1 !== null && r1.version === CURRENT_CONSENT_VERSION && !!r1.consentedAt)
ok('写后 consentNeeded=false', consentNeeded(readLocalConsent()) === false)

// 写坏数据 → 读 null → 需要同意
store.set('eluvin_consent', '{broken json')
ok('损坏数据读 null', readLocalConsent() === null)
ok('损坏数据 → consentNeeded=true', consentNeeded(readLocalConsent()) === true)

// makeConsent
const mc = makeConsent('v2', '2026-01-01T00:00:00Z')
ok('makeConsent 精确值', mc.version === 'v2' && mc.consentedAt === '2026-01-01T00:00:00Z')
const mc2 = makeConsent()
ok('makeConsent 默认当前版本+自动时刻', mc2.version === CURRENT_CONSENT_VERSION && !!mc2.consentedAt)

console.log(`\nconsentState：${pass} 过 / ${fail} 败`)
process.exit(fail ? 1 : 0)
