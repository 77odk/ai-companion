import {
  enqueueCloudStateOp,
  getCloudStateVersion,
  registerCloudStateAdapter,
  requestCloudStateSync,
  type CloudStateEntity,
} from './cloudState.ts'
import { ELUVIN_AUTH_CHANGE, ELUVIN_DATA_CHANGE } from './dataChange.ts'
import { getAccount } from './sync.ts'
import { getSessionsCache } from './sessionStore.ts'
import { applySpacePostFromCloud, deleteSpacePostFromCloud } from './aiSpace.ts'
import type { SpacePost } from './aiSpaceCore.ts'
import {
  applyTaRuntimeFromCloud,
  collectAllTaRuntime,
  deleteTaRuntimeFromCloud,
  isTaRuntimeState,
  registerTaRuntimeCloudSnapshotResetter,
  type TaRuntimeState,
} from './taRuntime.ts'

const GLOBAL = 'global'
const THEME_KEY = 'ai_companion_theme'
const SETTINGS_KEY = 'ai_companion_settings'
const GENDER_KEY = 'ai_companion_ai_gender'
const PERSONAL_DAYS_KEY = 'ai_companion_anniversaries'
const ANNIVERSARIES_PREFIX = 'ai_companion_anniversaries_'
const MAIN_ANNIVERSARY_KEY = 'ai_companion_main_anniversary'
const ANNIVERSARY_VIEW_UPDATE = 'memory-updated'

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

function queue(kind: string, entityId: string, payload?: unknown, deleted?: boolean, sessionId?: string, generationSlotId?: string): void {
  if (!getAccount()) return
  enqueueCloudStateOp({
    opId: opId(), kind, entityId,
    baseVersion: getCloudStateVersion(kind, entityId, undefined, sessionId),
    ...(sessionId ? { sessionId } : {}),
    ...(generationSlotId ? { generationSlotId } : {}),
    ...(deleted ? { deleted: true } : { payload }),
  })
  requestCloudStateSync()
}

const SPACE_POSTS_PREFIX = 'ai_space_posts_'

function normalizeSpacePost(value: unknown, entityId?: string, sessionId?: string, generationSlotId?: string): SpacePost | null {
  const outer = record(value)
  const item = record(outer?.post) ?? outer
  if (!item || typeof (entityId ?? item.id) !== 'string' || typeof item.at !== 'number' || typeof item.kind !== 'string' || typeof item.text !== 'string') return null
  return {
    ...item,
    id: entityId ?? String(item.id),
    ...(sessionId ? { sessionId } : {}),
    ...((generationSlotId ?? item.generationSlotId) ? { generationSlotId: String(generationSlotId ?? item.generationSlotId) } : {}),
  } as SpacePost
}

function spaceEntities(): Map<string, { entityId: string; sessionId: string; payload: SpacePost; generationSlotId?: string }> {
  const entities = new Map<string, { entityId: string; sessionId: string; payload: SpacePost; generationSlotId?: string }>()
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (!key?.startsWith(SPACE_POSTS_PREFIX)) continue
    const sessionId = key.slice(SPACE_POSTS_PREFIX.length)
    if (!sessionId) continue
    const value = readJson(key)
    if (!Array.isArray(value)) continue
    for (const raw of value) {
      const post = normalizeSpacePost(raw, undefined, sessionId)
      if (!post) continue
      entities.set(`${sessionId}\u0000${post.id}`, {
        entityId: post.id,
        sessionId,
        payload: post,
        ...(post.generationSlotId ? { generationSlotId: post.generationSlotId } : {}),
      })
    }
  }
  return entities
}

let spaceSnapshot = new Map<string, { entityId: string; sessionId: string; payload: SpacePost; generationSlotId?: string }>()
function resetSpaceSnapshot(): void {
  spaceSnapshot = spaceEntities()
}

function captureSpacePosts(): void {
  const next = spaceEntities()
  for (const [key, value] of next) {
    const previous = spaceSnapshot.get(key)
    if (!previous || JSON.stringify(previous.payload) !== JSON.stringify(value.payload)) {
      queue('space_post', value.entityId, value.payload, false, value.sessionId, value.generationSlotId)
    }
  }
  for (const [key, value] of spaceSnapshot) {
    if (!next.has(key)) queue('space_post', value.entityId, undefined, true, value.sessionId, value.generationSlotId)
  }
  spaceSnapshot = next
}

function applySpaceEntity(entity: CloudStateEntity): void {
  if (!entity.sessionId || !entity.entityId) return
  const post = normalizeSpacePost(entity.payload, entity.entityId, entity.sessionId, entity.generationSlotId)
  if (!post) return
  applySpacePostFromCloud(post, entity.sessionId)
  resetSpaceSnapshot()
}

function deleteSpaceEntity(entity: CloudStateEntity): void {
  if (!entity.sessionId || !entity.entityId) return
  const payload = record(entity.payload)
  const slotId = entity.generationSlotId ?? (typeof payload?.generationSlotId === 'string' ? payload.generationSlotId : undefined)
  deleteSpacePostFromCloud(entity.entityId, entity.sessionId, slotId)
  resetSpaceSnapshot()
}

interface AnniversaryCloudPayload extends JsonRecord {
  id: string
  label: string
  date: string
  createdAt: number
  mainAnniversary?: boolean
}

function validAnniversary(value: unknown): AnniversaryCloudPayload | null {
  const item = record(value)
  if (!item || typeof item.id !== 'string' || typeof item.label !== 'string' || typeof item.date !== 'string' || typeof item.createdAt !== 'number') return null
  return item as AnniversaryCloudPayload
}

function anniversaryEntityId(id: string): string {
  return id
}

function anniversaryStorageKey(sessionId?: string): string {
  return sessionId ? `${ANNIVERSARIES_PREFIX}${sessionId}` : PERSONAL_DAYS_KEY
}

function mainAnniversaryStorageKey(sessionId?: string): string {
  return sessionId ? `${MAIN_ANNIVERSARY_KEY}_${sessionId}` : MAIN_ANNIVERSARY_KEY
}

function anniversaryScope(entity: CloudStateEntity): { id: string; sessionId?: string } | null {
  if (!entity.entityId) return null
  return { id: entity.entityId, ...(entity.sessionId ? { sessionId: entity.sessionId } : {}) }
}

function storedAnniversaries(sessionId?: string): JsonRecord[] {
  const value = readJson(anniversaryStorageKey(sessionId))
  return Array.isArray(value) ? value.filter(item => record(item) != null) as JsonRecord[] : []
}

function sessionIdsWithAnniversaries(): string[] {
  const ids = new Set(getSessionsCache().map(session => String(session.id)).filter(Boolean))
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (key?.startsWith(ANNIVERSARIES_PREFIX)) ids.add(key.slice(ANNIVERSARIES_PREFIX.length))
  }
  return [...ids]
}

function anniversaryEntities(): Map<string, { entityId: string; payload: AnniversaryCloudPayload; sessionId?: string }> {
  const entities = new Map<string, { entityId: string; payload: AnniversaryCloudPayload; sessionId?: string }>()
  const collect = (sessionId?: string) => {
    const mainId = localStorage.getItem(mainAnniversaryStorageKey(sessionId)) || null
    for (const raw of storedAnniversaries(sessionId)) {
      const item = validAnniversary(raw)
      // personal_day is the only owner of personal records.
      if (!item || item.kind === 'personal') continue
      const payload = { ...item, ...(mainId === item.id ? { mainAnniversary: true } : {}) }
      const entityId = anniversaryEntityId(item.id)
      entities.set(`${sessionId || ''}\u0000${entityId}`, { entityId, payload, ...(sessionId ? { sessionId } : {}) })
    }
  }
  collect()
  for (const sessionId of sessionIdsWithAnniversaries()) collect(sessionId)
  return entities
}

let anniversarySnapshot = new Map<string, { entityId: string; payload: AnniversaryCloudPayload; sessionId?: string }>()
function resetAnniversarySnapshot(): void {
  anniversarySnapshot = anniversaryEntities()
}

function refreshAnniversaryViews(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ANNIVERSARY_VIEW_UPDATE))
}

function captureAnniversaries(): void {
  const next = anniversaryEntities()
  for (const [key, value] of next) {
    const previous = anniversarySnapshot.get(key)
    if (!previous || JSON.stringify(previous.payload) !== JSON.stringify(value.payload)) {
      queue('anniversary', value.entityId, value.payload, false, value.sessionId)
    }
  }
  for (const [key, value] of anniversarySnapshot) {
    if (!next.has(key)) queue('anniversary', value.entityId, undefined, true, value.sessionId)
  }
  anniversarySnapshot = next
}

function applyAnniversaryEntity(entity: CloudStateEntity): void {
  const scope = anniversaryScope(entity)
  const payloadRecord = record(entity.payload)
  const item = validAnniversary(payloadRecord?.anniversary ?? entity.payload)
  if (!scope || !item || item.kind === 'personal') return
  const list = storedAnniversaries(scope.sessionId)
  const index = list.findIndex(value => value.id === scope.id)
  const stored = { ...item, id: scope.id }
  delete stored.mainAnniversary
  if (index >= 0) list[index] = stored
  else list.unshift(stored)
  localStorage.setItem(anniversaryStorageKey(scope.sessionId), JSON.stringify(list))
  const isMain = item.mainAnniversary === true || payloadRecord?.mainAnniversary === true || payloadRecord?.main === true
  const mainKey = mainAnniversaryStorageKey(scope.sessionId)
  if (isMain) localStorage.setItem(mainKey, scope.id)
  else if (localStorage.getItem(mainKey) === scope.id) localStorage.removeItem(mainKey)
  resetAnniversarySnapshot()
  refreshAnniversaryViews()
}

function deleteAnniversaryEntity(entity: CloudStateEntity): void {
  const scope = anniversaryScope(entity)
  if (!scope) return
  const key = anniversaryStorageKey(scope.sessionId)
  const list = storedAnniversaries(scope.sessionId)
  localStorage.setItem(key, JSON.stringify(list.filter(item => item.id !== scope.id || item.kind === 'personal')))
  const mainKey = mainAnniversaryStorageKey(scope.sessionId)
  if (localStorage.getItem(mainKey) === scope.id) localStorage.removeItem(mainKey)
  resetAnniversarySnapshot()
  refreshAnniversaryViews()
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

/**
 * personal_day 生产存在两种形态，语义必须分离：
 *  A. aggregate（entityId === 'global'，payload 为数组）：远端数组即完整快照 → replace。
 *  B. single（entityId !== 'global'，payload 为合法 personal 单对象）：逐条实体 → UPSERT，
 *     只更新/插入 id 对应条目，绝不整表 replace。
 * 非法 payload（global 非数组 / single 非合法 personal 对象）返回 null，调用方安全忽略，
 * 绝不清空本机个人节日。
 */
interface PersonalDaysApply {
  kind: 'aggregate'
  payload: unknown[]
}
interface PersonalDaysSingleApply {
  kind: 'single'
  id: string
  payload: Record<string, unknown>
}
type PersonalDaysResolved = PersonalDaysApply | PersonalDaysSingleApply | null

function resolvePersonalDaysApply(entity: CloudStateEntity): PersonalDaysResolved {
  if (entity.entityId === 'global') {
    if (!Array.isArray(entity.payload)) return null
    return { kind: 'aggregate', payload: entity.payload }
  }
  const item = record(entity.payload)
  if (!item || item.kind !== 'personal' || typeof item.id !== 'string' || item.id === '') return null
  // Cloud State identity 以 entity.entityId 为准；payload.id 规范成同一 id，避免凭空多造记录。
  return { kind: 'single', id: entity.entityId, payload: { ...item, id: entity.entityId } }
}

function replacePersonalDays(payload: unknown): void {
  const current = readJson(PERSONAL_DAYS_KEY)
  const couples = Array.isArray(current) ? current.filter(item => record(item)?.kind !== 'personal') : []
  const incoming = Array.isArray(payload) ? payload.filter(item => record(item)?.kind === 'personal') : []
  localStorage.setItem(PERSONAL_DAYS_KEY, JSON.stringify([...incoming, ...couples]))
}

/** single 实体 UPSERT：保留所有非 personal / couple 数据与其它 personal 条目，按 id 更新或插入。 */
function upsertPersonalDay(id: string, item: Record<string, unknown>): void {
  const current = readJson(PERSONAL_DAYS_KEY)
  const list = Array.isArray(current) ? current : []
  const couples = list.filter(entry => record(entry)?.kind !== 'personal')
  const others = list.filter(entry => record(entry)?.kind === 'personal' && record(entry)?.id !== id)
  localStorage.setItem(PERSONAL_DAYS_KEY, JSON.stringify([{ ...item, id }, ...others, ...couples]))
}

/** single tombstone：只删 id === entity.entityId 的 personal 条目；global tombstone：清全部 personal、保留 couple。 */
function deletePersonalDayEntity(entity: CloudStateEntity): void {
  const current = readJson(PERSONAL_DAYS_KEY)
  const list = Array.isArray(current) ? current : []
  if (entity.entityId === 'global') {
    localStorage.setItem(PERSONAL_DAYS_KEY, JSON.stringify(list.filter(entry => record(entry)?.kind !== 'personal')))
    return
  }
  localStorage.setItem(PERSONAL_DAYS_KEY, JSON.stringify(list.filter(entry => !(record(entry)?.kind === 'personal' && record(entry)?.id === entity.entityId))))
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

function runtimeEntities(): Map<string, TaRuntimeState> {
  const entities = new Map<string, TaRuntimeState>()
  for (const [sessionId, state] of Object.entries(collectAllTaRuntime())) {
    if (sessionId === '_guest' || !sessionId || !isTaRuntimeState(state)) continue
    entities.set(sessionId, state)
  }
  return entities
}

let runtimeSnapshot = new Map<string, TaRuntimeState>()
function resetRuntimeSnapshot(): void {
  runtimeSnapshot = runtimeEntities()
}

function captureTaRuntime(): void {
  const next = runtimeEntities()
  for (const [sessionId, state] of next) {
    const previous = runtimeSnapshot.get(sessionId)
    if (!previous || JSON.stringify(previous) !== JSON.stringify(state)) {
      queue('ta_runtime', sessionId, state, false, sessionId)
    }
  }
  for (const sessionId of runtimeSnapshot.keys()) {
    if (!next.has(sessionId)) queue('ta_runtime', sessionId, undefined, true, sessionId)
  }
  runtimeSnapshot = next
}

function validRuntimeScope(entity: CloudStateEntity): entity is CloudStateEntity & { entityId: string; sessionId: string } {
  return Boolean(entity.entityId && entity.sessionId && entity.entityId === entity.sessionId && entity.sessionId !== '_guest')
}

function applyRuntimeEntity(entity: CloudStateEntity): void {
  if (!validRuntimeScope(entity) || !isTaRuntimeState(entity.payload)) return
  applyTaRuntimeFromCloud(entity.sessionId, entity.payload)
}

function deleteRuntimeEntity(entity: CloudStateEntity): void {
  if (!validRuntimeScope(entity)) return
  deleteTaRuntimeFromCloud(entity.sessionId)
}

let initialized = false
export function initCloudStateResourceAdapters(): void {
  if (initialized) return
  initialized = true
  resetPersonalSnapshot()
  resetAnniversarySnapshot()
  resetSpaceSnapshot()
  resetRuntimeSnapshot()
  registerTaRuntimeCloudSnapshotResetter(resetRuntimeSnapshot)
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
    apply(entity) {
      const resolved = resolvePersonalDaysApply(entity)
      if (!resolved) return
      if (resolved.kind === 'aggregate') replacePersonalDays(resolved.payload)
      else upsertPersonalDay(resolved.id, resolved.payload)
      personalSnapshot = JSON.stringify(personalDays())
    },
    delete(entity) {
      deletePersonalDayEntity(entity)
      personalSnapshot = JSON.stringify(personalDays())
    },
  })
  registerCloudStateAdapter('anniversary', {
    apply: applyAnniversaryEntity,
    delete: deleteAnniversaryEntity,
  })
  registerCloudStateAdapter('space_post', {
    apply: applySpaceEntity,
    delete: deleteSpaceEntity,
  })
  registerCloudStateAdapter('ta_runtime', {
    apply: applyRuntimeEntity,
    delete: deleteRuntimeEntity,
  })
  if (typeof window !== 'undefined') window.addEventListener(ELUVIN_DATA_CHANGE, capturePersonalDays)
  if (typeof window !== 'undefined') window.addEventListener(ELUVIN_DATA_CHANGE, captureAnniversaries)
  if (typeof window !== 'undefined') window.addEventListener(ELUVIN_DATA_CHANGE, captureSpacePosts)
  if (typeof window !== 'undefined') window.addEventListener(ELUVIN_DATA_CHANGE, captureTaRuntime)
  if (typeof window !== 'undefined') window.addEventListener(ELUVIN_AUTH_CHANGE, () => { resetPersonalSnapshot(); resetAnniversarySnapshot(); resetSpaceSnapshot(); resetRuntimeSnapshot() })
}
