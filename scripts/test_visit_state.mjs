// UI2-02 · Navigation Closure 单测：Visit State（fresh 判定 / lastPrimaryView 白名单 / Welcome visit marker / storage 异常静默）
// 运行：node scripts/test_visit_state.mjs（npm test 会一并执行）
import {
  PRIMARY_VIEWS,
  VISIT_INACTIVE_MS,
  clearVisitWelcome,
  getLastPrimaryView,
  isPrimaryView,
  isVisitWelcome,
  markBootSeen,
  markPrimaryView,
  markVisitWelcome,
  readLastActiveAt,
  shouldShowWelcomeOnEntry,
  touchLastActiveAt,
} from '../src/lib/visitState.ts'

let pass = 0
let fail = 0
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
  } else {
    fail++
    console.log(`  ✗ ${msg}\n    期望 ${e}\n    实际 ${a}`)
  }
}
function ok(cond, msg) {
  if (cond) pass++
  else {
    fail++
    console.log(`  ✗ ${msg}`)
  }
}
function group(name) {
  console.log(`\n== ${name} ==`)
}

// ---- 内存版 localStorage / sessionStorage（node 无浏览器 storage）----
function memStore() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  }
}
function resetStores() {
  globalThis.localStorage = memStore()
  globalThis.sessionStorage = memStore()
}

group('fresh visit 判定（lastActiveAt 超 6h = fresh）')
{
  resetStores()
  // 1. 无任何记录 → fresh
  ok(shouldShowWelcomeOnEntry() === true, '无记录 → 显示 Welcome')
  // 2. 刚写过的 lastActiveAt 存在
  ok(readLastActiveAt() > 0, '首次判定后写入 lastActiveAt')
  // 3. boot marker 已写（旧 key 兼容保留）
  eq(sessionStorage.getItem('eluvin_boot_seen'), '1', 'boot marker 写入')
  // 4. 短间隔再次 → 不 fresh
  ok(shouldShowWelcomeOnEntry() === false, '短间隔再次 → 不显示 Welcome')
  // 5. 手工把 lastActiveAt 拨到 7 小时前 → 又 fresh
  localStorage.setItem('eluvin_last_visit_at', String(Date.now() - 7 * 60 * 60 * 1000))
  ok(shouldShowWelcomeOnEntry() === true, '超过 6h → 重新显示 Welcome')
}

group('lastPrimaryView 白名单（只允许 4 个主视图）')
{
  resetStores()
  // 6. 合法主视图写入/读取
  for (const v of PRIMARY_VIEWS) {
    markPrimaryView(v)
    eq(getLastPrimaryView(), v, `mark/get ${v}`)
  }
  // 7. isPrimaryView 边界
  ok(isPrimaryView('home') && isPrimaryView('settings'), 'home/settings 是主视图')
  ok(!isPrimaryView('chat') && !isPrimaryView('welcome') && !isPrimaryView('role'), 'chat/welcome/role 不是主视图')
  ok(!isPrimaryView('weekly') && !isPrimaryView('chatprofile'), 'weekly/chatprofile 不是主视图')
  // 8. 非法值（手改 localStorage）→ null（fallback home）
  localStorage.setItem('eluvin_last_primary_view', 'chat')
  eq(getLastPrimaryView(), null, '手改 chat → null')
  localStorage.setItem('eluvin_last_primary_view', 'garbage')
  eq(getLastPrimaryView(), null, '手改垃圾值 → null')
  localStorage.setItem('eluvin_last_primary_view', '')
  eq(getLastPrimaryView(), null, '空字符串 → null')
}

group('Welcome visit marker（Welcome 刷新保持 Welcome）')
{
  resetStores()
  // 9. 初始无标记
  ok(isVisitWelcome() === false, '初始无 visit marker')
  // 10. 进入 Welcome 标记
  markVisitWelcome()
  ok(isVisitWelcome() === true, '标记后 isVisitWelcome=true')
  // 11. 离开 Welcome 清除
  clearVisitWelcome()
  ok(isVisitWelcome() === false, '清除后 false')
  // 12. 标记存在 + lastActiveAt 很新（<6h）→ fresh 判定仍 false，
  //     但 App 层用 isVisitWelcome() 兜住 Welcome 刷新（此处验证二者互不干扰）
  markVisitWelcome()
  touchLastActiveAt() // 前面组把 lastActiveAt 拨到 7h 前，这里恢复为"刚活跃"，避免状态泄漏
  ok(shouldShowWelcomeOnEntry() === false, '短间隔 + visit marker → fresh=false（Welcome 由 marker 保持）')
  ok(isVisitWelcome() === true, 'marker 不被 fresh 判定清掉')
}

group('touchLastActiveAt / markBootSeen 幂等')
{
  resetStores()
  touchLastActiveAt()
  const t1 = readLastActiveAt()
  ok(t1 > 0, 'touch 写入时间戳')
  markBootSeen()
  markBootSeen()
  eq(sessionStorage.getItem('eluvin_boot_seen'), '1', 'markBootSeen 幂等')
  // 13. VISIT_INACTIVE_MS 常量 = 6h
  eq(VISIT_INACTIVE_MS, 6 * 60 * 60 * 1000, '阈值保持 6 小时')
}

group('storage 异常静默（隐私模式等）')
{
  // 14. getItem 抛错 → 读不到按无记录处理
  resetStores()
  globalThis.localStorage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') }, removeItem: () => { throw new Error('denied') } }
  globalThis.sessionStorage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') }, removeItem: () => { throw new Error('denied') } }
  try {
    ok(shouldShowWelcomeOnEntry() === true, 'storage 不可用 → 视为 fresh（不抛异常）')
    eq(getLastPrimaryView(), null, 'storage 不可用 → lastPrimaryView null')
    ok(isVisitWelcome() === false, 'storage 不可用 → visit marker false')
    markPrimaryView('home')
    markVisitWelcome()
    ok(true, '写入路径不抛异常')
  } catch (e) {
    fail++
    console.log(`  ✗ storage 异常静默失败: ${e}`)
  }
}

console.log(`\nvisit_state: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
