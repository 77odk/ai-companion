// UI2-02 · Navigation Closure：Visit State（导航生命周期状态）
//
// 职责只允许包含：
//   · boot/session marker（同会话已初始化标记，保留旧 key，向后兼容）
//   · lastActiveAt（距上次活跃时间；fresh visit 判定 = 超过 VISIT_INACTIVE_MS）
//   · lastPrimaryView（最后的主视图，只允许 home / aispace / memory / settings）
//   · 当前会话的 Welcome 标记（登录用户在 Welcome 刷新仍停留 Welcome）
//
// 明确不持有：auth / consent / session / role / chat / sync 任何数据。
// 本模块不参与权限判定；登录墙 / 同意门仍由 App 的 gateShown 逻辑独立决定。
//
// key 沿用项目既有命名习惯：
//   eluvin_boot_seen        （sessionStorage，旧逻辑已存在，保留写入与读取）
//   eluvin_last_visit_at    （localStorage，旧逻辑已存在，避免迁移）
//   eluvin_last_primary_view（localStorage，新增；纯 UI 导航状态，不属数据层）
//   eluvin_visit_view       （sessionStorage，新增；仅用于 Welcome 刷新保持 Welcome）

export const PRIMARY_VIEWS = ['home', 'aispace', 'memory', 'settings'] as const
export type PrimaryView = (typeof PRIMARY_VIEWS)[number]

/** 沿用现有 6 小时阈值（不重新设计） */
export const VISIT_INACTIVE_MS = 6 * 60 * 60 * 1000

const BOOT_KEY = 'eluvin_boot_seen'
const LAST_ACTIVE_KEY = 'eluvin_last_visit_at'
const LAST_PRIMARY_KEY = 'eluvin_last_primary_view'
const VISIT_VIEW_KEY = 'eluvin_visit_view'

type Area = 'local' | 'session'

function store(area: Area): Storage | null {
  try {
    return area === 'local' ? localStorage : sessionStorage
  } catch {
    return null
  }
}

function getItem(k: string, area: Area): string | null {
  const s = store(area)
  if (!s) return null
  try {
    return s.getItem(k)
  } catch {
    return null
  }
}

function setItem(k: string, v: string, area: Area): void {
  const s = store(area)
  if (!s) return
  try {
    s.setItem(k, v)
  } catch {
    // 隐私模式等不可写时静默失败（App 已按读不到处理）
  }
}

function removeItem(k: string, area: Area): void {
  const s = store(area)
  if (!s) return
  try {
    s.removeItem(k)
  } catch {
    // 忽略
  }
}

/** 同会话已初始化的 boot marker（兼容旧逻辑；新判定不依赖它，仅保留写读语义） */
export function markBootSeen(): void {
  setItem(BOOT_KEY, '1', 'session')
}

/** 上次活跃时间戳（ms）；无记录返回 0 */
export function readLastActiveAt(): number {
  const raw = getItem(LAST_ACTIVE_KEY, 'local')
  if (!raw) return 0
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 记录本次活跃（进入 App 时调用一次） */
export function touchLastActiveAt(): void {
  setItem(LAST_ACTIVE_KEY, String(Date.now()), 'local')
}

/**
 * 进入时是否应显示 Welcome（fresh visit）。
 * 产品定义：lastActiveAt 超过 6 小时；无记录视为 fresh。
 * 副作用：更新 lastActiveAt + 写 boot marker（与旧 decideBoot 语义一致，先读后写）。
 */
export function shouldShowWelcomeOnEntry(): boolean {
  const last = readLastActiveAt()
  const fresh = !last || Date.now() - last > VISIT_INACTIVE_MS
  touchLastActiveAt()
  markBootSeen()
  return fresh
}

/** 是否主视图（Bottom Nav 只属于 home/aispace/memory/settings） */
export function isPrimaryView(v: string): v is PrimaryView {
  return (PRIMARY_VIEWS as readonly string[]).includes(v)
}

/** 记录最后的主视图（每次成功进入 Primary view 时调用；绝不写入 Secondary view） */
export function markPrimaryView(v: PrimaryView): void {
  setItem(LAST_PRIMARY_KEY, v, 'local')
}

/** 读取最后的主视图；无记录 / 非法值（含被手改的 chat/welcome 等）返回 null，由调用方 fallback home */
export function getLastPrimaryView(): PrimaryView | null {
  const v = getItem(LAST_PRIMARY_KEY, 'local')
  return v && isPrimaryView(v) ? v : null
}

/** 当前会话是否正停留在 Welcome（Welcome 刷新保持 Welcome 的关键） */
export function isVisitWelcome(): boolean {
  return getItem(VISIT_VIEW_KEY, 'session') === 'welcome'
}

/** 进入 Welcome 时标记（刷新后仍 Welcome） */
export function markVisitWelcome(): void {
  setItem(VISIT_VIEW_KEY, 'welcome', 'session')
}

/** 离开 Welcome（点「开始遇见 TA」/进入其他页）时清除 */
export function clearVisitWelcome(): void {
  removeItem(VISIT_VIEW_KEY, 'session')
}
