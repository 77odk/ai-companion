import {
  enqueueCloudStateOp,
  getCloudStateVersion,
  registerCloudStateAdapter,
  requestCloudStateSync,
  type CloudStateEntity,
} from './cloudState.ts'
import { getAccount } from './sync.ts'
import { getPendingOps, removePendingOp, type CloudStatePendingOp } from './sessionStore.ts'
import type { StoredMessage } from './storage.ts'

export const CONVERSATION_STATE_KIND = 'conversation_state'
export const CONVERSATION_STATE_CHANGE_EVENT = 'yiwem:conversation-state-change'
export const MESSAGE_SERVER_CONFIRMED_EVENT = 'yiwem:message-server-confirmed'
const KEY_PREFIX = 'ai_companion_conversation_state_v1_'
const ROOT_BRANCH_ID = 'root'

export type ConversationBranchReason = 'edit' | 'delete' | 'regenerate' | 'rollback' | 'continue'

export interface ConversationBranch {
  id: string
  parentBranchId?: string
  /** Parent transcript is inherited only through this message. null means inherit nothing. */
  forkAfterMessageId?: number | null
  /** Root only: raw backend transcript is visible only through this immutable cutoff once branching begins. */
  rootCutoffMessageId?: number
  appendedMessageIds: number[]
  hiddenMessageIds: number[]
  contentOverrides: Record<string, string>
  reason?: ConversationBranchReason
  createdAt: number
  updatedAt: number
  sealedAt?: number
}

export interface ConversationState {
  version: 1
  sessionId: string
  activeBranchId: string
  branches: Record<string, ConversationBranch>
  updatedAt: number
}

function accountKey(): string {
  return getAccount()?.account.trim() ?? ''
}

function stateKey(sessionId: string, account = accountKey()): string {
  return `${KEY_PREFIX}${encodeURIComponent(account)}_${encodeURIComponent(sessionId)}`
}

function newId(prefix: string): string {
  try {
    return globalThis.crypto?.randomUUID?.() ?? `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`
  } catch {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`
  }
}

function validId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function uniqueIds(values: unknown): number[] {
  if (!Array.isArray(values)) return []
  return [...new Set(values.filter(validId))]
}

function normalizeBranch(value: unknown, id: string): ConversationBranch | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Partial<ConversationBranch>
  const createdAt = Number(raw.createdAt)
  const updatedAt = Number(raw.updatedAt)
  if (!Number.isFinite(createdAt) || createdAt <= 0 || !Number.isFinite(updatedAt) || updatedAt <= 0) return null
  const parentBranchId = typeof raw.parentBranchId === 'string' && raw.parentBranchId ? raw.parentBranchId : undefined
  const forkAfterMessageId = raw.forkAfterMessageId === null
    ? null
    : validId(raw.forkAfterMessageId)
      ? raw.forkAfterMessageId
      : undefined
  const rootCutoffMessageId = validId(raw.rootCutoffMessageId) ? raw.rootCutoffMessageId : undefined
  const overrides: Record<string, string> = {}
  if (raw.contentOverrides && typeof raw.contentOverrides === 'object' && !Array.isArray(raw.contentOverrides)) {
    for (const [key, text] of Object.entries(raw.contentOverrides)) {
      const messageId = Number(key)
      if (!validId(messageId) || typeof text !== 'string' || !text.trim()) continue
      overrides[String(messageId)] = text.trim()
    }
  }
  const reason = ['edit', 'delete', 'regenerate', 'rollback', 'continue'].includes(String(raw.reason))
    ? raw.reason as ConversationBranchReason
    : undefined
  return {
    id,
    ...(parentBranchId ? { parentBranchId } : {}),
    ...(forkAfterMessageId !== undefined ? { forkAfterMessageId } : {}),
    ...(rootCutoffMessageId ? { rootCutoffMessageId } : {}),
    appendedMessageIds: uniqueIds(raw.appendedMessageIds),
    hiddenMessageIds: uniqueIds(raw.hiddenMessageIds),
    contentOverrides: overrides,
    ...(reason ? { reason } : {}),
    createdAt,
    updatedAt,
    ...(Number.isFinite(raw.sealedAt) && Number(raw.sealedAt) > 0 ? { sealedAt: Number(raw.sealedAt) } : {}),
  }
}

export function normalizeConversationState(value: unknown, expectedSessionId?: string): ConversationState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Partial<ConversationState>
  if (raw.version !== 1) return null
  const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId.trim() : ''
  if (!sessionId || (expectedSessionId && sessionId !== expectedSessionId)) return null
  const activeBranchId = typeof raw.activeBranchId === 'string' && raw.activeBranchId ? raw.activeBranchId : ''
  if (!activeBranchId || !raw.branches || typeof raw.branches !== 'object' || Array.isArray(raw.branches)) return null
  const branches: Record<string, ConversationBranch> = {}
  for (const [id, branch] of Object.entries(raw.branches)) {
    const normalized = normalizeBranch(branch, id)
    if (normalized) branches[id] = normalized
  }
  if (!branches[ROOT_BRANCH_ID] || !branches[activeBranchId]) return null
  const updatedAt = Number(raw.updatedAt)
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return null
  return { version: 1, sessionId, activeBranchId, branches, updatedAt }
}

export function createConversationState(sessionId: string, now = Date.now()): ConversationState {
  const sid = sessionId.trim()
  if (!sid) throw new Error('conversation_state_session_required')
  return {
    version: 1,
    sessionId: sid,
    activeBranchId: ROOT_BRANCH_ID,
    branches: {
      [ROOT_BRANCH_ID]: {
        id: ROOT_BRANCH_ID,
        appendedMessageIds: [],
        hiddenMessageIds: [],
        contentOverrides: {},
        createdAt: now,
        updatedAt: now,
      },
    },
    updatedAt: now,
  }
}

export function loadConversationState(sessionId: string): ConversationState | null {
  const sid = sessionId.trim()
  const account = accountKey()
  if (!sid || !account) return null
  try {
    return normalizeConversationState(JSON.parse(localStorage.getItem(stateKey(sid, account)) ?? 'null'), sid)
  } catch {
    return null
  }
}

function writeLocal(state: ConversationState): void {
  const account = accountKey()
  if (!account) return
  localStorage.setItem(stateKey(state.sessionId, account), JSON.stringify(state))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CONVERSATION_STATE_CHANGE_EVENT, {
      detail: { sessionId: state.sessionId },
    }))
  }
}

function rawById(messages: StoredMessage[]): Map<number, StoredMessage> {
  const out = new Map<number, StoredMessage>()
  for (const message of messages ?? []) {
    if (validId(message?.id)) out.set(message.id, message)
  }
  return out
}

function rawThrough(messages: StoredMessage[], cutoff?: number): StoredMessage[] {
  if (!cutoff) return [...messages]
  const index = messages.findIndex(message => message.id === cutoff)
  return index < 0 ? [] : messages.slice(0, index + 1)
}

function truncateAfter(messages: StoredMessage[], messageId?: number | null): StoredMessage[] {
  if (messageId === null) return []
  if (messageId === undefined) return [...messages]
  const index = messages.findIndex(message => message.id === messageId)
  return index < 0 ? [] : messages.slice(0, index + 1)
}

function resolveBranch(
  state: ConversationState,
  branchId: string,
  rawMessages: StoredMessage[],
  visiting = new Set<string>(),
): StoredMessage[] {
  if (visiting.has(branchId)) return []
  const branch = state.branches[branchId]
  if (!branch) return []
  visiting.add(branchId)

  let inherited: StoredMessage[]
  if (!branch.parentBranchId) {
    inherited = rawThrough(rawMessages, branch.rootCutoffMessageId)
  } else {
    inherited = truncateAfter(resolveBranch(state, branch.parentBranchId, rawMessages, visiting), branch.forkAfterMessageId)
  }

  const hidden = new Set(branch.hiddenMessageIds)
  const overrides = branch.contentOverrides
  const out = inherited
    .filter(message => !validId(message.id) || !hidden.has(message.id))
    .map(message => {
      const override = validId(message.id) ? overrides[String(message.id)] : undefined
      return override ? { ...message, content: override } : message
    })

  const byId = rawById(rawMessages)
  for (const messageId of branch.appendedMessageIds) {
    const message = byId.get(messageId)
    if (!message || hidden.has(messageId)) continue
    const override = overrides[String(messageId)]
    out.push(override ? { ...message, content: override } : message)
  }

  // 当前设备刚发出的 optimistic / streaming 消息尚未拿到 server id；
  // conversationBranchId 是本地 membership，保证分支里立即可见。server id 回来后会固化到 appendedMessageIds。
  for (const message of rawMessages) {
    if (message.conversationBranchId !== branch.id) continue
    if (validId(message.id) && hidden.has(message.id)) continue
    const override = validId(message.id) ? overrides[String(message.id)] : undefined
    out.push(override ? { ...message, content: override } : message)
  }

  visiting.delete(branchId)
  const seen = new Set<number>()
  return out.filter(message => {
    if (!validId(message.id)) return true
    if (seen.has(message.id)) return false
    seen.add(message.id)
    return true
  })
}

export function resolveConversationMessages(
  state: ConversationState | null,
  rawMessages: StoredMessage[],
): StoredMessage[] {
  if (!state) return [...(rawMessages ?? [])]
  return resolveBranch(state, state.activeBranchId, rawMessages ?? [])
}

function lastStableMessageId(messages: StoredMessage[]): number | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (validId(messages[index]?.id)) return messages[index].id
  }
  return undefined
}

function cloneState(state: ConversationState): ConversationState {
  return {
    ...state,
    branches: Object.fromEntries(Object.entries(state.branches).map(([id, branch]) => [
      id,
      {
        ...branch,
        appendedMessageIds: [...branch.appendedMessageIds],
        hiddenMessageIds: [...branch.hiddenMessageIds],
        contentOverrides: { ...branch.contentOverrides },
      },
    ])),
  }
}

export function forkConversation(
  current: ConversationState | null,
  sessionId: string,
  rawMessages: StoredMessage[],
  options: {
    forkAfterMessageId?: number | null
    hideMessageIds?: number[]
    contentOverrides?: Record<number, string>
    reason: ConversationBranchReason
    now?: number
  },
): ConversationState {
  const now = options.now ?? Date.now()
  const state = cloneState(current ?? createConversationState(sessionId, now))
  if (state.sessionId !== sessionId) throw new Error('conversation_state_session_mismatch')

  const activeMessages = resolveConversationMessages(state, rawMessages)
  const parent = state.branches[state.activeBranchId]
  if (!parent) throw new Error('conversation_state_active_branch_missing')

  if (parent.id === ROOT_BRANCH_ID && parent.rootCutoffMessageId == null) {
    parent.rootCutoffMessageId = lastStableMessageId(activeMessages)
  }
  parent.sealedAt = parent.sealedAt ?? now
  parent.updatedAt = now

  const branchId = newId('branch')
  const overrides: Record<string, string> = {}
  for (const [idText, text] of Object.entries(options.contentOverrides ?? {})) {
    const id = Number(idText)
    if (validId(id) && typeof text === 'string' && text.trim()) overrides[String(id)] = text.trim()
  }
  state.branches[branchId] = {
    id: branchId,
    parentBranchId: parent.id,
    ...(options.forkAfterMessageId !== undefined ? { forkAfterMessageId: options.forkAfterMessageId } : {
      forkAfterMessageId: lastStableMessageId(activeMessages) ?? null,
    }),
    appendedMessageIds: [],
    hiddenMessageIds: uniqueIds(options.hideMessageIds ?? []),
    contentOverrides: overrides,
    reason: options.reason,
    createdAt: now,
    updatedAt: now,
  }
  state.activeBranchId = branchId
  state.updatedAt = now
  return state
}

/** Root 原始会话不需要 membership；真正 fork 后的新消息才写 branchId。 */
export function branchIdForNewMessage(state: ConversationState | null): string | undefined {
  if (!state) return undefined
  return state.activeBranchId === ROOT_BRANCH_ID ? undefined : state.activeBranchId
}

export function appendConfirmedMessageToBranch(
  sessionId: string,
  branchId: string,
  messageId: number,
  now = Date.now(),
): boolean {
  if (!sessionId.trim() || !branchId || !validId(messageId)) return false
  const state = loadConversationState(sessionId)
  if (!state) return false
  const branch = state.branches[branchId]
  if (!branch) return false
  if (!branch.appendedMessageIds.includes(messageId)) {
    branch.appendedMessageIds.push(messageId)
    branch.updatedAt = Math.max(branch.updatedAt, now)
    state.updatedAt = Math.max(state.updatedAt, now)
    saveConversationState(state)
  }
  return true
}

export function appendMessageToActiveBranch(
  current: ConversationState | null,
  sessionId: string,
  rawMessages: StoredMessage[],
  messageId: number,
  now = Date.now(),
): ConversationState | null {
  if (!validId(messageId)) return current
  if (!current) return null // root/unbranched transcript already includes backend messages directly.
  const state = cloneState(current)
  if (state.sessionId !== sessionId) return current
  const active = state.branches[state.activeBranchId]
  if (!active) return current

  if (active.id === ROOT_BRANCH_ID && active.rootCutoffMessageId == null) return current
  if (active.sealedAt) {
    const next = forkConversation(state, sessionId, rawMessages, { reason: 'continue', now })
    return appendMessageToActiveBranch(next, sessionId, rawMessages, messageId, now)
  }
  if (!active.appendedMessageIds.includes(messageId)) active.appendedMessageIds.push(messageId)
  active.updatedAt = now
  state.updatedAt = now
  return state
}

function mergeBranch(a: ConversationBranch, b: ConversationBranch): ConversationBranch {
  const newer = a.updatedAt >= b.updatedAt ? a : b
  const older = newer === a ? b : a
  const contentOverrides = { ...older.contentOverrides, ...newer.contentOverrides }
  return {
    ...older,
    ...newer,
    rootCutoffMessageId: Math.max(a.rootCutoffMessageId ?? 0, b.rootCutoffMessageId ?? 0) || undefined,
    appendedMessageIds: [...new Set([...a.appendedMessageIds, ...b.appendedMessageIds])],
    hiddenMessageIds: [...new Set([...a.hiddenMessageIds, ...b.hiddenMessageIds])],
    contentOverrides,
    sealedAt: Math.max(a.sealedAt ?? 0, b.sealedAt ?? 0) || undefined,
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
  }
}

export function mergeConversationStates(a: ConversationState, b: ConversationState): ConversationState {
  if (a.sessionId !== b.sessionId) throw new Error('conversation_state_session_mismatch')
  const branches: Record<string, ConversationBranch> = {}
  for (const id of new Set([...Object.keys(a.branches), ...Object.keys(b.branches)])) {
    const left = a.branches[id]
    const right = b.branches[id]
    branches[id] = left && right ? mergeBranch(left, right) : cloneState({
      version: 1,
      sessionId: a.sessionId,
      activeBranchId: id,
      branches: { [id]: (left ?? right)! },
      updatedAt: (left ?? right)!.updatedAt,
    }).branches[id]
  }
  const activeSource = a.updatedAt >= b.updatedAt ? a : b
  const fallback = branches[activeSource.activeBranchId] ? activeSource.activeBranchId : ROOT_BRANCH_ID
  return {
    version: 1,
    sessionId: a.sessionId,
    activeBranchId: fallback,
    branches,
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
  }
}

function pendingStateOps(sessionId: string): CloudStatePendingOp[] {
  const account = accountKey()
  return getPendingOps().filter((op): op is CloudStatePendingOp =>
    op.type === 'cloud-state' &&
    op.kind === CONVERSATION_STATE_KIND &&
    op.entityId === sessionId &&
    (op.sessionId || '') === sessionId &&
    (!op.accountId || op.accountId === account),
  )
}

function queueState(state: ConversationState, baseVersion = getCloudStateVersion(CONVERSATION_STATE_KIND, state.sessionId, undefined, state.sessionId)): void {
  if (!accountKey()) return
  enqueueCloudStateOp({
    opId: newId('conversation-state'),
    kind: CONVERSATION_STATE_KIND,
    entityId: state.sessionId,
    sessionId: state.sessionId,
    baseVersion,
    payload: state,
  })
  requestCloudStateSync()
}

export function saveConversationState(state: ConversationState): void {
  const normalized = normalizeConversationState(state, state.sessionId)
  if (!normalized || !accountKey()) return
  writeLocal(normalized)
  queueState(normalized)
}

function stateFromEntity(entity: CloudStateEntity): ConversationState | null {
  const sessionId = entity.sessionId || entity.entityId
  if (!sessionId || entity.entityId !== sessionId) return null
  return normalizeConversationState(entity.payload, sessionId)
}

function dropPending(sessionId: string): void {
  for (const op of pendingStateOps(sessionId)) removePendingOp(op.id)
}

function applyCloudState(entity: CloudStateEntity): void {
  const canonical = stateFromEntity(entity)
  if (!canonical) return
  const local = loadConversationState(canonical.sessionId)
  const pending = pendingStateOps(canonical.sessionId)
  if (pending.length) {
    let merged = canonical
    for (const op of pending) {
      const localPending = normalizeConversationState(op.payload, canonical.sessionId)
      if (localPending) merged = mergeConversationStates(merged, localPending)
    }
    if (local) merged = mergeConversationStates(merged, local)
    dropPending(canonical.sessionId)
    writeLocal(merged)
    if (JSON.stringify(merged) !== JSON.stringify(canonical)) queueState(merged, entity.version)
    return
  }
  // No local pending intent: Cloud State is canonical. Never resurrect a stale local-only branch.
  writeLocal(canonical)
}

function deleteCloudState(entity: CloudStateEntity): void {
  const sessionId = entity.sessionId || entity.entityId
  if (!sessionId || entity.entityId !== sessionId) return
  const pending = pendingStateOps(sessionId)
  if (pending.length) {
    // A local branch action made after the remote tombstone remains the user's latest intent.
    const local = loadConversationState(sessionId)
    if (local) {
      dropPending(sessionId)
      queueState(local, entity.version)
      return
    }
  }
  const account = accountKey()
  if (account) localStorage.removeItem(stateKey(sessionId, account))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CONVERSATION_STATE_CHANGE_EVENT, {
      detail: { sessionId },
    }))
  }
}

let initialized = false
export function initConversationStateCloudAdapter(): void {
  if (initialized) return
  initialized = true
  registerCloudStateAdapter(CONVERSATION_STATE_KIND, {
    apply(entity) { applyCloudState(entity) },
    delete(entity) { deleteCloudState(entity) },
  })
  if (typeof window !== 'undefined') {
    window.addEventListener(MESSAGE_SERVER_CONFIRMED_EVENT, (event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; branchId?: string; messageId?: number }>).detail
      if (!detail?.sessionId || !detail.branchId || !validId(detail.messageId)) return
      appendConfirmedMessageToBranch(detail.sessionId, detail.branchId, detail.messageId)
    })
  }
}
