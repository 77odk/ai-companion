import { API_BASE, getAccount, type Account } from './sync.ts'
import {
  addPendingOp,
  getPendingOps,
  removePendingOp,
  type CloudStatePendingOp,
} from './sessionStore.ts'

const METADATA_KEY = 'ai_companion_cloud_state_metadata'
const LOCK_PREFIX = 'ai_companion_cloud_state_lock_'
const LOCK_TTL_MS = 30_000
const MAX_PULL_PAGES = 10_000
const PUSH_BATCH_SIZE = 100

export interface CloudStateEntity {
  kind: string
  entityId: string
  sessionId?: string
  generationSlotId?: string
  version: number
  deleted?: boolean
  payload?: unknown
}

export interface CloudStateApplyContext {
  source: 'cloud'
  silent: true
}

export interface CloudStateAdapter {
  apply(entity: CloudStateEntity, context: CloudStateApplyContext): void | Promise<void>
  delete(entity: CloudStateEntity, context: CloudStateApplyContext): void | Promise<void>
}

interface AccountMetadata {
  cursor: number
  versions: Record<string, number>
  /** Server-seen entities whose business adapter was unavailable at pull time. */
  inbox: Record<string, CloudStateEntity>
}

interface MetadataRoot {
  accounts: Record<string, AccountMetadata>
}

interface PullResponse {
  ok?: boolean
  cursor: number
  serverRevision: number
  hasMore: boolean
  changes: CloudStateEntity[]
}

type PushStatus = 'applied' | 'conflict' | 'duplicate' | 'invalid' | 'error'
interface PushResult {
  opId?: string
  status?: PushStatus
  result?: PushStatus
  version?: number
  entity?: CloudStateEntity
}

const adapters = new Map<string, CloudStateAdapter>()
const localFlights = new Map<string, Promise<boolean>>()
const syncFlights = new Map<string, Promise<void>>()
const flushFlights = new Map<string, Promise<void>>()
const replayFlights = new Map<string, Promise<void>>()
let triggerTimer: ReturnType<typeof setTimeout> | null = null
let listenersStarted = false

function accountKey(account: string): string {
  // Preserve the authenticated identifier exactly: the client must not assume the
  // server treats usernames (or every future identity type) as case-insensitive.
  return account.trim()
}

function normalizedSessionId(sessionId?: string | null): string {
  return sessionId || ''
}

function entityKey(kind: string, entityId: string, sessionId?: string | null): string {
  return `${kind}\u0000${normalizedSessionId(sessionId)}\u0000${entityId}`
}

function legacyEntityKey(kind: string, entityId: string): string {
  return `${kind}\u0000${entityId}`
}

function isCurrentAccount(account: Account): boolean {
  const current = getAccount()
  return current?.token === account.token && current.account === account.account
}

function readRoot(): MetadataRoot {
  try {
    const value = JSON.parse(localStorage.getItem(METADATA_KEY) ?? '') as Partial<MetadataRoot>
    if (value && value.accounts && typeof value.accounts === 'object') {
      return { accounts: value.accounts as Record<string, AccountMetadata> }
    }
  } catch {
    // Corrupt metadata must never affect business data or app startup.
  }
  return { accounts: {} }
}

function readMetadata(account: string): AccountMetadata {
  const saved = readRoot().accounts[accountKey(account)]
  const metadata = {
    cursor: Number.isFinite(saved?.cursor) && saved.cursor >= 0 ? saved.cursor : 0,
    versions: saved?.versions && typeof saved.versions === 'object' ? { ...saved.versions } : {},
    inbox: saved?.inbox && typeof saved.inbox === 'object' ? { ...saved.inbox } : {},
  }
  // Deployed metadata keyed inbox entries by kind+entityId. Inbox values retain
  // sessionId, so they can be migrated losslessly without resetting the cursor.
  let changed = false
  for (const [key, entity] of Object.entries(metadata.inbox)) {
    const scopedKey = entityKey(entity.kind, entity.entityId, entity.sessionId)
    if (key === scopedKey) continue
    const existing = metadata.inbox[scopedKey]
    if (!existing || existing.version < entity.version) metadata.inbox[scopedKey] = entity
    delete metadata.inbox[key]
    changed = true
  }
  if (changed) writeMetadata(account, metadata)
  return metadata
}

function writeMetadata(account: string, metadata: AccountMetadata): void {
  const root = readRoot()
  root.accounts[accountKey(account)] = metadata
  localStorage.setItem(METADATA_KEY, JSON.stringify(root))
}

function writeMetadataReliably(account: string, metadata: AccountMetadata): void {
  const root = readRoot()
  root.accounts[accountKey(account)] = metadata
  const serialized = JSON.stringify(root)
  localStorage.setItem(METADATA_KEY, serialized)
  if (localStorage.getItem(METADATA_KEY) !== serialized) throw new Error('cloud_state_metadata_not_persisted')
}

export function getCloudStateCursor(account = getAccount()?.account): number {
  return account ? readMetadata(account).cursor : 0
}

export function getCloudStateVersion(kind: string, entityId: string, account = getAccount()?.account, sessionId?: string): number {
  if (!account) return 0
  const metadata = readMetadata(account)
  const key = entityKey(kind, entityId, sessionId)
  const current = metadata.versions[key]
  if (current != null) return current
  const legacyKey = legacyEntityKey(kind, entityId)
  const legacy = metadata.versions[legacyKey]
  if (legacy == null) return 0
  metadata.versions[key] = legacy
  delete metadata.versions[legacyKey]
  writeMetadata(account, metadata)
  return legacy
}

/** Test/debug surface and future adapter support; returns a copy in stable replay order. */
export function getCloudStateInbox(kind?: string, account = getAccount()?.account): CloudStateEntity[] {
  if (!account) return []
  return Object.values(readMetadata(account).inbox)
    .filter(entity => kind == null || entity.kind === kind)
    .sort((a, b) => a.version - b.version || a.kind.localeCompare(b.kind) || a.entityId.localeCompare(b.entityId))
    .map(entity => ({ ...entity }))
}

function saveVersion(account: string, entity: CloudStateEntity): void {
  if (!Number.isFinite(entity.version)) return
  const metadata = readMetadata(account)
  metadata.versions[entityKey(entity.kind, entity.entityId, entity.sessionId)] = entity.version
  delete metadata.versions[legacyEntityKey(entity.kind, entity.entityId)]
  writeMetadata(account, metadata)
}

export function registerCloudStateAdapter(kind: string, adapter: CloudStateAdapter): () => void {
  adapters.set(kind, adapter)
  void replayCloudStateInbox(kind)
  return () => {
    if (adapters.get(kind) === adapter) adapters.delete(kind)
  }
}

function normalizedEntity(entity: CloudStateEntity): CloudStateEntity {
  return {
    kind: entity.kind,
    entityId: entity.entityId,
    ...(entity.sessionId === undefined ? {} : { sessionId: entity.sessionId }),
    ...(entity.generationSlotId === undefined ? {} : { generationSlotId: entity.generationSlotId }),
    version: entity.version,
    ...(entity.deleted === undefined ? {} : { deleted: entity.deleted }),
    ...(entity.payload === undefined ? {} : { payload: entity.payload }),
  }
}

function saveUnknownEntity(account: string, entity: CloudStateEntity): void {
  const metadata = readMetadata(account)
  const key = entityKey(entity.kind, entity.entityId, entity.sessionId)
  const existing = metadata.inbox[key]
  if (existing && existing.version >= entity.version) return
  metadata.inbox[key] = normalizedEntity(entity)
  // Cursor may advance only if the unknown entity is durably recoverable later.
  writeMetadataReliably(account, metadata)
}

async function replayInboxForAccount(account: Account, kind?: string): Promise<void> {
  for (const entity of getCloudStateInbox(kind, account.account)) {
    if (!isCurrentAccount(account)) return
    const adapter = adapters.get(entity.kind)
    if (!adapter) continue
    const key = entityKey(entity.kind, entity.entityId, entity.sessionId)
    try {
      const appliedVersion = getCloudStateVersion(entity.kind, entity.entityId, account.account, entity.sessionId)
      if (entity.version > appliedVersion) {
        const context: CloudStateApplyContext = { source: 'cloud', silent: true }
        if (entity.deleted) await adapter.delete(entity, context)
        else await adapter.apply(entity, context)
        saveVersion(account.account, entity)
      }
      const metadata = readMetadata(account.account)
      // Do not delete a newer entity that arrived while an async adapter was running.
      if (metadata.inbox[key]?.version === entity.version) {
        delete metadata.inbox[key]
        writeMetadataReliably(account.account, metadata)
      }
    } catch (error) {
      console.warn('Cloud State inbox replay failed', entity.kind, entity.entityId, error)
      // This entity remains durable; other entities can still make progress.
    }
  }
}

export function replayCloudStateInbox(kind?: string): Promise<void> {
  const account = getAccount()
  if (!account) return Promise.resolve()
  const key = accountKey(account.account)
  const previous = replayFlights.get(key) ?? Promise.resolve()
  const flight = previous.catch(() => {}).then(() => replayInboxForAccount(account, kind)).finally(() => {
    if (replayFlights.get(key) === flight) replayFlights.delete(key)
  })
  replayFlights.set(key, flight)
  return flight
}

async function applyEntity(account: string, entity: CloudStateEntity): Promise<void> {
  const knownVersion = getCloudStateVersion(entity.kind, entity.entityId, account, entity.sessionId)
  if (Number.isFinite(entity.version) && entity.version <= knownVersion) return
  const adapter = adapters.get(entity.kind)
  if (!adapter) {
    saveUnknownEntity(account, entity)
    return
  }
  const context: CloudStateApplyContext = { source: 'cloud', silent: true }
  if (entity.deleted) await adapter.delete(entity, context)
  else await adapter.apply(entity, context)
  saveVersion(account, entity)
}

async function requestPull(account: Account, cursor: number): Promise<PullResponse> {
  const response = await fetch(`${API_BASE}/api/state/pull?cursor=${encodeURIComponent(cursor)}`, {
    headers: { Authorization: `Bearer ${account.token}` },
  })
  if (!response.ok) throw new Error(`cloud_state_pull_${response.status}`)
  const body = await response.json() as PullResponse
  if (!Array.isArray(body.changes) || !Number.isFinite(body.cursor)) throw new Error('cloud_state_pull_invalid')
  return body
}

async function pullPages(account: Account): Promise<void> {
  for (let page = 0; page < MAX_PULL_PAGES; page++) {
    if (!isCurrentAccount(account)) throw new Error('cloud_state_account_changed')
    // Re-read shared metadata for every page; never continue from a stale in-memory cursor.
    const before = readMetadata(account.account)
    const body = await requestPull(account, before.cursor)
    for (const change of body.changes) {
      if (!isCurrentAccount(account)) throw new Error('cloud_state_account_changed')
      await applyEntity(account.account, change)
    }
    if (!isCurrentAccount(account)) throw new Error('cloud_state_account_changed')
    const after = readMetadata(account.account)
    after.cursor = body.cursor
    writeMetadata(account.account, after)
    if (!body.hasMore) return
    if (body.cursor === before.cursor) throw new Error('cloud_state_pull_cursor_stalled')
  }
  throw new Error('cloud_state_pull_too_many_pages')
}

function lockName(account: string): string {
  return `eluvin-cloud-state:${accountKey(account)}`
}

async function withFallbackLock(account: string, task: () => Promise<void>): Promise<boolean> {
  const key = `${LOCK_PREFIX}${accountKey(account)}`
  const owner = `${Date.now()}_${Math.random().toString(36).slice(2)}`
  const now = Date.now()
  try {
    const existing = JSON.parse(localStorage.getItem(key) ?? 'null') as { owner?: string; expires?: number } | null
    if (existing?.expires && existing.expires > now) return false
    localStorage.setItem(key, JSON.stringify({ owner, expires: now + LOCK_TTL_MS }))
    await Promise.resolve()
    const acquired = JSON.parse(localStorage.getItem(key) ?? 'null') as { owner?: string } | null
    if (acquired?.owner !== owner) return false
    const heartbeat = setInterval(() => {
      try {
        const current = JSON.parse(localStorage.getItem(key) ?? 'null') as { owner?: string } | null
        if (current?.owner === owner) {
          localStorage.setItem(key, JSON.stringify({ owner, expires: Date.now() + LOCK_TTL_MS }))
        }
      } catch {
        // Losing the lease only makes the next run replay idempotently from the committed cursor.
      }
    }, LOCK_TTL_MS / 3)
    try {
      await task()
    } finally {
      clearInterval(heartbeat)
    }
    return true
  } finally {
    try {
      const current = JSON.parse(localStorage.getItem(key) ?? 'null') as { owner?: string } | null
      if (current?.owner === owner) localStorage.removeItem(key)
    } catch {
      // An expired/corrupt lease is safe to replace on the next attempt.
    }
  }
}

async function withCrossTabLock(account: string, task: () => Promise<void>): Promise<boolean> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (locks?.request) {
    let ran = false
    await locks.request(lockName(account), { ifAvailable: true }, async lock => {
      if (!lock) return
      ran = true
      await task()
    })
    return ran
  }
  return withFallbackLock(account, task)
}

/** Pull is single-flight in this tab and guarded across tabs for the same account. */
export function pullCloudState(): Promise<boolean> {
  const account = getAccount()
  if (!account) return Promise.resolve(false)
  const key = accountKey(account.account)
  const active = localFlights.get(key)
  if (active) return active
  const flight = withCrossTabLock(account.account, () => pullPages(account)).finally(() => localFlights.delete(key))
  localFlights.set(key, flight)
  return flight
}

export function enqueueCloudStateOp(op: Omit<CloudStatePendingOp, 'id' | 'type' | 'ts' | 'createdAt'> & Partial<Pick<CloudStatePendingOp, 'id' | 'ts' | 'createdAt'>>): CloudStatePendingOp {
  const now = Date.now()
  const queued: CloudStatePendingOp = {
    ...op,
    id: op.id ?? op.opId,
    type: 'cloud-state',
    ts: op.ts ?? now,
    createdAt: op.createdAt ?? now,
    accountId: accountKey(getAccount()?.account ?? ''),
  }
  addPendingOp(queued)
  return queued
}

function asEntity(result: PushResult, op: CloudStatePendingOp): CloudStateEntity | null {
  if (result.entity) return result.entity
  if (!Number.isFinite(result.version)) return null
  return { ...op, version: result.version as number }
}

async function flushBatch(account: Account, ops: CloudStatePendingOp[]): Promise<boolean> {
  if (!isCurrentAccount(account)) return false
  const response = await fetch(`${API_BASE}/api/state/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${account.token}` },
    body: JSON.stringify({ ops: ops.map(({ type: _type, id: _id, ts: _ts, createdAt: _createdAt, accountId: _accountId, ...op }) => op) }),
  })
  if (!response.ok) return false
  const body = await response.json() as { results?: PushResult[] }
  if (!Array.isArray(body.results)) return false
  for (let index = 0; index < ops.length; index++) {
    if (!isCurrentAccount(account)) return false
    const op = ops[index]
    const result = body.results.find(item => item.opId === op.opId) ?? body.results[index]
    const status = result?.status ?? result?.result
    if (status === 'error' || !status) continue
    if (status === 'conflict') {
      if (!result.entity) continue
      await applyEntity(account.account, result.entity)
      removePendingOp(op.id)
    } else if (status === 'applied' || status === 'duplicate') {
      const entity = asEntity(result, op)
      if (entity) saveVersion(account.account, entity)
      removePendingOp(op.id)
    } else if (status === 'invalid') {
      console.warn('Cloud State op rejected as invalid', op.opId)
      removePendingOp(op.id)
    }
  }
  return true
}

async function flushPendingForAccount(account: Account): Promise<void> {
  const currentAccount = accountKey(account.account)
  const pending = getPendingOps().filter(
    (op): op is CloudStatePendingOp => op.type === 'cloud-state' && (!op.accountId || op.accountId === currentAccount),
  )
  for (let offset = 0; offset < pending.length; offset += PUSH_BATCH_SIZE) {
    try {
      if (!await flushBatch(account, pending.slice(offset, offset + PUSH_BATCH_SIZE))) return
    } catch {
      return // Network/503/invalid response: preserve this batch and every later op.
    }
  }
}

export function flushCloudStatePendingOps(): Promise<void> {
  const account = getAccount()
  if (!account) return Promise.resolve()
  const key = accountKey(account.account)
  const active = flushFlights.get(key)
  if (active) return active
  const flight = flushPendingForAccount(account).finally(() => flushFlights.delete(key))
  flushFlights.set(key, flight)
  return flight
}

export function syncCloudState(): Promise<void> {
  const account = getAccount()
  if (!account) return Promise.resolve()
  const key = accountKey(account.account)
  const active = syncFlights.get(key)
  if (active) return active
  const flight = (async () => {
    // A previously failed inbox replay is independent of network availability.
    await replayCloudStateInbox()
    try {
      const pulled = await pullCloudState()
      if (!pulled) return // Another tab owns this round; it will commit the shared cursor.
    } catch {
      return // Pull must succeed before pushing stale local operations.
    }
    await replayCloudStateInbox()
    await flushCloudStatePendingOps()
  })().finally(() => syncFlights.delete(key))
  syncFlights.set(key, flight)
  return flight
}

function scheduleCloudStateSync(): void {
  if (!getAccount()) return
  if (triggerTimer) clearTimeout(triggerTimer)
  triggerTimer = setTimeout(() => {
    triggerTimer = null
    void syncCloudState()
  }, 300)
}

/** Queue a non-blocking sync after a local business-resource write. */
export function requestCloudStateSync(): void {
  scheduleCloudStateSync()
}

/** Install debounced online/visible retry hooks once; initial local rendering is never awaited. */
export function initCloudStateSync(): void {
  if (typeof window === 'undefined' || listenersStarted) return
  listenersStarted = true
  window.addEventListener('online', scheduleCloudStateSync)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleCloudStateSync()
  })
  scheduleCloudStateSync()
}
