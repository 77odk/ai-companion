// 设置项与本地存储读写（Key 只存浏览器 localStorage，不经过任何服务器）
// v2: 每个服务商独立保存 key/base_url/model，切换服务商互不干扰

import { pickFirstSeen } from './aiSpaceDetail.ts'
import { notifyDataChanged } from './dataChange.ts'
import type { SpacePost } from './aiSpaceCore'
import type { MemoryItem } from './memory'
import { getDefaultSessionId } from './sessionStore.ts'

export type Provider = 'deepseek' | 'zhipu' | 'openai' | 'custom' | 'volcengine'

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
  zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.7-flash' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  custom: { baseUrl: '', model: 'gpt-4o-mini' },
  volcengine: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-character-260628' },
}

/** 服务商显示名（用于提示文案） */
export const PROVIDER_NAMES: Record<Provider, string> = {
  deepseek: 'DeepSeek',
  zhipu: '智谱',
  openai: 'OpenAI',
  custom: '自定义',
  volcengine: '火山豆包',
}

function defaultProviderConfig(p: Provider): ProviderConfig {
  return { apiKey: '', ...DEFAULT_SETTINGS[p] }
}

function defaultProviders(): Record<Provider, ProviderConfig> {
  return {
    deepseek: defaultProviderConfig('deepseek'),
    zhipu: defaultProviderConfig('zhipu'),
    openai: defaultProviderConfig('openai'),
    custom: defaultProviderConfig('custom'),
    volcengine: defaultProviderConfig('volcengine'),
  }
}

function normalizeProviders(raw: unknown): Record<Provider, ProviderConfig> {
  const base = defaultProviders()
  if (raw == null || typeof raw !== 'object') return base
  const r = raw as Record<string, Partial<ProviderConfig>>
  for (const p of ['deepseek', 'zhipu', 'openai', 'custom', 'volcengine'] as Provider[]) {
    const item = r[p]
    if (item == null || typeof item !== 'object') continue
    if (typeof item.apiKey === 'string') base[p].apiKey = item.apiKey
    if (typeof item.baseUrl === 'string') base[p].baseUrl = item.baseUrl
    if (typeof item.model === 'string') base[p].model = item.model
    // 模型迁移：智谱旧免费模型 glm-4-flash → glm-4.7-flash（新模型守人设、执行能力强）
    if (p === 'zhipu' && base[p].model === 'glm-4-flash') {
      base[p].model = 'glm-4.7-flash'
    }
  }
  return base
}

/** 读取全部服务商的配置（含当前选中的服务商） */
export function loadSettings(): ModelSettings & { providers: Record<Provider, ProviderConfig> } {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { provider: 'zhipu', ...defaultProviderConfig('zhipu'), providers: defaultProviders() }
    const parsed = JSON.parse(raw) as {
      provider?: string
      providers?: unknown
      // 旧格式字段（v1 单 key 结构，迁移用）
      apiKey?: string
      baseUrl?: string
      model?: string
    }
    // 已有设置的旧用户保持原选择（含 deepseek）；只有存的是非法值时兜底到默认智谱
    const provider: Provider =
      parsed.provider === 'zhipu' ||
      parsed.provider === 'openai' ||
      parsed.provider === 'custom' ||
      parsed.provider === 'deepseek' ||
      parsed.provider === 'volcengine'
        ? parsed.provider
        : 'zhipu'
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
    return { provider: 'zhipu', ...defaultProviderConfig('zhipu'), providers: defaultProviders() }
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
  notifyDataChanged()
}

// ---- 历史消息 ----

export interface StoredMessage {
  role: 'user' | 'assistant'
  content: string
  ts: number
  /** 用户这条消息是否触发了记忆写入（TASK-LM1：显式指令保底写入成功标记；旧数据没有 = 不标） */
  memorySaved?: boolean
}

/** 用户气泡下「✅已帮你记下」反馈是否显示：仅用户消息且该条触发了记忆写入（TASK-LM2） */
export function shouldShowMemorySaved(m: StoredMessage): boolean {
  return m.role === 'user' && m.memorySaved === true
}

const MESSAGES_KEY = 'ai_companion_messages'

/**
 * 历史消息保留窗口（免费版）：60 天。
 * 商业化钩子：超过窗口的旧聊天记录会被裁剪，付费会员（9月云端同步上线后）=长期记忆+聊天记录永久保存。
 * 现在纯前端本地存储，所以只做时间窗口裁剪，不删本地已有数据（换设备/清缓存会丢，那是云同步的付费点）。
 */
export const MESSAGE_WINDOW_DAYS = 60

/** 历史消息条数硬上限，防止 localStorage 被撑爆（60天窗口内正常聊不到这个量） */
export const MESSAGE_LIMIT = 8000

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
  // 时间窗口裁剪：只保留最近 60 天的消息；超上限再丢最旧（双保险，防止 localStorage 撑爆）
  const cutoff = Date.now() - MESSAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const kept = messages.filter((m) => m.ts >= cutoff)
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(kept.slice(-MESSAGE_LIMIT)))
  notifyDataChanged()
}

// ---- 会话起点（刷新对话：TA 忘了之前聊的，聊天记录还在） ----

const SESSION_START_KEY = 'ai_companion_session_start'

/**
 * 会话起点时间戳：刷新对话 = 把起点设为当前时间，聊天页只显示/只发送起点之后的消息。
 * 没有设置过返回 0（= 不设起点，全部显示）。
 * 只影响「当前对话」的显示与发送，不删任何聊天记录——
 * 聊天记录页（TA 空间）读 loadMessages() 全量，不受 sessionStart 影响。
 */
export function getSessionStart(): number {
  try {
    const raw = localStorage.getItem(SESSION_START_KEY)
    if (!raw) return 0
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

export function setSessionStart(ts: number): void {
  localStorage.setItem(SESSION_START_KEY, String(ts))
}

// ---- 聊天背景（按会话隔离，2026-08-25 七七拍板：全屏对标微信） ----

const CHAT_BG_KEY = 'ai_companion_chat_bg'

function chatBgKey(sessionId?: string): string {
  return sessionId ? `${CHAT_BG_KEY}_${sessionId}` : CHAT_BG_KEY
}

/** 当前会话的聊天背景 dataURL；没设置返回空字符串（= 默认背景） */
export function loadChatBg(sessionId?: string): string {
  try {
    const raw = localStorage.getItem(chatBgKey(sessionId))
    if (!raw) return ''
    return raw.startsWith('data:image/') ? raw : ''
  } catch {
    return ''
  }
}

export function saveChatBg(dataUrl: string, sessionId?: string): void {
  localStorage.setItem(chatBgKey(sessionId), dataUrl)
  notifyDataChanged()
}

// ---- 专属人设 ----

const PERSONA_KEY = 'ai_companion_persona'

/** 读取用户自定义人设（没设置过返回空字符串 = 用默认人设） */
export function loadPersona(): string {
  try {
    return localStorage.getItem(PERSONA_KEY) ?? ''
  } catch {
    return ''
  }
}

export function savePersona(persona: string): void {
  localStorage.setItem(PERSONA_KEY, persona)
  notifyDataChanged()
}

// ---- 全局慢信笔友模式 ----
// 开启后：周记批阅强制封存，关闭即时回复，全部等 TA 下一篇周记回信（W1-2 定稿）。
// localStorage：'1' 开启 / '0' 关闭；读不到默认关闭。

export const SLOW_LETTER_KEY = 'ai_companion_slow_letter_mode'

/** 是否开启全局慢信笔友模式 */
export function isSlowLetterMode(): boolean {
  try {
    return localStorage.getItem(SLOW_LETTER_KEY) === '1'
  } catch {
    return false
  }
}

export function setSlowLetterMode(on: boolean): void {
  localStorage.setItem(SLOW_LETTER_KEY, on ? '1' : '0')
}

// ---- 我的资料（用户） ----
// avatar 只存 dataURL（上传图片压缩后），空字符串 = 用默认头像
// 旧版存的 emoji 头像已下线：读取时不是 dataURL 一律按默认头像处理

export interface UserProfile {
  nickname: string
  avatar: string
  bio: string
}

const USER_PROFILE_KEY = 'ai_companion_user_profile'

export const DEFAULT_USER_PROFILE: UserProfile = { nickname: '', avatar: '', bio: '' }

export function loadUserProfile(): UserProfile {
  try {
    const raw = localStorage.getItem(USER_PROFILE_KEY)
    if (!raw) return DEFAULT_USER_PROFILE
    const p = JSON.parse(raw) as Partial<UserProfile>
    return {
      nickname: typeof p.nickname === 'string' ? p.nickname : '',
      avatar: typeof p.avatar === 'string' && p.avatar.startsWith('data:') ? p.avatar : '',
      bio: typeof p.bio === 'string' ? p.bio : '',
    }
  } catch {
    return DEFAULT_USER_PROFILE
  }
}

export function saveUserProfile(p: UserProfile): void {
  localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(p))
  notifyDataChanged()
}

// ---- 我的 AI（角色资料） ----
// TASK-UI3 头像按角色隔离：每个会话（角色）存自己的头像/姓名到 ai_companion_ai_profile_<sid>，
// 改 A 不影响 B。无会话/无 sid 回落全局 key（ai_companion_ai_profile，兼容老数据）。
// 首次按会话读取时，老全局资料迁到「默认角色」（防丢，全局 key 保留作无会话兜底）。

export interface AIProfile {
  nickname: string
  avatar: string
}

const AI_PROFILE_KEY = 'ai_companion_ai_profile'
const AI_PROFILE_MIGRATED_KEY = 'ai_companion_ai_profile_migrated'

export const DEFAULT_AI_PROFILE: AIProfile = { nickname: 'TA', avatar: '' }

const aiProfileKey = (sessionId?: string): string =>
  sessionId ? `${AI_PROFILE_KEY}_${sessionId}` : AI_PROFILE_KEY

/** 首次按会话读取时，把老全局头像/姓名迁到「默认角色」（幂等；全局 key 保留，无会话兜底仍可读） */
function ensureSessionProfile(_sessionId: string): void {
  try {
    if (localStorage.getItem(AI_PROFILE_MIGRATED_KEY) != null) return
    const defaultSid = getDefaultSessionId()
    if (!defaultSid) return
    const raw = localStorage.getItem(AI_PROFILE_KEY)
    if (raw == null) return
    if (localStorage.getItem(aiProfileKey(defaultSid)) == null) {
      localStorage.setItem(aiProfileKey(defaultSid), raw)
    }
    localStorage.setItem(AI_PROFILE_MIGRATED_KEY, '1')
  } catch {
    // 迁移失败不阻塞：全局 key 仍可读，下次再试
  }
}

function normalizeAIProfile(raw: string | null): AIProfile {
  if (!raw) return DEFAULT_AI_PROFILE
  const p = JSON.parse(raw) as Partial<AIProfile>
  return {
    nickname: typeof p.nickname === 'string' && p.nickname ? p.nickname : 'TA',
    avatar: typeof p.avatar === 'string' && p.avatar.startsWith('data:') ? p.avatar : '',
  }
}

/**
 * 读取 TA 资料（会话感知）：有 sessionId → 读会话 key；该会话没自己的资料 → 回落全局 key（兼容老数据）；
 * 无 sessionId → 读全局 key。数据损坏/格式不对返回默认值。
 */
export function loadAIProfile(sessionId?: string): AIProfile {
  try {
    if (sessionId) ensureSessionProfile(sessionId)
    const raw = localStorage.getItem(aiProfileKey(sessionId))
    if (raw == null) {
      // 有会话但该会话还没自己的资料：回落全局（老数据）；全局也没有 → 默认
      return sessionId ? normalizeAIProfile(localStorage.getItem(AI_PROFILE_KEY)) : DEFAULT_AI_PROFILE
    }
    return normalizeAIProfile(raw)
  } catch {
    return DEFAULT_AI_PROFILE
  }
}

/** 保存 TA 资料（会话感知）：传 sessionId 写会话 key（角色隔离），否则写全局 key（无会话兜底） */
export function saveAIProfile(p: AIProfile, sessionId?: string): void {
  localStorage.setItem(aiProfileKey(sessionId), JSON.stringify(p))
  notifyDataChanged()
}

// ---- TA 的性别 / 备注（TASK-UI1 角色设定，独立 key 存） ----

export type AIGender = 'male' | 'female' | 'unknown'

/** 性别显示文案（男/女/未知） */
export const AIGENDER_LABELS: Record<AIGender, string> = {
  male: '男',
  female: '女',
  unknown: '未知',
}

const AI_REMARK_KEY = 'ai_companion_ai_remark'
const AI_GENDER_KEY = 'ai_companion_ai_gender'

/** 读取 TA 备注（没设置过返回空串） */
export function loadAIRemark(): string {
  try {
    const v = localStorage.getItem(AI_REMARK_KEY)
    return typeof v === 'string' ? v : ''
  } catch {
    return ''
  }
}

export function saveAIRemark(remark: string): void {
  localStorage.setItem(AI_REMARK_KEY, remark)
  notifyDataChanged()
}

/** 读取 TA 性别：'male' | 'female'，非法/未设置兜底 'unknown' */
export function loadAIGender(): AIGender {
  try {
    const v = localStorage.getItem(AI_GENDER_KEY)
    return v === 'male' || v === 'female' ? v : 'unknown'
  } catch {
    return 'unknown'
  }
}

export function saveAIGender(gender: AIGender): void {
  localStorage.setItem(AI_GENDER_KEY, gender)
  notifyDataChanged()
}

// ---- TA 的详情页 · firstSeen（认识 TA 的第一天） ----

const FIRST_SEEN_KEY = 'ai_companion_first_seen'

/**
 * 认识 TA 的第一天（时间戳）。
 * 取值顺序：已有缓存 → 本地最老聊天记录 ts → 最老记忆 createdAt → 最老生活动态 at → 当前时间。
 * 一旦算出就缓存到 localStorage，之后不再覆盖，保证「认识第几天」只增不减
 * （哪怕旧聊天记录被 60 天窗口裁掉，firstSeen 也不会往前跳）。
 */
export function getFirstSeen(sessionId?: string): number {
  const cacheKey = sessionId ? `${FIRST_SEEN_KEY}_${sessionId}` : FIRST_SEEN_KEY
  try {
    const cached = localStorage.getItem(cacheKey)
    if (cached) {
      const n = Number(cached)
      if (Number.isFinite(n) && n > 0) return n
    }
  } catch {
    // 读不到缓存按首次处理
  }

  // 按会话隔离：传了 sessionId 就只用该会话自己的最早消息/记忆算认识起点
  //（新会话=刚认识，从今天开始；老会话保留自己的起点）——七七拍板：每个角色是独立的人，各自认识各自记
  if (sessionId) {
    let msgs: StoredMessage[] = []
    let mems: MemoryItem[] = []
    try {
      const rawMsgs = localStorage.getItem(`ai_companion_msgs_${sessionId}`)
      if (rawMsgs) {
        const arr = JSON.parse(rawMsgs)
        if (Array.isArray(arr)) msgs = arr as StoredMessage[]
      }
    } catch {
      // 读坏不影响
    }
    try {
      const rawMems = localStorage.getItem(`ai_companion_mem_${sessionId}`)
      if (rawMems) {
        const arr = JSON.parse(rawMems)
        if (Array.isArray(arr)) mems = arr as MemoryItem[]
      }
    } catch {
      // 读坏不影响
    }
    const first = pickFirstSeen({ messages: msgs, memories: mems, posts: [] })
    const value = first ?? Date.now()
    try {
      localStorage.setItem(cacheKey, String(value))
    } catch {
      // 存不下也不影响展示
    }
    return value
  }

  let memories: MemoryItem[] = []
  let posts: SpacePost[] = []
  try {
    const rawMem = localStorage.getItem('ai_companion_memory')
    if (rawMem) {
      const arr = JSON.parse(rawMem)
      if (Array.isArray(arr)) memories = arr as MemoryItem[]
    }
  } catch {
    // 记忆读坏不影响 firstSeen
  }
  try {
    const rawPosts = localStorage.getItem('ai_space_posts')
    if (rawPosts) {
      const arr = JSON.parse(rawPosts)
      if (Array.isArray(arr)) posts = arr as SpacePost[]
    }
  } catch {
    // 动态读坏不影响 firstSeen
  }

  const first = pickFirstSeen({ messages: loadMessages(), memories, posts })
  const value = first ?? Date.now()
  try {
    localStorage.setItem(cacheKey, String(value))
  } catch {
    // 存不下也不影响展示
  }
  return value
}
