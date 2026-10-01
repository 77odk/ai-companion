import {
  enqueueCloudStateOp,
  getCloudStateVersion,
  registerCloudStateAdapter,
  requestCloudStateSync,
  type CloudStateEntity,
} from './cloudState.ts'
import { ELUVIN_AUTH_CHANGE, notifyDataChanged } from './dataChange.ts'
import { getAccount } from './sync.ts'
import { getPendingOps, removePendingOp, type CloudStatePendingOp } from './sessionStore.ts'
import type { StoredMessage } from './storage.ts'

export const MESSAGE_MUTATION_KIND = 'message_mutation'
const KEY_PREFIX = 'ai_companion_message_mutations_'

export interface MessageMutation {
  sessionId: string
  messageId: number
  /** true = hidden from the active conversation; the immutable backend message remains intact. */
  hidden?: true
  /** Active transcript text override. The backend message body remains the original audit copy. */
  contentOverride?: string
  updatedAt: number
}

function keyOf(sessionId: string): string {
  return `${KEY_PREFIX}${sessionId}`
}

function normalizeMutation(
  value: unknown,
  expectedSessionId?: string,
  expectedMessageId?: number,
): MessageMutation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Partial<MessageMutation>
  const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId.trim() : ''
  const messageId = Number(raw.messageId)
  const updatedAt = Number(raw.updatedAt)
  if (!sessionId || !Number.isInteger(messageId) || messageId <= 0 || !Number.isFinite(updatedAt) || updatedAt <= 0) return null
  if (expectedSessionId && sessionId !== expectedSessionId) return null
  if (expectedMessageId != null && messageId !== expectedMessageId) return null

  const contentOverride =
    typeof raw.contentOverride === 'string' && raw.contentOverride.trim()
      ? raw.contentOverride.trim()
      : undefined
  const hidden = raw.hidden === true ? true : undefined
  if (!hidden && !contentOverride) return null

  return {
    sessionId,
    messageId,
    ...(hidden ? { hidden: true as const } : {}),
    ...(contentOverride ? { contentOverride } : {}),
    updatedAt,
  }
}

function readRaw(sessionId: string): MessageMutation[] {
  try {
    const raw = JSON.parse(localStorage.getItem(keyOf(sessionId)) ?? '[]')
    if (!Array.isArray(raw)) return []
    const byId = new Map<number, MessageMutation>()
    for (const value of raw) {
      const item = normalizeMutation(value, sessionId)
      if (!item) continue
      const previous = byId.get(item.messageId)
      if (!previous || item.updatedAt >= previous.updatedAt) byId.set(item.messageId, item)
    }
    return [...byId.values()].sort((a, b) => a.messageId - b.messageId)
  } catch {
    return []
  }
}

function writeRaw(sessionId: string, list: MessageMutation[], notify = true): void {
  try {
    if (list.length === 0) localStorage.removeItem(keyOf(sessionId))
    else localStorage.setItem(keyOf(sessionId), JSON.stringify(list))
  } catch {
    return
  }
  if (notify) notifyDataChanged()
}

function upsertLocal(mutation: MessageMutation, notify = true): void {
  const list = readRaw(mutation.sessionId)
  const next = list.filter(item => item.messageId !== mutation.messageId)
  next.push(mutation)
  writeRaw(mutation.sessionId, next, notify)
}

function removeLocal(sessionId: string, messageId: number, notify = true): void {
  const current = readRaw(sessionId)
  const next = current.filter(item => item.messageId !== messageId)
  if (next.length === current.length) return
  writeRaw(sessionId, next, notify)
}

export function loadMessageMutations(sessionId: string): MessageMutation[] {
  return readRaw(sessionId)
}

export function getMessageMutation(sessionId: string, messageId: number): MessageMutation | null {
  return readRaw(sessionId).find(item => item.messageId === messageId) ?? null
}

/**
 * Applies only the active-view overlay. The input array is never mutated or persisted,
 * so the session cache remains the immutable/raw transcript fetched from the backend.
 */
export function applyMessageMutations(sessionId: string, messages: StoredMessage[]): StoredMessage[] {
  const mutations = new Map(readRaw(sessionId).map(item => [item.messageId, item]))
  const out: StoredMessage[] = []
  for (const message of messages ?? []) {
    const id = typeof message?.id === 'number' && Number.isInteger(message.id) ? message.id : null
    const mutation = id == null ? undefined : mutations.get(id)
    if (mutation?.hidden) continue
    out.push(mutation?.contentOverride ? { ...message, content: mutation.contentOverride } : message)
  }
  return out
}

function newOpId(): string {
  try {
    return globalThis.crypto?.randomUUID?.() ?? `message-mutation-${Date.now()}-${Math.random().toString(36).slice(2)}`
  } catch {
    return `message-mutation-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

function entityIdOf(messageId: number): string {
  return String(messageId)
}

function queueMutation(
  sessionId: string,
  messageId: number,
  payload: MessageMutation | undefined,
  deleted: boolean,
  baseVersion = getCloudStateVersion(MESSAGE_MUTATION_KIND, entityIdOf(messageId), undefined, sessionId),
): void {
  if (!getAccount()) return
  enqueueCloudStateOp({
    opId: newOpId(),
    kind: MESSAGE_MUTATION_KIND,
    entityId: entityIdOf(messageId),
    sessionId,
    baseVersion,
    ...(deleted ? { deleted: true } : { payload }),
  })
  requestCloudStateSync()
}

function setLocalMutation(
  sessionId: string,
  messageId: number,
  patch: { hidden?: boolean; contentOverride?: string | null },
): MessageMutation | null {
  const sid = sessionId.trim()
  if (!sid || !Number.isInteger(messageId) || messageId <= 0) return null
  const previous = getMessageMutation(sid, messageId)
  const contentOverride =
    patch.contentOverride === null
      ? undefined
      : patch.contentOverride === undefined
        ? previous?.contentOverride
        : patch.contentOverride.trim() || undefined
  const hidden =
    patch.hidden === undefined
      ? previous?.hidden === true
      : patch.hidden === true

  if (!hidden && !contentOverride) {
    removeLocal(sid, messageId)
    queueMutation(sid, messageId, undefined, true)
    return null
  }

  const next: MessageMutation = {
    sessionId: sid,
    messageId,
    ...(hidden ? { hidden: true } : {}),
    ...(contentOverride ? { contentOverride } : {}),
    updatedAt: Date.now(),
  }
  upsertLocal(next)
  queueMutation(sid, messageId, next, false)
  return next
}

export function setMessageHidden(sessionId: string, messageId: number, hidden = true): MessageMutation | null {
  return setLocalMutation(sessionId, messageId, { hidden })
}

export function setMessageContentOverride(
  sessionId: string,
  messageId: number,
  contentOverride: string | null,
): MessageMutation | null {
  return setLocalMutation(sessionId, messageId, { contentOverride })
}

/** Restore the immutable backend message exactly as originally stored. */
export function clearMessageMutation(sessionId: string, messageId: number): void {
  const sid = sessionId.trim()
  if (!sid || !Number.isInteger(messageId) || messageId <= 0) return
  removeLocal(sid, messageId)
  queueMutation(sid, messageId, undefined, true)
}

export function clearMessageMutationsLocal(sessionId: string): void {
  writeRaw(sessionId.trim(), [], true)
}

function pendingFor(entity: CloudStateEntity): CloudStatePendingOp[] {
  const accountId = getAccount()?.account.trim() ?? ''
  return getPendingOps().filter((op): op is CloudStatePendingOp =>
    op.type === 'cloud-state' &&
    op.kind === MESSAGE_MUTATION_KIND &&
    op.entityId === entity.entityId &&
    (op.sessionId || '') === (entity.sessionId || '') &&
    (!op.accountId || op.accountId === accountId),
  )
}

function newestPending(entity: CloudStateEntity): CloudStatePendingOp | null {
  const pending = pendingFor(entity)
  return pending.length ? pending[pending.length - 1] : null
}

function dropPending(entity: CloudStateEntity): void {
  for (const op of pendingFor(entity)) removePendingOp(op.id)
}

function messageIdentity(entity: CloudStateEntity): { sessionId: string; messageId: number } | null {
  const sessionId = entity.sessionId?.trim() ?? ''
  const messageId = Number(entity.entityId)
  if (!sessionId || !Number.isInteger(messageId) || messageId <= 0) return null
  return { sessionId, messageId }
}

function mutationFromEntity(entity: CloudStateEntity): MessageMutation | null {
  const identity = messageIdentity(entity)
  if (!identity) return null
  return normalizeMutation(entity.payload, identity.sessionId, identity.messageId)
}

function semanticallyEqual(a: MessageMutation, b: MessageMutation): boolean {
  return a.sessionId === b.sessionId &&
    a.messageId === b.messageId &&
    a.hidden === b.hidden &&
    a.contentOverride === b.contentOverride
}

function rebasePendingNormal(entity: CloudStateEntity, mutation: MessageMutation): void {
  dropPending(entity)
  queueMutation(mutation.sessionId, mutation.messageId, mutation, false, entity.version)
}

function rebasePendingDelete(entity: CloudStateEntity, sessionId: string, messageId: number): void {
  dropPending(entity)
  queueMutation(sessionId, messageId, undefined, true, entity.version)
}

function applyCloudMutation(entity: CloudStateEntity): void {
  const canonical = mutationFromEntity(entity)
  if (!canonical) return
  const pending = newestPending(entity)

  if (pending?.deleted) {
    // Local restore-to-original happened after the canonical value we just pulled.
    removeLocal(canonical.sessionId, canonical.messageId)
    rebasePendingDelete(entity, canonical.sessionId, canonical.messageId)
    notifyDataChanged()
    return
  }

  if (pending) {
    const local = normalizeMutation(pending.payload, canonical.sessionId, canonical.messageId)
    if (local) {
      if (semanticallyEqual(local, canonical)) {
        dropPending(entity)
        upsertLocal(canonical)
      } else {
        // Pull-before-push must not erase an offline/local user action. Rebase it on canonical.
        upsertLocal(local)
        rebasePendingNormal(entity, local)
      }
      return
    }
    dropPending(entity)
  }

  upsertLocal(canonical)
}

function deleteCloudMutation(entity: CloudStateEntity): void {
  const identity = messageIdentity(entity)
  if (!identity) return
  const pending = newestPending(entity)

  if (pending?.deleted) {
    // Canonical already matches the local restore intent.
    dropPending(entity)
    removeLocal(identity.sessionId, identity.messageId)
    return
  }

  if (pending) {
    const local = normalizeMutation(pending.payload, identity.sessionId, identity.messageId)
    if (local) {
      // A local edit/hide made after the remote restore wins only after rebasing on the tombstone.
      upsertLocal(local)
      rebasePendingNormal(entity, local)
      return
    }
    dropPending(entity)
  }

  removeLocal(identity.sessionId, identity.messageId)
}

let initialized = false
export function initMessageMutationCloudAdapter(): void {
  if (initialized) return
  initialized = true
  registerCloudStateAdapter(MESSAGE_MUTATION_KIND, {
    apply(entity) { applyCloudMutation(entity) },
    delete(entity) { deleteCloudMutation(entity) },
  })
  if (typeof window !== 'undefined') {
    window.addEventListener(ELUVIN_AUTH_CHANGE, () => {
      // Local keys follow the existing session-id cache isolation. Nothing is rewritten on auth change;
      // pending ops are already account-scoped by sessionStore/cloudState.
    })
  }
}
