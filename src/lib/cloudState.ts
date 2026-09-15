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
let triggerTimer: ReturnType<typeof setTimeout> | null = null
let listenersStarted = false

function accountKey(account: string): string {
  // Preserve the authenticated identifier exactly: the client must not assume the
  // server treats usernames (or every future identity type) as case-insensitive.
  return account.trim()
}

function entityKey(kind: string, entityId: string): string {
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
  return {
    cursor: Number.isFinite(saved?.cursor) && saved.cursor >= 0 ? saved.cursor : 0,
    versions: saved?.versions && typeof saved.versions === 'object' ? { ...saved.versions } : {},
  }
}

function writeMetadata(account: string, metadata: AccountMetadata): void {
  const root = readRoot()
  root.accounts[accountKey(account)] = metadata
  localStorage.setItem(METADATA_KEY, JSON.stringify(root))
}

export function getCloudStateCursor(account = getAccount()?.account): number {
  return account ? readMetadata(account).cursor : 0
}

export function getCloudStateVersion(kind: string, entityId: string, account = getAccount()?.account): number {
  return account ? (readMetadata(account).versions[entityKey(kind, entityId)] ?? 0) : 0
}

function saveVersion(account: string, entity: CloudStateEntity): void {
  if (!Number.isFinite(entity.version)) return
  const metadata = readMetadata(account)
  metadata.versions[entityKey(entity.kind, entity.entityId)] = entity.version
  writeMetadata(account, metadata)
}

export function registerCloudStateAdapter(kind: string, adapter: CloudStateAdapter): () => void {
  adapters.set(kind, adapter)
  return () => {
    if (adapters.get(kind) === adapter) adapters.delete(kind)
  }
}

async function applyEntity(account: string, entity: CloudStateEntity): Promise<void> {
  const knownVersion = getCloudStateVersion(entity.kind, entity.entityId, account)
  if (Number.isFinite(entity.version) && entity.version <= knownVersion) return
  const adapter = adapters.get(entity.kind)
  if (adapter) {
    const context: CloudStateApplyContext = { source: 'cloud', silent: true }
    if (entity.deleted) await adapter.delete(entity, context)
    else await adapter.apply(entity, context)
  }
  // Unknown kinds are deliberately consumed so an older client cannot pin its cursor forever.
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
    try {
      const pulled = await pullCloudState()
      if (!pulled) return // Another tab owns this round; it will commit the shared cursor.
    } catch {
      return // Pull must succeed before pushing stale local operations.
    }
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
