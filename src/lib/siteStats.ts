// 站点访问统计（第一方，2026-09-21 起替代第三方脚本）
//
// 为什么自己数：第三方统计脚本和忆文自己的代码拥有同一个页面的权限，而 token / 用户模型 key /
// 聊天记忆都存在同源 localStorage 里——一旦那支脚本被劫持或域名失控就具备读取能力。
// 现在改成打我们自己的后端：不加载任何第三方 JS。
//
// 隐私口径：后端只存「日期 + 访问者哈希 + 每日 pv/uv 计数」，不存 IP、不存 UA、不存原始 id；
// 访问者标识是服务端下发的 HttpOnly Cookie（前端根本读不到，也不落任何 localStorage key）。

const HIT_PATH = '/api/hit'
const STATS_PATH = '/api/site-stats'

export interface SiteStats {
  pv: number
  uv: number
  todayPv: number
  todayUv: number
}

const OFFICIAL_FRONTEND_HOSTS = new Set(['eluvin.space'])
let siteHitSent = false

export function isOfficialFrontendHost(hostname?: string): boolean {
  const host = (hostname ?? (typeof location !== 'undefined' ? location.hostname : '')).trim().toLowerCase()
  return OFFICIAL_FRONTEND_HOSTS.has(host)
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

/** 每次页面加载最多报一次。只允许正式站写统计；失败静默，绝不影响使用。 */
export function pingSiteHit(apiBase: string): void {
  if (!isOfficialFrontendHost() || !apiBase || siteHitSent) return
  siteHitSent = true
  try {
    void fetch(`${apiBase}${HIT_PATH}`, {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => {})
  } catch {
    /* 忽略：统计失败不影响任何功能 */
  }
}

/** 读站点数字给欢迎页用；取不到返回 null（宁可不显示，也不显示 0 或假数字）。 */
export async function fetchSiteStats(apiBase: string): Promise<SiteStats | null> {
  if (!apiBase) return null
  try {
    const res = await fetch(`${apiBase}${STATS_PATH}`, { credentials: 'include' })
    if (!res.ok) return null
    const body = (await res.json()) as Record<string, unknown> | null
    if (!body) return null
    return {
      pv: toCount(body.pv),
      uv: toCount(body.uv),
      todayPv: toCount(body.todayPv),
      todayUv: toCount(body.todayUv),
    }
  } catch {
    return null
  }
}
