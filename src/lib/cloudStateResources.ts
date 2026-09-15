import {
  enqueueCloudStateOp,
  getCloudStateVersion,
  registerCloudStateAdapter,
  requestCloudStateSync,
  type CloudStateEntity,
} from './cloudState.ts'
import { ELUVIN_AUTH_CHANGE, ELUVIN_DATA_CHANGE } from './dataChange.ts'
import { getAccount } from './sync.ts'

const GLOBAL = 'global'
const THEME_KEY = 'ai_companion_theme'
const SETTINGS_KEY = 'ai_companion_settings'
const GENDER_KEY = 'ai_companion_ai_gender'
const PERSONAL_DAYS_KEY = 'ai_companion_anniversaries'

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | null {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function readJson(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return null }
}

function opId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `cloud-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function queue(kind: string, entityId: string, payload?: unknown, deleted?: boolean): void {
  if (!getAccount()) return
  enqueueCloudStateOp({
    opId: opId(), kind, entityId,
    baseVersion: getCloudStateVersion(kind, entityId),
    ...(deleted ? { deleted: true } : { payload }),
  })
  requestCloudStateSync()
}

export function queueThemeCloudChange(payload: unknown): void {
  const value = record(payload)
  if (value && (value.type === 'preset' || value.type === 'custom')) queue('theme', GLOBAL, value)
}

export function queueGenderCloudChange(gender: string, sessionId?: string): void {
  if (gender !== 'male' && gender !== 'female' && gender !== 'unknown') return
  queue('gender', sessionId || GLOBAL, { g: gender, locked: gender !== 'unknown' })
}

const CREDENTIAL_KEYS = new Set([
  'apikey', 'apisecret', 'secret', 'clientsecret', 'token', 'accesstoken', 'authtoken', 'refreshtoken', 'sessiontoken',
  'authorization', 'bearer', 'credential', 'credentials', 'password', 'privatekey',
])

function isCredentialKey(key: string): boolean {
  return CREDENTIAL_KEYS.has(key.replace(/[_-]/g, '').toLowerCase())
}

/** Defense in depth for historical/provider-specific objects before they enter an op. */
export function scrubModelSettings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubModelSettings)
  const source = record(value)
  if (!source) return value
  return Object.fromEntries(Object.entries(source)
    .filter(([key]) => !isCredentialKey(key))
    .map(([key, child]) => [key, scrubModelSettings(child)]))
}

export function queueModelSettingsCloudChange(payload: unknown): void {
  queue('model_settings', GLOBAL, scrubModelSettings(payload))
}

function genderStorageKey(entityId: string): string {
  return entityId === GLOBAL ? GENDER_KEY : `${GENDER_KEY}_${entityId}`
}

function applyThemeEntity(entity: CloudStateEntity): void {
  const value = record(entity.payload)
  if (!value || (value.type !== 'preset' && value.type !== 'custom')) return
  localStorage.setItem(THEME_KEY, JSON.stringify(value))
  void import('./theme.ts').then(({ applyTheme }) => applyTheme())
}

function applyGenderEntity(entity: CloudStateEntity): void {
  const value = record(entity.payload)
  const gender = value?.g ?? value?.gender
  if (gender !== 'male' && gender !== 'female' && gender !== 'unknown') return
  localStorage.setItem(genderStorageKey(entity.entityId), JSON.stringify({ g: gender, locked: value?.locked === true }))
}

function modelPayloadFromLocal(): JsonRecord {
  const local = record(readJson(SETTINGS_KEY)) ?? {}
  const providers = record(local.providers) ?? {}
  const safeProviders = Object.fromEntries(Object.entries(providers).map(([name, raw]) => {
    const config = record(raw) ?? {}
    return [name, { baseUrl: config.baseUrl, model: config.model }]
  }))
  const current = record(providers[String(local.provider ?? '')]) ?? {}
  return scrubModelSettings({
    provider: local.provider,
    baseUrl: local.baseUrl ?? current.baseUrl,
    model: local.model ?? current.model,
    providers: safeProviders,
  }) as JsonRecord
}

export function queueCurrentModelSettingsCloudChange(): void {
  queueModelSettingsCloudChange(modelPayloadFromLocal())
}

function applyModelSettingsEntity(entity: CloudStateEntity): void {
  const incoming = record(scrubModelSettings(entity.payload))
  if (!incoming) return
  const local = record(readJson(SETTINGS_KEY)) ?? {}
  const localProviders = record(local.providers) ?? {}
  const remoteProviders = record(incoming.providers) ?? {}
  const providers: JsonRecord = { ...localProviders }
  for (const [name, raw] of Object.entries(remoteProviders)) {
    const remote = record(raw)
    if (!remote) continue
    const existing = record(localProviders[name]) ?? {}
    providers[name] = {
      ...existing,
      ...(typeof remote.baseUrl === 'string' ? { baseUrl: remote.baseUrl } : {}),
      ...(typeof remote.model === 'string' ? { model: remote.model } : {}),
    }
  }
  const provider = typeof incoming.provider === 'string' ? incoming.provider : local.provider
  const active = record(providers[String(provider ?? '')]) ?? {}
  if (typeof incoming.baseUrl === 'string') active.baseUrl = incoming.baseUrl
  if (typeof incoming.model === 'string') active.model = incoming.model
  if (provider) providers[String(provider)] = active
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...local, provider, providers }))
}

function resetModelSettingsEntity(): void {
  const local = record(readJson(SETTINGS_KEY)) ?? {}
  const localProviders = record(local.providers) ?? {}
  const providers = Object.fromEntries(Object.entries(localProviders).map(([name, raw]) => {
    const config = record(raw) ?? {}
    return [name, Object.fromEntries(Object.entries(config).filter(([key]) => isCredentialKey(key)))]
  }))
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...local, provider: 'zhipu', providers }))
}

function personalDays(): unknown[] {
  const value = readJson(PERSONAL_DAYS_KEY)
  return Array.isArray(value) ? value.filter(item => record(item)?.kind === 'personal') : []
}

function replacePersonalDays(payload: unknown): void {
  const current = readJson(PERSONAL_DAYS_KEY)
  const couples = Array.isArray(current) ? current.filter(item => record(item)?.kind !== 'personal') : []
  const incoming = Array.isArray(payload) ? payload.filter(item => record(item)?.kind === 'personal') : []
  localStorage.setItem(PERSONAL_DAYS_KEY, JSON.stringify([...incoming, ...couples]))
}

let personalSnapshot = ''
function resetPersonalSnapshot(): void {
  personalSnapshot = JSON.stringify(personalDays())
}
function capturePersonalDays(): void {
  const days = personalDays()
  const next = JSON.stringify(days)
  if (next === personalSnapshot) return
  personalSnapshot = next
  queue('personal_day', GLOBAL, days, days.length === 0)
}

let initialized = false
export function initCloudStateResourceAdapters(): void {
  if (initialized) return
  initialized = true
  resetPersonalSnapshot()
  registerCloudStateAdapter('theme', {
    apply: applyThemeEntity,
    delete() { localStorage.setItem(THEME_KEY, JSON.stringify({ type: 'preset', presetId: 'peach' })); void import('./theme.ts').then(({ applyTheme }) => applyTheme()) },
  })
  registerCloudStateAdapter('gender', {
    apply: applyGenderEntity,
    delete(entity) { localStorage.removeItem(genderStorageKey(entity.entityId)) },
  })
  registerCloudStateAdapter('model_settings', {
    apply: applyModelSettingsEntity,
    delete: resetModelSettingsEntity,
  })
  registerCloudStateAdapter('personal_day', {
    apply(entity) { replacePersonalDays(entity.payload); personalSnapshot = JSON.stringify(personalDays()) },
    delete() { replacePersonalDays([]); personalSnapshot = '[]' },
  })
  if (typeof window !== 'undefined') window.addEventListener(ELUVIN_DATA_CHANGE, capturePersonalDays)
  if (typeof window !== 'undefined') window.addEventListener(ELUVIN_AUTH_CHANGE, resetPersonalSnapshot)
}
