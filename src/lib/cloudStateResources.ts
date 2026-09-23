import {
  enqueueCloudStateOp,
  getCloudStateVersion,
  registerCloudStateAdapter,
  requestCloudStateSync,
  type CloudStateEntity,
} from './cloudState.ts'
import { ELUVIN_AUTH_CHANGE, ELUVIN_DATA_CHANGE, notifyDataChanged } from './dataChange.ts'
import { getAccount } from './sync.ts'
import { collectAllAIProfiles, getSessionStart, setSessionStart } from './storage.ts'
import { isIdentityMode, mergeProfileIdentityField, type IdentityMode } from './companionPolicy.ts'
import { getPendingOps, getSessionsCache, removePendingOp, type CloudStatePendingOp } from './sessionStore.ts'
import { applyDefaultRoleFromCloud, deleteDefaultRoleFromCloud, getDefaultRoleId } from './defaultRole.ts'
import { applyGlobalReplyLengthFromCloud, applyReplyLengthPreferenceFromCloud, collectStoredReplyLengthPreferences, deleteGlobalReplyLengthFromCloud, deleteReplyLengthOverrideFromCloud, getStoredGlobalReplyLength, type ReplyLength } from './replyLength.ts'
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
import {
  getWeeklyReviews,
  mergeWeeklyReview,
  saveWeeklyReviewsFromCloud,
  type WeeklyReview,
} from './weeklyReview.ts'

const GLOBAL = 'global'
const THEME_KEY = 'ai_companion_theme'
const SETTINGS_KEY = 'ai_companion_settings'
const GENDER_KEY = 'ai_companion_ai_gender'
const PERSONAL_DAYS_KEY = 'ai_companion_anniversaries'
const ANNIVERSARIES_PREFIX = 'ai_companion_anniversaries_'
const MAIN_ANNIVERSARY_KEY = 'ai_companion_main_anniversary'
const ANNIVERSARY_VIEW_UPDATE = 'memory-updated'
const AI_PROFILE_KEY = 'ai_companion_ai_profile'

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

function queue(kind: string, entityId: string, payload?: unknown, deleted?: boolean, sessionId?: string, generationSlotId?: string, baseVersion?: number, fixedOpId?: string): void {
  if (!getAccount()) return
  enqueueCloudStateOp({
    opId: fixedOpId ?? opId(), kind, entityId,
    baseVersion: baseVersion ?? getCloudStateVersion(kind, entityId, undefined, sessionId),
    ...(sessionId ? { sessionId } : {}),
    ...(generationSlotId ? { generationSlotId } : {}),
    ...(deleted ? { deleted: true } : { payload }),
  })
  requestCloudStateSync()
}

const WEEKLY_PREFIX = 'ai_companion_weekly_reviews_'

function validWeeklyReview(value: unknown, entityId?: string): WeeklyReview | null {
  const item = record(value)
  if (!item || typeof item.id !== 'string' || (entityId && item.id !== entityId) ||
    typeof item.weekLabel !== 'string' || typeof item.title !== 'string' || typeof item.content !== 'string' ||
    typeof item.createdAt !== 'number') return null
  return item as unknown as WeeklyReview
}

function weeklySlot(review: WeeklyReview): string | undefined {
  const range = review.generatedFrom
  if (!range || !Number.isFinite(range.startTs) || !Number.isFinite(range.endTs)) return undefined
  return `weekly:${range.startTs}-${range.endTs}`
}

interface WeeklyEntity {
  entityId: string
  sessionId: string
  payload: WeeklyReview
  generationSlotId?: string
}

function weeklyEntities(): Map<string, WeeklyEntity> {
  const entities = new Map<string, WeeklyEntity>()
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (!key?.startsWith(WEEKLY_PREFIX)) continue
    const sessionId = key.slice(WEEKLY_PREFIX.length)
    if (!sessionId) continue
    for (const review of getWeeklyReviews(sessionId)) {
      const generationSlotId = weeklySlot(review)
      entities.set(`${sessionId}\u0000${review.id}`, {
        entityId: review.id,
        sessionId,
        payload: review,
        ...(generationSlotId ? { generationSlotId } : {}),
      })
    }
  }
  return entities
}

let weeklySnapshot = new Map<string, WeeklyEntity>()
function resetWeeklySnapshot(): void {
  weeklySnapshot = weeklyEntities()
}

function captureWeeklyReviews(): void {
  const next = weeklyEntities()
  for (const [key, value] of next) {
    const previous = weeklySnapshot.get(key)
    if (!previous || JSON.stringify(previous.payload) !== JSON.stringify(value.payload)) {
      queue('weekly_review', value.entityId, value.payload, false, value.sessionId, value.generationSlotId)
    }
  }
  for (const [key, value] of weeklySnapshot) {
    if (!next.has(key)) queue('weekly_review', value.entityId, undefined, true, value.sessionId, value.generationSlotId)
  }
  weeklySnapshot = next
}

function validWeeklyEntity(entity: CloudStateEntity): entity is CloudStateEntity & { sessionId: string } {
  return Boolean(entity.sessionId && entity.entityId)
}

function applyWeeklyEntity(entity: CloudStateEntity): void {
  if (!validWeeklyEntity(entity)) return
  const canonical = validWeeklyReview(entity.payload, entity.entityId)
  if (!canonical) return
  const canonicalSlot = weeklySlot(canonical)
  if (entity.generationSlotId && entity.generationSlotId !== canonicalSlot) return
  const current = getWeeklyReviews(entity.sessionId)
  const local = current.find(review => review.id === entity.entityId)
  const merged = mergeWeeklyReview(canonical, local)
  const next = current.filter(review => review.id !== entity.entityId && (!canonicalSlot || weeklySlot(review) !== canonicalSlot))
  next.push(merged)
  saveWeeklyReviewsFromCloud(next, entity.sessionId)
  resetWeeklySnapshot()
  if (JSON.stringify(merged) !== JSON.stringify(canonical)) {
    queue('weekly_review', entity.entityId, merged, false, entity.sessionId, canonicalSlot, entity.version)
  }
}

function deleteWeeklyEntity(entity: CloudStateEntity): void {
  if (!validWeeklyEntity(entity)) return
  const current = getWeeklyReviews(entity.sessionId)
  const next = current.filter(review => review.id !== entity.entityId)
  if (next.length !== current.length) saveWeeklyReviewsFromCloud(next, entity.sessionId)
  resetWeeklySnapshot()
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

/** 读本机性别记录：兼容老格式裸值（未锁）与新格式 JSON；坏值当没有。 */
function readLocalGenderRecord(key: string): { g: string; locked: boolean } | null {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return null
    const text = raw.trim()
    if (text === 'male' || text === 'female' || text === 'unknown') return { g: text, locked: false }
    const parsed = JSON.parse(text) as { g?: unknown; gender?: unknown; locked?: unknown }
    const g = parsed.g ?? parsed.gender
    if (g !== 'male' && g !== 'female' && g !== 'unknown') return null
    return { g: g as string, locked: parsed.locked === true }
  } catch {
    return null
  }
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
  const key = genderStorageKey(entity.entityId)
  const cloudLocked = value?.locked === true
  const local = readLocalGenderRecord(key)
  // 与 storage.applyCloudGenders 同一条规则（2026-09-14 拍板「只增不改」）：
  // 本机已锁一律不动 —— 云端 locked:false 是把「选好就锁死」冲开的病根（云端那份可能是
  // 9/15 从旧 blob 播种的旧值，legacy 导入规则又不许覆盖已有 V2，所以它会一直停在 false）；
  // 本机没记录、或本机未锁而云端已锁 → 才写（换设备把「已锁」带回来靠这条）。
  if (local && (local.locked || !cloudLocked)) return
  localStorage.setItem(key, JSON.stringify({ g: gender, locked: cloudLocked }))
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

// ---------- 角色资料（昵称/头像）云同步（2026-09-18 七七拍板）----------
// 病根：新同步通道里没有「角色资料」这一类，手机上新建的角色电脑上取不到 →
// 旧规则「该角色没资料就回落全局那份」把老角色的头像名字借给了新角色（显示成饺子）。
// 规则：每个角色一份实体（entityId=会话 id，session 作用域；全局那份 entityId='global'），
// 应用照纪念日/主题同一条「云端权威」——手机上改的头像名字要能落到电脑上。
function aiProfileStorageKey(entityId: string): string {
  return entityId === GLOBAL ? AI_PROFILE_KEY : `${AI_PROFILE_KEY}_${entityId}`
}

type SyncedAIProfile = { nickname: string; avatar: string; identityMode?: IdentityMode }

function validAiProfile(value: unknown): SyncedAIProfile | null {
  const item = record(value)
  if (!item) return null
  const nickname = typeof item.nickname === 'string' ? item.nickname.trim() : ''
  const avatar = typeof item.avatar === 'string' && item.avatar.startsWith('data:') ? item.avatar : ''
  if (!nickname && !avatar) return null
  const profile: SyncedAIProfile = { nickname: nickname || 'TA', avatar }
  if (isIdentityMode(item.identityMode)) profile.identityMode = item.identityMode
  return profile
}

function profileEntities(): Map<string, SyncedAIProfile> {
  const out = new Map<string, SyncedAIProfile>()
  for (const [sid, profile] of Object.entries(collectAllAIProfiles())) {
    const entityId = sid === '_global' ? GLOBAL : String(sid)
    const value = validAiProfile(profile)
    if (entityId && value) out.set(entityId, value)
  }
  return out
}

let profileSnapshot = new Map<string, SyncedAIProfile>()
function resetProfileSnapshot(): void {
  profileSnapshot = profileEntities()
}

function captureAiProfiles(): void {
  const next = profileEntities()
  for (const [entityId, value] of next) {
    const previous = profileSnapshot.get(entityId)
    if (!previous || JSON.stringify(previous) !== JSON.stringify(value)) {
      queue('profile', entityId, value, false, entityId === GLOBAL ? undefined : entityId)
    }
  }
  for (const entityId of profileSnapshot.keys()) {
    if (!next.has(entityId)) queue('profile', entityId, undefined, true, entityId === GLOBAL ? undefined : entityId)
  }
  profileSnapshot = next
}

const LEGACY_BACKFILL_VERSION = 'p0a-v1'
const LEGACY_BACKFILL_MARKER_PREFIX = 'ai_companion_cloud_backfill_p0a_v1_'

function legacyBackfillOpId(accountId: string, kind: string, entityId: string, stage = 'probe'): string {
  return [LEGACY_BACKFILL_VERSION, kind, encodeURIComponent(accountId), encodeURIComponent(entityId), stage].join(':')
}

function isLegacyProfileIdentityProbe(op: CloudStatePendingOp | null, accountId: string, entityId: string): boolean {
  return Boolean(op && op.opId === legacyBackfillOpId(accountId, 'profile-identity', entityId))
}

function hasPendingCloudOp(kind: string, entityId: string, sessionId?: string): boolean {
  const accountId = getAccount()?.account.trim() ?? ''
  return getPendingOps().some((op) =>
    op.type === 'cloud-state' &&
    op.kind === kind &&
    op.entityId === entityId &&
    (op.sessionId || undefined) === (sessionId || undefined) &&
    (!op.accountId || op.accountId === accountId),
  )
}

function explicitLocalIdentityMode(entityId: string): IdentityMode | null {
  const raw = record(readJson(aiProfileStorageKey(entityId)))
  return isIdentityMode(raw?.identityMode) ? raw.identityMode : null
}

function pendingProfileOps(entity: CloudStateEntity): CloudStatePendingOp[] {
  const accountId = getAccount()?.account.trim() ?? ''
  const sessionId = entity.entityId === GLOBAL ? undefined : entity.entityId
  return getPendingOps().filter((op): op is CloudStatePendingOp =>
    op.type === 'cloud-state' &&
    op.kind === 'profile' &&
    op.entityId === entity.entityId &&
    (op.sessionId || undefined) === sessionId &&
    (!op.accountId || op.accountId === accountId),
  )
}

/** 该实体最新一条 pending op（队尾 = 最新）。删除意图与编辑一视同仁，不往后翻找更旧的编辑。 */
function newestPendingProfileOp(entity: CloudStateEntity): CloudStatePendingOp | null {
  const ops = pendingProfileOps(entity)
  return ops.length ? ops[ops.length - 1] : null
}

function dropPendingProfileOps(entity: CloudStateEntity): void {
  for (const op of pendingProfileOps(entity)) removePendingOp(op.id)
}

function replacePendingProfileWithRebasedValue(
  entity: CloudStateEntity,
  profile: SyncedAIProfile,
): void {
  dropPendingProfileOps(entity)
  queue(
    'profile',
    entity.entityId,
    profile,
    false,
    entity.entityId === GLOBAL ? undefined : entity.entityId,
    undefined,
    entity.version,
  )
}

/** 最新 pending 是墓碑（角色已删）：只把墓碑重基到刚 pull 的 canonical version，绝不改成本地覆盖。 */
function rebasePendingProfileTombstone(entity: CloudStateEntity): void {
  dropPendingProfileOps(entity)
  queue(
    'profile',
    entity.entityId,
    undefined,
    true,
    entity.entityId === GLOBAL ? undefined : entity.entityId,
    undefined,
    entity.version,
  )
}

function applyAiProfileEntity(entity: CloudStateEntity): void {
  if (!entity.entityId) return
  const value = validAiProfile(entity.payload)
  if (!value) return
  const key = aiProfileStorageKey(entity.entityId)
  const newest = newestPendingProfileOp(entity)
  const accountId = getAccount()?.account.trim() ?? ''

  // 最新一条 pending 是墓碑（角色刚被删）时，删除意图优先：绝不写回本机资料、也不排非删除 op，
  // 只把墓碑重基到刚 pull 的 version。否则旧 baseVersion 的删除会被后续 conflict 掉，
  // 已删除角色的资料会在云端与本机一起复活。
  if (newest?.deleted) {
    rebasePendingProfileTombstone(entity)
    return
  }

  // P0-A 旧身份档补种是一次性 probe：baseVersion=0 只用来确认云端有没有 canonical。
  // 若云端已有 identityMode，云端直接赢；若只缺这一个字段，只把本机明确 identityMode
  // 合进刚拉到的 canonical，昵称/头像等字段绝不从旧设备整份覆盖。
  if (isLegacyProfileIdentityProbe(newest, accountId, entity.entityId)) {
    const probe = newest ? validAiProfile(newest.payload) : null
    const localMode = probe?.identityMode
    dropPendingProfileOps(entity)
    const merged = !isIdentityMode(value.identityMode) && isIdentityMode(localMode)
      ? { ...value, identityMode: localMode }
      : value
    localStorage.setItem(key, JSON.stringify(merged))
    profileSnapshot.set(entity.entityId, merged)
    if (!isIdentityMode(value.identityMode) && isIdentityMode(localMode)) {
      queue(
        'profile',
        entity.entityId,
        merged,
        false,
        entity.entityId === GLOBAL ? undefined : entity.entityId,
        undefined,
        entity.version,
        legacyBackfillOpId(accountId, 'profile-identity', entity.entityId, `repair-${entity.version}`),
      )
    }
    return
  }

  const pending = newest ? validAiProfile(newest.payload) : null
  let merged = mergeProfileIdentityField(localStorage.getItem(key), value)

  // pull 总是在 push 之前：本机刚改完 profile（包括身份模式）但 pending 还没上传时，
  // 旧云端 canonical 不能先把这次本地明确修改盖掉。保留最新 pending 的业务字段，
  // 再把同一实体重基到刚 pull 到的 version；这样刷新不会把 natural/AI 本体打回沉浸，
  // 同时也不会误丢与身份切换一起发生的昵称/头像本地修改。
  if (pending) merged = { ...merged, ...pending }

  localStorage.setItem(key, JSON.stringify(merged))
  const mergedValue = validAiProfile(merged)
  if (!mergedValue) return
  profileSnapshot.set(entity.entityId, mergedValue)

  const profileNeedsRepair = JSON.stringify(mergedValue) !== JSON.stringify(value)
  if (profileNeedsRepair) {
    replacePendingProfileWithRebasedValue(entity, mergedValue)
  }
}

function deleteAiProfileEntity(entity: CloudStateEntity): void {
  if (!entity.entityId) return
  localStorage.removeItem(aiProfileStorageKey(entity.entityId))
  profileSnapshot.delete(entity.entityId)
}

let defaultRoleSnapshot: string | null = null

function resetDefaultRoleSnapshot(): void {
  const accountId = getAccount()?.account ?? ''
  defaultRoleSnapshot = accountId ? (getDefaultRoleId(accountId) || null) : null
}

function captureDefaultRole(): void {
  const accountId = getAccount()?.account ?? ''
  if (!accountId) return
  const next = getDefaultRoleId(accountId) || null
  if (next === defaultRoleSnapshot) return
  if (next) queue('default_role', GLOBAL, { sessionId: next })
  else queue('default_role', GLOBAL, undefined, true)
  defaultRoleSnapshot = next
}

function applyDefaultRoleEntity(entity: CloudStateEntity): void {
  if (entity.entityId !== GLOBAL) return
  const accountId = getAccount()?.account ?? ''
  if (!accountId) return
  const sid = applyDefaultRoleFromCloud(accountId, entity.payload)
  if (!sid) return
  defaultRoleSnapshot = sid
  notifyDataChanged()
}

function deleteDefaultRoleEntity(entity: CloudStateEntity): void {
  if (entity.entityId !== GLOBAL) return
  const accountId = getAccount()?.account ?? ''
  if (!accountId) return
  deleteDefaultRoleFromCloud(accountId)
  defaultRoleSnapshot = null
  notifyDataChanged()
}

interface ReplyLengthEntity {
  sessionId: string
  mode: ReplyLength
  followGlobal: boolean
}

function replyLengthPreferenceEntities(): Map<string, ReplyLengthEntity> {
  const out = new Map<string, ReplyLengthEntity>()
  const accountId = getAccount()?.account ?? ''
  if (!accountId) return out
  const sessionIds = getSessionsCache().map((session) => String(session.id))
  for (const [sessionId, preference] of collectStoredReplyLengthPreferences(accountId, sessionIds)) {
    out.set(sessionId, {
      sessionId,
      mode: preference.mode,
      followGlobal: preference.followGlobal,
    })
  }
  return out
}

let globalReplyLengthSnapshot: ReplyLength | null = null
let replyLengthPreferenceSnapshot = new Map<string, ReplyLengthEntity>()

function resetReplyLengthSnapshot(): void {
  const accountId = getAccount()?.account ?? ''
  globalReplyLengthSnapshot = accountId ? getStoredGlobalReplyLength(accountId) : null
  replyLengthPreferenceSnapshot = replyLengthPreferenceEntities()
}

function captureReplyLengths(): void {
  const accountId = getAccount()?.account ?? ''
  if (!accountId) return

  const nextGlobal = getStoredGlobalReplyLength(accountId)
  if (nextGlobal !== globalReplyLengthSnapshot) {
    if (nextGlobal) queue('reply_length_global', GLOBAL, { mode: nextGlobal })
    else queue('reply_length_global', GLOBAL, undefined, true)
    globalReplyLengthSnapshot = nextGlobal
  }

  const next = replyLengthPreferenceEntities()
  for (const [sessionId, value] of next) {
    const previous = replyLengthPreferenceSnapshot.get(sessionId)
    if (!previous || previous.mode !== value.mode || previous.followGlobal !== value.followGlobal) {
      queue(
        'reply_length',
        sessionId,
        { mode: value.mode, followGlobal: value.followGlobal },
        false,
        sessionId,
      )
    }
  }
  for (const [sessionId, value] of replyLengthPreferenceSnapshot) {
    if (!next.has(sessionId)) queue('reply_length', sessionId, undefined, true, value.sessionId)
  }
  replyLengthPreferenceSnapshot = next
}

/**
 * P0-A：把 Cloud State 上线前已经存在的显式身份/回复长度补种一次。
 * 不加新协议：全部仍走现有 outbox + pull-before-push。
 * probe 固定 baseVersion=0：云端已有实体时一定 conflict/拉 canonical，绝不让旧设备直接覆盖；
 * 云端没有实体时才创建。profile conflict 见 applyAiProfileEntity，只允许补 identityMode 一个字段。
 */
export function queueLegacyCloudStateBackfill(): void {
  const account = getAccount()
  if (!account) return
  const accountId = account.account.trim()
  if (!accountId) return
  const marker = `${LEGACY_BACKFILL_MARKER_PREFIX}${encodeURIComponent(accountId)}`
  if (localStorage.getItem(marker) === '1') return

  const profiles = profileEntities()
  for (const [entityId, value] of profiles) {
    if (entityId === GLOBAL) continue
    const sessionId = entityId
    if (!explicitLocalIdentityMode(entityId) || hasPendingCloudOp('profile', entityId, sessionId)) continue
    queue(
      'profile',
      entityId,
      value,
      false,
      sessionId,
      undefined,
      0,
      legacyBackfillOpId(accountId, 'profile-identity', entityId),
    )
  }

  const globalReply = getStoredGlobalReplyLength(accountId)
  if (globalReply && !hasPendingCloudOp('reply_length_global', GLOBAL)) {
    queue(
      'reply_length_global',
      GLOBAL,
      { mode: globalReply },
      false,
      undefined,
      undefined,
      0,
      legacyBackfillOpId(accountId, 'reply-length-global', GLOBAL),
    )
  }

  for (const [sessionId, value] of replyLengthPreferenceEntities()) {
    if (hasPendingCloudOp('reply_length', sessionId, sessionId)) continue
    queue(
      'reply_length',
      sessionId,
      { mode: value.mode, followGlobal: value.followGlobal },
      false,
      sessionId,
      undefined,
      0,
      legacyBackfillOpId(accountId, 'reply-length', sessionId),
    )
  }

  localStorage.setItem(marker, '1')
}

function applyGlobalReplyLengthEntity(entity: CloudStateEntity): void {
  if (entity.entityId !== GLOBAL) return
  const accountId = getAccount()?.account ?? ''
  if (!accountId) return
  const mode = applyGlobalReplyLengthFromCloud(accountId, entity.payload)
  if (!mode) return
  globalReplyLengthSnapshot = mode
  notifyDataChanged()
}

function deleteGlobalReplyLengthEntity(entity: CloudStateEntity): void {
  if (entity.entityId !== GLOBAL) return
  const accountId = getAccount()?.account ?? ''
  if (!accountId) return
  deleteGlobalReplyLengthFromCloud(accountId)
  globalReplyLengthSnapshot = null
  notifyDataChanged()
}

function applyReplyLengthEntity(entity: CloudStateEntity): void {
  const accountId = getAccount()?.account ?? ''
  const sessionId = entity.sessionId || entity.entityId
  if (!accountId || !sessionId || entity.entityId !== sessionId) return
  const preference = applyReplyLengthPreferenceFromCloud(accountId, sessionId, entity.payload)
  if (!preference) return
  replyLengthPreferenceSnapshot.set(sessionId, {
    sessionId,
    mode: preference.mode,
    followGlobal: preference.followGlobal,
  })
  notifyDataChanged()
}

function deleteReplyLengthEntity(entity: CloudStateEntity): void {
  const accountId = getAccount()?.account ?? ''
  const sessionId = entity.sessionId || entity.entityId
  if (!accountId || !sessionId || entity.entityId !== sessionId) return
  deleteReplyLengthOverrideFromCloud(accountId, sessionId)
  replyLengthPreferenceSnapshot.delete(sessionId)
  notifyDataChanged()
}

// ── 会话起点（刷新对话）跨设备：session 级实体 ──
// 任一设备刷新当前会话后，同账号其他设备也使用新的上下文起点。
// 只推进、不回退；聊天历史本身不删除。
let sessionStartSnapshot = new Map<string, number>()

function sessionStartEntities(): Map<string, number> {
  const out = new Map<string, number>()
  for (const session of getSessionsCache()) {
    const sid = String(session.id)
    if (!sid) continue
    const ts = getSessionStart(sid)
    if (ts > 0) out.set(sid, ts)
  }
  return out
}

function resetSessionStartSnapshot(): void {
  sessionStartSnapshot = getAccount() ? sessionStartEntities() : new Map()
}

function captureSessionStarts(): void {
  if (!getAccount()) return
  const next = sessionStartEntities()
  for (const [sessionId, ts] of next) {
    if (sessionStartSnapshot.get(sessionId) !== ts) {
      queue('session_start', sessionId, { ts }, false, sessionId)
    }
  }
  for (const [sessionId] of sessionStartSnapshot) {
    if (!next.has(sessionId)) queue('session_start', sessionId, undefined, true, sessionId)
  }
  sessionStartSnapshot = next
}

function applySessionStartEntity(entity: CloudStateEntity): void {
  const sessionId = entity.sessionId || entity.entityId
  if (!sessionId || entity.entityId !== sessionId) return
  const raw = (entity.payload as { ts?: unknown } | null)?.ts
  const ts = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(ts) || ts <= 0) return

  const local = getSessionStart(sessionId)
  // 刷新起点只能往前走：本机若更新，就把更新值重新排队回云端，而不是被旧值覆盖。
  if (local > ts) {
    queue('session_start', sessionId, { ts: local }, false, sessionId)
    sessionStartSnapshot.set(sessionId, local)
    return
  }

  setSessionStart(ts, sessionId)
  sessionStartSnapshot.set(sessionId, ts)
  notifyDataChanged()
}

function deleteSessionStartEntity(entity: CloudStateEntity): void {
  const sessionId = entity.sessionId || entity.entityId
  if (!sessionId || entity.entityId !== sessionId) return
  setSessionStart(0, sessionId)
  sessionStartSnapshot.delete(sessionId)
  notifyDataChanged()
}

let initialized = false
export function initCloudStateResourceAdapters(): void {
  if (initialized) return
  initialized = true
  resetPersonalSnapshot()
  resetAnniversarySnapshot()
  resetSpaceSnapshot()
  resetRuntimeSnapshot()
  resetWeeklySnapshot()
  resetProfileSnapshot()
  resetDefaultRoleSnapshot()
  resetReplyLengthSnapshot()
  resetSessionStartSnapshot()
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
  registerCloudStateAdapter('weekly_review', {
    apply: applyWeeklyEntity,
    delete: deleteWeeklyEntity,
  })
  registerCloudStateAdapter('profile', {
    apply: applyAiProfileEntity,
    delete: deleteAiProfileEntity,
  })
  registerCloudStateAdapter('default_role', {
    apply: applyDefaultRoleEntity,
    delete: deleteDefaultRoleEntity,
  })
  registerCloudStateAdapter('reply_length_global', {
    apply: applyGlobalReplyLengthEntity,
    delete: deleteGlobalReplyLengthEntity,
  })
  registerCloudStateAdapter('reply_length', {
    apply: applyReplyLengthEntity,
    delete: deleteReplyLengthEntity,
  })
  registerCloudStateAdapter('session_start', {
    apply: applySessionStartEntity,
    delete: deleteSessionStartEntity,
  })
  if (typeof window !== 'undefined') window.addEventListener(ELUVIN_DATA_CHANGE, capturePersonalDays)
  if (typeof window !== 'undefined') window.addEventListener(ELUVIN_DATA_CHANGE, captureAnniversaries)
  if (typeof window !== 'undefined') window.addEventListener(ELUVIN_DATA_CHANGE, captureSpacePosts)
  if (typeof window !== 'undefined') window.addEventListener(ELUVIN_DATA_CHANGE, captureTaRuntime)
  if (typeof window !== 'undefined') window.addEventListener(ELUVIN_DATA_CHANGE, captureWeeklyReviews)
  if (typeof window !== 'undefined') window.addEventListener(ELUVIN_DATA_CHANGE, captureAiProfiles)
  if (typeof window !== 'undefined') window.addEventListener(ELUVIN_DATA_CHANGE, captureDefaultRole)
  if (typeof window !== 'undefined') window.addEventListener(ELUVIN_DATA_CHANGE, captureReplyLengths)
  if (typeof window !== 'undefined') window.addEventListener(ELUVIN_DATA_CHANGE, captureSessionStarts)
  if (typeof window !== 'undefined') window.addEventListener(ELUVIN_AUTH_CHANGE, () => { resetPersonalSnapshot(); resetAnniversarySnapshot(); resetSpaceSnapshot(); resetRuntimeSnapshot(); resetWeeklySnapshot(); resetProfileSnapshot(); resetDefaultRoleSnapshot(); resetReplyLengthSnapshot(); resetSessionStartSnapshot() })
}
