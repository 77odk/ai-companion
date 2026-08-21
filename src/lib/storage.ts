// 设置项与本地存储读写（Key 只存浏览器 localStorage，不经过任何服务器）

export type Provider = 'deepseek' | 'zhipu' | 'custom'

export interface ModelSettings {
  provider: Provider
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

function defaultSettings(): ModelSettings {
  return { provider: 'deepseek', apiKey: '', ...DEFAULT_SETTINGS.deepseek }
}

export function loadSettings(): ModelSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return defaultSettings()
    const parsed = JSON.parse(raw) as Partial<ModelSettings>
    const provider: Provider =
      parsed.provider === 'zhipu' || parsed.provider === 'custom' ? parsed.provider : 'deepseek'
    const defaults = DEFAULT_SETTINGS[provider]
    return {
      provider,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : defaults.baseUrl,
      model: typeof parsed.model === 'string' ? parsed.model : defaults.model,
    }
  } catch {
    return defaultSettings()
  }
}

export function saveSettings(settings: ModelSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
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
