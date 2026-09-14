// 已保存的服务商配置卡片：用户存过的配置一点即切换
// 和 API Key 一样，只存浏览器本地，不上任何服务器

import type { Provider } from './storage.ts'
import { PROVIDER_NAMES } from './storage.ts'

export interface SavedConfig {
  id: string
  name: string
  provider: Provider
  apiKey: string
  baseUrl: string
  model: string
  savedAt: number
}

const SAVED_KEY = 'ai_companion_saved_configs'
const MAX_SAVED = 12

function newId(): string {
  return `sc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** 默认名字：取地址的域名（去掉 api. 前缀）；地址还没填全就用服务商名 */
export function defaultConfigName(cfg: { provider: Provider; baseUrl: string }): string {
  try {
    const host = new URL(cfg.baseUrl.trim()).host
    if (host) return host.replace(/^www\./, '').replace(/^api\./, '')
  } catch {
    /* 地址还不完整，忽略 */
  }
  return PROVIDER_NAMES[cfg.provider]
}

export function loadSavedConfigs(): SavedConfig[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((x) => ({
        id: String(x.id || newId()),
        name: String(x.name || ''),
        provider: (typeof x.provider === 'string' ? x.provider : 'custom') as Provider,
        apiKey: String(x.apiKey || ''),
        baseUrl: String(x.baseUrl || ''),
        model: String(x.model || ''),
        savedAt: Number(x.savedAt) || Date.now(),
      }))
      .filter((x) => x.baseUrl || x.model)
      .slice(0, MAX_SAVED)
  } catch {
    return []
  }
}

/** 存一份配置：同一条（同 id 或 同服务商+地址+模型）覆盖更新，最新的排最前 */
export function saveConfig(cfg: {
  id?: string
  name: string
  provider: Provider
  apiKey: string
  baseUrl: string
  model: string
}): SavedConfig[] {
  const list = loadSavedConfigs()
  const sig = `${cfg.provider}|${cfg.baseUrl.trim()}|${cfg.model.trim()}`
  const dup = list.find(
    (x) => (!!cfg.id && x.id === cfg.id) || `${x.provider}|${x.baseUrl.trim()}|${x.model.trim()}` === sig,
  )
  const next: SavedConfig = {
    id: dup ? dup.id : newId(),
    name: (cfg.name.trim() || defaultConfigName(cfg)).slice(0, 20),
    provider: cfg.provider,
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl.trim(),
    model: cfg.model.trim(),
    savedAt: Date.now(),
  }
  const result = [next, ...list.filter((x) => x.id !== next.id)].slice(0, MAX_SAVED)
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(result))
  } catch {
    /* 隐私模式/存满：静默失败，不影响主流程 */
  }
  return result
}

export function removeConfig(id: string): SavedConfig[] {
  const result = loadSavedConfigs().filter((x) => x.id !== id)
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(result))
  } catch {
    /* 忽略 */
  }
  return result
}

/** 当前填着的配置，是不是就指向这张卡（用来标「使用中」） */
export function isActiveConfig(
  cur: { provider: Provider; baseUrl: string; model: string },
  card: SavedConfig,
): boolean {
  return (
    cur.provider === card.provider &&
    cur.baseUrl.trim() === card.baseUrl.trim() &&
    cur.model.trim() === card.model.trim()
  )
}
