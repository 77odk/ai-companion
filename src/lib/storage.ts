// 设置项与本地存储读写（Key 只存浏览器 localStorage，不经过任何服务器）
// v2: 每个服务商独立保存 key/base_url/model，切换服务商互不干扰

export type Provider = 'deepseek' | 'zhipu' | 'custom'

export interface ModelSettings {
  provider: Provider
  apiKey: string
  baseUrl: string
  model: string
}

export interface ProviderConfig {
  apiKey: string
  baseUrl: string
  model: string
}

const SETTINGS_KEY = 'ai_companion_settings'

/** 各服务商默认 base_url 与模型 */
export const DEFAULT_SETTINGS: Record<Provider, { baseUrl: string; model: string }> = {
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  custom: { baseUrl: '', model: 'gpt-4o-mini' },
}

/** 服务商显示名（用于提示文案） */
export const PROVIDER_NAMES: Record<Provider, string> = {
  deepseek: 'DeepSeek',
  zhipu: '智谱',
  custom: '自定义',
}

function defaultProviderConfig(p: Provider): ProviderConfig {
  return { apiKey: '', ...DEFAULT_SETTINGS[p] }
}

function defaultProviders(): Record<Provider, ProviderConfig> {
  return {
    deepseek: defaultProviderConfig('deepseek'),
    zhipu: defaultProviderConfig('zhipu'),
    custom: defaultProviderConfig('custom'),
  }
}

function normalizeProviders(raw: unknown): Record<Provider, ProviderConfig> {
  const base = defaultProviders()
  if (raw == null || typeof raw !== 'object') return base
  const r = raw as Record<string, Partial<ProviderConfig>>
  for (const p of ['deepseek', 'zhipu', 'custom'] as Provider[]) {
    const item = r[p]
    if (item == null || typeof item !== 'object') continue
    if (typeof item.apiKey === 'string') base[p].apiKey = item.apiKey
    if (typeof item.baseUrl === 'string') base[p].baseUrl = item.baseUrl
    if (typeof item.model === 'string') base[p].model = item.model
  }
  return base
}

/** 读取全部服务商的配置（含当前选中的服务商） */
export function loadSettings(): ModelSettings & { providers: Record<Provider, ProviderConfig> } {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { provider: 'deepseek', ...defaultProviderConfig('deepseek'), providers: defaultProviders() }
    const parsed = JSON.parse(raw) as {
      provider?: string
      providers?: unknown
      // 旧格式字段（v1 单 key 结构，迁移用）
      apiKey?: string
      baseUrl?: string
      model?: string
    }
    const provider: Provider =
      parsed.provider === 'zhipu' || parsed.provider === 'custom' ? parsed.provider : 'deepseek'
    const providers = normalizeProviders(parsed.providers)

    // 旧格式迁移：v1 存的单 key 归到当时的 provider 名下
    if (typeof parsed.apiKey === 'string' && parsed.apiKey && !providers[provider].apiKey) {
      providers[provider].apiKey = parsed.apiKey
    }
    if (typeof parsed.baseUrl === 'string' && parsed.baseUrl) {
      providers[provider].baseUrl = parsed.baseUrl
    }
    if (typeof parsed.model === 'string' && parsed.model) {
      providers[provider].model = parsed.model
    }

    return { provider, ...providers[provider], providers }
  } catch {
    return { provider: 'deepseek', ...defaultProviderConfig('deepseek'), providers: defaultProviders() }
  }
}

/** 保存当前服务商的配置（只更新当前槽位，其他服务商的 key 保留不动） */
export function saveSettings(settings: ModelSettings): void {
  const current = loadSettings()
  const providers = { ...current.providers, [settings.provider]: { ...current.providers[settings.provider] } }
  providers[settings.provider] = {
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl.trim() || DEFAULT_SETTINGS[settings.provider].baseUrl,
    model: settings.model.trim() || DEFAULT_SETTINGS[settings.provider].model,
  }
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ provider: settings.provider, providers }),
  )
}

// ---- 历史消息 ----

export interface StoredMessage {
  role: 'user' | 'assistant'
  content: string
  ts: number
}

const MESSAGES_KEY = 'ai_companion_messages'

/** 历史消息上限，超出丢最旧 */
export const MESSAGE_LIMIT = 50

export function loadMessages(): StoredMessage[] {
  try {
    const raw = localStorage.getItem(MESSAGES_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (m): m is StoredMessage =>
        m != null &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string',
    )
  } catch {
    return []
  }
}

export function saveMessages(messages: StoredMessage[]): void {
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages.slice(-MESSAGE_LIMIT)))
}
