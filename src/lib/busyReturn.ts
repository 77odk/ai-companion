import type { BusyState } from './aiBusy.ts'

export const MAX_RETURN_RETRIES = 2
export const MAX_RETURN_ATTEMPTS = MAX_RETURN_RETRIES + 1
export const RETURN_RETRY_DELAYS_MS = [10_000, 30_000] as const
export const MAX_BUSY_RETURN_AGE = 6 * 60 * 60 * 1000

export type BusyReturnOutcome = 'success' | 'retrying' | 'exhausted' | 'expired' | 'cancelled' | 'ignored'
export type BusyReturnCommitResult = 'committed' | 'failed' | 'cancelled-before-commit'

export interface BusyReturnDeps<T> {
  now: () => number
  getState: (sessionId: string) => BusyState
  saveState: (sessionId: string, state: BusyState) => boolean
  generate: (sessionId: string, state: BusyState) => Promise<T | null>
  commit: (sessionId: string, value: T, state: BusyState) => Promise<BusyReturnCommitResult>
  isCurrent: (sessionId: string, cycleId: string) => boolean
  schedule: (callback: () => void, delayMs: number) => unknown
  onIdle?: (sessionId: string) => void
  onFailure?: (sessionId: string, error: unknown) => void
}

const inFlight = new Set<string>()
const cancelledCycles = new Set<string>()

export function busyCycleId(sessionId: string, state: BusyState): string {
  return `${sessionId}:${state.busyStartedAt ?? state.busyUntil}`
}

export function normalizeBusyState(state: BusyState, now: number): BusyState {
  const busyUntil = Number.isFinite(state.busyUntil) ? state.busyUntil : 0
  const inferredStart = busyUntil > 0 ? Math.min(now, busyUntil - 3.5 * 60 * 1000) : 0
  return {
    status: state.status === 'busy' ? 'busy' : 'idle',
    busyUntil,
    busyReason: typeof state.busyReason === 'string' ? state.busyReason : '',
    busyContext: typeof state.busyContext === 'string' ? state.busyContext : '',
    returnSent: state.returnSent === true,
    busyStartedAt: Number.isFinite(state.busyStartedAt) && (state.busyStartedAt ?? 0) > 0 ? state.busyStartedAt : inferredStart,
    retryCount: Number.isInteger(state.retryCount) && (state.retryCount ?? 0) >= 0 ? state.retryCount : 0,
    lastAttemptAt: Number.isFinite(state.lastAttemptAt) && (state.lastAttemptAt ?? 0) > 0 ? state.lastAttemptAt : 0,
  }
}

export function cancelBusyReturn(sessionId: string, state: BusyState, deps: Pick<BusyReturnDeps<unknown>, 'saveState' | 'onIdle'>): void {
  const normalized = normalizeBusyState(state, Date.now())
  cancelledCycles.add(busyCycleId(sessionId, normalized))
  deps.saveState(sessionId, { ...normalized, status: 'idle', returnSent: false })
  deps.onIdle?.(sessionId)
}

export async function triggerBusyReturn<T>(sessionId: string, deps: BusyReturnDeps<T>): Promise<BusyReturnOutcome> {
  const state = normalizeBusyState(deps.getState(sessionId), deps.now())
  const cycleId = busyCycleId(sessionId, state)
  if (state.status !== 'busy' || state.returnSent) return 'ignored'
  if (!state.busyStartedAt || deps.now() - state.busyStartedAt > MAX_BUSY_RETURN_AGE) {
    deps.saveState(sessionId, { ...state, status: 'idle', returnSent: false })
    deps.onIdle?.(sessionId)
    return 'expired'
  }
  if (cancelledCycles.has(cycleId) || !deps.isCurrent(sessionId, cycleId)) {
    deps.saveState(sessionId, { ...state, status: 'idle', returnSent: false })
    deps.onIdle?.(sessionId)
    return 'cancelled'
  }
  if (inFlight.has(cycleId)) return 'ignored'
  if ((state.retryCount ?? 0) > 0 && state.lastAttemptAt) {
    const delay = RETURN_RETRY_DELAYS_MS[(state.retryCount ?? 1) - 1] ?? RETURN_RETRY_DELAYS_MS[1]
    const remaining = state.lastAttemptAt + delay - deps.now()
    if (remaining > 0) {
      deps.schedule(() => { void triggerBusyReturn(sessionId, deps) }, remaining)
      return 'retrying'
    }
  }
  if ((state.retryCount ?? 0) >= MAX_RETURN_ATTEMPTS) {
    deps.saveState(sessionId, { ...state, status: 'idle', returnSent: false })
    deps.onIdle?.(sessionId)
    return 'exhausted'
  }
  inFlight.add(cycleId)
  const attemptState = { ...state, lastAttemptAt: deps.now() }
  deps.saveState(sessionId, attemptState)
  try {
    const value = await deps.generate(sessionId, attemptState)
    if (value == null) throw new Error('Busy Return returned no usable content')
    if (cancelledCycles.has(cycleId) || !deps.isCurrent(sessionId, cycleId)) return 'cancelled'
    const commitResult = await deps.commit(sessionId, value, attemptState)
    if (commitResult === 'failed') throw new Error('Busy Return message was not persisted')
    if (commitResult === 'cancelled-before-commit') {
      deps.saveState(sessionId, { ...attemptState, status: 'idle', returnSent: false })
      deps.onIdle?.(sessionId)
      return 'cancelled'
    }
    // commitResult=committed 是不可逆提交点：之后的 UI 切换/取消不能把成功降级为失败或触发 retry。
    deps.saveState(sessionId, { ...attemptState, status: 'idle', returnSent: true })
    deps.onIdle?.(sessionId)
    return 'success'
  } catch (error) {
    deps.onFailure?.(sessionId, error)
    const latest = normalizeBusyState(deps.getState(sessionId), deps.now())
    if (cancelledCycles.has(cycleId) || !deps.isCurrent(sessionId, cycleId)) return 'cancelled'
    const retryCount = Math.max(latest.retryCount ?? 0, state.retryCount ?? 0) + 1
    const failed = { ...latest, retryCount, lastAttemptAt: deps.now(), returnSent: false }
    if (retryCount >= MAX_RETURN_ATTEMPTS) {
      deps.saveState(sessionId, { ...failed, status: 'idle' })
      deps.onIdle?.(sessionId)
      return 'exhausted'
    }
    deps.saveState(sessionId, failed)
    deps.schedule(() => { void triggerBusyReturn(sessionId, deps) }, RETURN_RETRY_DELAYS_MS[retryCount - 1] ?? RETURN_RETRY_DELAYS_MS[1])
    return 'retrying'
  } finally {
    inFlight.delete(cycleId)
  }
}

export function resetBusyReturnGuardsForTests(): void {
  inFlight.clear()
  cancelledCycles.clear()
}
