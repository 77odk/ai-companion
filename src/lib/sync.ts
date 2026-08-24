// 账号与云端同步（登录标识：邮箱 / 手机号 / 用户名 + 密码）
// 后端 API（已实测可用）：
//   POST /api/register {email,password} → {token,account,createdAt}
//   POST /api/login    {email,password} → {token,account,createdAt}
//   POST /api/sync     Bearer <token>, body {data} → {ok,updatedAt}  全量上传
//   GET  /api/sync     Bearer <token>                → {data,updatedAt}  全量拉取（无数据 data=null）
// 错误统一返回 {error: '...'}，HTTP 400/401/409。
// 纯逻辑（合并/清洗/账户读写）都放在可被 Node 单测的导出函数里；网络失败静默，不打断用户。

import { ELUVIN_DATA_CHANGE, notifyAuthChanged } from './dataChange.ts'
import {
  loadSettings,
  loadMessages,
  loadPersona,
  loadUserProfile,
  loadAIProfile,
  getSessionStart,
  type StoredMessage,
  type UserProfile,
  type AIProfile,
  type Provider,
} from './storage.ts'
import { loadMemory, type MemoryItem } from './memory.ts'
import { loadAnniversaries, getMainAnniversaryId, type Anniversary } from './anniversary.ts'
import type { SpacePost } from './aiSpaceCore.ts'

/** 后端服务地址（本地写死一个出口常量：同步接口与会话接口共用，别各自写死） */
export const API_BASE = 'https://refresh-contractors-stage-amongst.trycloudflare.com'

export interface Account {
  token: string
  /** 登录标识：邮箱 / 手机号 / 用户名（用户填的原始内容，trim 后） */
  account: string
}

/** 云端同步的设置结构：apiKey 绝不上云，每个服务商只留 baseUrl/model */
export interface ProviderSyncSettings {
  baseUrl: string
  model: string
}

export interface SyncSettings {
  provider: string
  providers: Partial<Record<Provider, ProviderSyncSettings>>
}

/** 云端同步的全量数据载荷（localStorage 各 key 的映射） */
export interface SyncData {
  messages: StoredMessage[]
  memory: MemoryItem[]
  persona: string
  userProfile: UserProfile
  aiProfile: AIProfile
  settings: SyncSettings
  sessionStart: number
  anniversaries: Anniversary[]
  mainAnniversary: string | null
  spacePosts: SpacePost[]
}

const ACCOUNT_KEY = 'ai_companion_account'
const SETTINGS_KEY = 'ai_companion_settings'
const MESSAGES_KEY = 'ai_companion_messages'
const MEMORY_KEY = 'ai_companion_memory'
const PERSONA_KEY = 'ai_companion_persona'
const USER_PROFILE_KEY = 'ai_companion_user_profile'
const AI_PROFILE_KEY = 'ai_companion_ai_profile'
const SESSION_START_KEY = 'ai_companion_session_start'
const ANNIVERSARIES_KEY = 'ai_companion_anniversaries'
const MAIN_ANNIVERSARY_KEY = 'ai_companion_main_anniversary'
const SPACE_POSTS_KEY = 'ai_space_posts'

const ALL_PROVIDERS: Provider[] = ['deepseek', 'zhipu', 'openai', 'custom', 'volcengine']

// ---- 账号（localStorage key 'ai_companion_account'） ----

export function getAccount(): Account | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<Account>
    if (p != null && typeof p.token === 'string' && p.token && typeof p.account === 'string') {
      return { token: p.token, account: p.account }
    }
    return null
  } catch {
    return null
  }
}

export function setAccount(account: Account): void {
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ token: account.token, account: account.account }))
}

export function clearAccount(): void {
  localStorage.removeItem(ACCOUNT_KEY)
}

// ---- 注册 / 登录 ----

async function errorMessage(resp: Response): Promise<string> {
  try {
    const body = (await resp.json()) as { error?: unknown }
    if (body != null && typeof body.error === 'string' && body.error.trim()) return body.error
  } catch {
    // 响应体不是 JSON，走兜底文案
  }
  return `操作失败（HTTP ${resp.status}）`
}

async function postAuth(path: string, account: string, password: string, extra: Record<string, string> = {}): Promise<Account> {
  let resp: Response
  try {
    resp = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: account.trim(), password, ...extra }),
    })
  } catch {
    throw new Error('网络不通，连不上服务器，请检查网络后重试')
  }
  if (!resp.ok) throw new Error(await errorMessage(resp))
  const body = (await resp.json().catch(() => null)) as Partial<Account> | null
  if (body != null && typeof body.token === 'string' && typeof body.account === 'string') {
    const acct: Account = { token: body.token, account: body.account }
    setAccount(acct)
    // 登录状态变化广播：App 监听后关闭登录墙 / 刷新「我的」页状态
    notifyAuthChanged()
    return acct
  }
  throw new Error('服务器返回异常，请稍后重试')
}

export function register(account: string, password: string, bindEmail?: string, bindPhone?: string): Promise<Account> {
  const extra: Record<string, string> = {}
  if (bindEmail && bindEmail.trim()) extra.bindEmail = bindEmail.trim()
  if (bindPhone && bindPhone.trim()) extra.bindPhone = bindPhone.trim()
  return postAuth('/api/register', account, password, extra)
}

export function login(account: string, password: string): Promise<Account> {
  return postAuth('/api/login', account, password)
}

// ---- B2e：找回密码 + 账号绑定 ----

export interface Identity {
  type: 'email' | 'phone' | 'username'
  value: string
}

/** 发找回密码验证码（发到账号绑定的邮箱），成功返回脱敏邮箱 */
export async function verifySend(account: string): Promise<string> {
  let resp: Response
  try {
    resp = await fetch(`${API_BASE}/api/verify/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: account.trim() }),
    })
  } catch {
    throw new Error('网络不通，连不上服务器，请检查网络后重试')
  }
  if (!resp.ok) throw new Error(await errorMessage(resp))
  const body = (await resp.json().catch(() => null)) as { sentTo?: string } | null
  if (body && typeof body.sentTo === 'string') return body.sentTo
  throw new Error('发送失败，请稍后再试')
}

/** 用验证码重置密码 */
export async function resetPassword(account: string, code: string, newPassword: string): Promise<void> {
  let resp: Response
  try {
    resp = await fetch(`${API_BASE}/api/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: account.trim(), code: code.trim(), newPassword }),
    })
  } catch {
    throw new Error('网络不通，连不上服务器，请检查网络后重试')
  }
  if (!resp.ok) throw new Error(await errorMessage(resp))
}

/** 登录后绑定新标识（邮箱/手机号） */
export async function bindIdentity(type: 'email' | 'phone', value: string): Promise<void> {
  const token = getAccount()?.token
  if (!token) throw new Error('还没登录')
  let resp: Response
  try {
    resp = await fetch(`${API_BASE}/api/account/bind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type, value: value.trim() }),
    })
  } catch {
    throw new Error('网络不通，连不上服务器，请检查网络后重试')
  }
  if (!resp.ok) throw new Error(await errorMessage(resp))
}

/** 当前账号所有登录标识 */
export async function getIdentities(): Promise<Identity[]> {
  const token = getAccount()?.token
  if (!token) throw new Error('还没登录')
  let resp: Response
  try {
    resp = await fetch(`${API_BASE}/api/account/identities`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    throw new Error('网络不通，连不上服务器，请检查网络后重试')
  }
  if (!resp.ok) throw new Error(await errorMessage(resp))
  const body = (await resp.json().catch(() => null)) as { identities?: Identity[] } | null
  if (body && Array.isArray(body.identities)) return body.identities
  throw new Error('获取失败，请稍后再试')
}

// ---- 数据打包（collectData）/ 应用（applyData） ----

function sanitizeSettings(): SyncSettings {
  const s = loadSettings()
  const providers: SyncSettings['providers'] = {}
  for (const p of ALL_PROVIDERS) {
    const cfg = s.providers[p]
    providers[p] = { baseUrl: cfg.baseUrl, model: cfg.model }
  }
  return { provider: s.provider, providers }
}

function readSpacePosts(): SpacePost[] {
  try {
    const raw = localStorage.getItem(SPACE_POSTS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as SpacePost[]) : []
  } catch {
    return []
  }
}

/** 把本地 localStorage 全量打包成同步载荷：settings 剔除 apiKey（key 不上云） */
export function collectData(): SyncData {
  return {
    messages: loadMessages(),
    memory: loadMemory(),
    persona: loadPersona(),
    userProfile: loadUserProfile(),
    aiProfile: loadAIProfile(),
    settings: sanitizeSettings(),
    sessionStart: getSessionStart(),
    anniversaries: loadAnniversaries(),
    mainAnniversary: getMainAnniversaryId(),
    spacePosts: readSpacePosts(),
  }
}

// ---- 合并策略（纯函数，可单测） ----

/**
 * messages 合并：按 ts 去重（Map key=ts），同一 ts 本地覆盖云端；合并后按 ts 升序。
 * 输入顺序不影响结果（升序排序兜底）。
 */
export function mergeMessages(local: StoredMessage[], cloud: StoredMessage[]): StoredMessage[] {
  const map = new Map<number, StoredMessage>()
  for (const m of [...(cloud ?? []), ...(local ?? [])]) {
    if (m == null || typeof m.ts !== 'number') continue
    map.set(m.ts, m)
  }
  return [...map.values()].sort((a, b) => a.ts - b.ts)
}

/**
 * memory 合并：按 id 去重（没 id 的用 JSON.stringify 兜底做 key），同一 key 本地覆盖云端。
 */
export function mergeMemory(local: MemoryItem[], cloud: MemoryItem[]): MemoryItem[] {
  const map = new Map<string, MemoryItem>()
  for (const m of [...(cloud ?? []), ...(local ?? [])]) {
    if (m == null) continue
    const key = typeof m.id === 'string' && m.id ? m.id : JSON.stringify(m)
    map.set(key, m)
  }
  return [...map.values()]
}

function isEmptyString(v: unknown): boolean {
  return typeof v !== 'string' || v.trim() === ''
}

function isEmptyProfile(p: object | null | undefined): boolean {
  if (p == null) return true
  return Object.values(p).every((v) => isEmptyString(v))
}

/** TA 资料的空判断：默认昵称「TA」不算用户数据（没填过 = 空），新设备才能被云端资料填充 */
function isEmptyAIProfile(p: AIProfile | null | undefined): boolean {
  if (p == null) return true
  return (isEmptyString(p.nickname) || p.nickname === 'TA') && isEmptyString(p.avatar)
}

function normalizeUserProfile(raw: unknown): UserProfile {
  const p = (raw ?? {}) as Partial<UserProfile>
  return {
    nickname: typeof p.nickname === 'string' ? p.nickname : '',
    avatar: typeof p.avatar === 'string' && p.avatar.startsWith('data:') ? p.avatar : '',
    bio: typeof p.bio === 'string' ? p.bio : '',
  }
}

function normalizeAIProfile(raw: unknown): AIProfile {
  const p = (raw ?? {}) as Partial<AIProfile>
  return {
    nickname: typeof p.nickname === 'string' && p.nickname ? p.nickname : 'TA',
    avatar: typeof p.avatar === 'string' && p.avatar.startsWith('data:') ? p.avatar : '',
  }
}

/**
 * 设置合并：本地配过设置（有 ai_companion_settings key，含 apiKey）→ 本地优先，原样保留；
 * 本地从没配过（新设备首次登录）→ 用云端设置（云端不带 apiKey，落盘时 apiKey 置空）。
 * 返回 null 表示本地、云端都没有设置，不用写。
 */
function mergeSettings(localRaw: string | null, cloud: SyncSettings | undefined): string | null {
  if (localRaw != null && localRaw.trim() !== '') return localRaw
  if (cloud != null) {
    const providers: Record<string, { apiKey: string; baseUrl: string; model: string }> = {}
    for (const p of ALL_PROVIDERS) {
      const cp = cloud.providers?.[p]
      providers[p] = { apiKey: '', baseUrl: cp?.baseUrl ?? '', model: cp?.model ?? '' }
    }
    return JSON.stringify({ provider: cloud.provider || 'zhipu', providers })
  }
  return null
}

/**
 * 把拉下来的云端数据写回 localStorage。
 * messages / memory 做并集去重合并；其余字段按「本地全空且云端有数据 → 用云端（新设备首次登录）；
 * 本地有数据 → 本地优先（老设备继续用）」。
 */
export function applyData(data: SyncData): void {
  const d = data ?? ({} as SyncData)

  if (Array.isArray(d.messages)) {
    localStorage.setItem(MESSAGES_KEY, JSON.stringify(mergeMessages(loadMessages(), d.messages)))
  }
  if (Array.isArray(d.memory)) {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(mergeMemory(loadMemory(), d.memory)))
  }

  // persona：本地没写过才用云端的
  const persona = loadPersona()
  if (isEmptyString(persona) && !isEmptyString(d.persona)) {
    localStorage.setItem(PERSONA_KEY, d.persona)
  }

  // 用户资料 / TA 资料：本地全空才用云端
  if (isEmptyProfile(loadUserProfile())) {
    localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(normalizeUserProfile(d.userProfile)))
  }
  if (isEmptyAIProfile(loadAIProfile())) {
    localStorage.setItem(AI_PROFILE_KEY, JSON.stringify(normalizeAIProfile(d.aiProfile)))
  }

  // 设置：本地配过就原样保留（含 apiKey）；本地从没配过才用云端的（云端不带 apiKey）
  const mergedSettings = mergeSettings(localStorage.getItem(SETTINGS_KEY), d.settings)
  if (mergedSettings != null) {
    localStorage.setItem(SETTINGS_KEY, mergedSettings)
  }

  // 会话起点：本地为 0 且云端有才用云端（0 = 没设过）
  const localStart = getSessionStart()
  const cloudStart = typeof d.sessionStart === 'number' && d.sessionStart > 0 ? d.sessionStart : 0
  localStorage.setItem(SESSION_START_KEY, String(localStart > 0 ? localStart : cloudStart))

  // 纪念日 / 主纪念日 / 空间动态：本地空且云端有才用云端
  if (loadAnniversaries().length === 0 && Array.isArray(d.anniversaries) && d.anniversaries.length > 0) {
    localStorage.setItem(ANNIVERSARIES_KEY, JSON.stringify(d.anniversaries))
  }
  const localMain = getMainAnniversaryId()
  const cloudMain = typeof d.mainAnniversary === 'string' && d.mainAnniversary ? d.mainAnniversary : null
  if (localMain == null && cloudMain != null) {
    localStorage.setItem(MAIN_ANNIVERSARY_KEY, cloudMain)
  }
  if (readSpacePosts().length === 0 && Array.isArray(d.spacePosts) && d.spacePosts.length > 0) {
    localStorage.setItem(SPACE_POSTS_KEY, JSON.stringify(d.spacePosts))
  }
}

// ---- 同步执行（手动 / 登录后 / 数据变更自动） ----

async function downloadAll(): Promise<boolean> {
  const account = getAccount()
  if (!account) return false
  let resp: Response
  try {
    resp = await fetch(`${API_BASE}/api/sync`, {
      headers: { Authorization: `Bearer ${account.token}` },
    })
  } catch {
    throw new Error('网络不通，连不上同步服务器，请检查网络')
  }
  if (!resp.ok) throw new Error(await errorMessage(resp))
  const body = (await resp.json().catch(() => null)) as { data?: unknown } | null
  if (body != null && body.data != null) {
    applyData(body.data as SyncData)
    return true
  }
  return false
}

async function uploadAll(): Promise<void> {
  const account = getAccount()
  if (!account) return
  let resp: Response
  try {
    resp = await fetch(`${API_BASE}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${account.token}` },
      body: JSON.stringify({ data: collectData() }),
    })
  } catch {
    throw new Error('网络不通，连不上同步服务器，请检查网络')
  }
  if (!resp.ok) throw new Error(await errorMessage(resp))
}

/**
 * 手动/登录后触发：先拉（云端有数据就合并到本地），再全量上传合并后的数据。
 * 失败抛 Error（后端 error 文案或网络兜底），由 UI 展示原因。
 */
export async function syncNow(): Promise<void> {
  const account = getAccount()
  if (!account) return
  await downloadAll()
  await uploadAll()
}

// ---- 数据变更自动上传（防抖 4 秒，仅已登录；网络失败静默） ----

let debounceTimer: ReturnType<typeof setTimeout> | null = null

function scheduleUploadAll(): void {
  if (!getAccount()) return
  if (debounceTimer != null) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void uploadAll().catch(() => {
      // 网络失败静默：不弹窗不打断，下次数据变更再试
    })
  }, 4000)
}

/** 监听 'eluvin-data-change'，防抖后自动上传（App 启动时调用一次） */
export function initSyncListener(): void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
  window.addEventListener(ELUVIN_DATA_CHANGE, scheduleUploadAll)
}
