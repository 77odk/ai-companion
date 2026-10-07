import { ELUVIN_AUTH_CHANGE } from './dataChange.ts'
import { ACTIVE_SESSION_CHANGED_EVENT } from './sessionStore.ts'

export interface ListenTogetherSnapshot {
  title: string
  hasTrack: boolean
  playing: boolean
  current: number
  duration: number
}

type Listener = (snapshot: ListenTogetherSnapshot) => void

interface SessionPlayerState {
  player: HTMLAudioElement | null
  objectUrl: string
  title: string
  listeners: Set<Listener>
}

const states = new Map<string, SessionPlayerState>()

function sessionKey(sessionId?: string): string {
  return String(sessionId ?? '').trim()
}

function emptySnapshot(): ListenTogetherSnapshot {
  return { title: '', hasTrack: false, playing: false, current: 0, duration: 0 }
}

function ensureState(sessionId?: string): SessionPlayerState | null {
  const sid = sessionKey(sessionId)
  if (!sid) return null
  let state = states.get(sid)
  if (!state) {
    state = { player: null, objectUrl: '', title: '', listeners: new Set() }
    states.set(sid, state)
  }
  return state
}

function ensurePlayer(sessionId?: string): HTMLAudioElement | null {
  const sid = sessionKey(sessionId)
  const state = ensureState(sid)
  if (!sid || !state || typeof window === 'undefined' || typeof Audio === 'undefined') return null
  if (state.player) return state.player

  const audio = new Audio()
  audio.preload = 'metadata'
  for (const event of ['play', 'pause', 'timeupdate', 'loadedmetadata', 'durationchange', 'ended']) {
    audio.addEventListener(event, () => emit(sid))
  }
  state.player = audio
  return audio
}

function snapshot(sessionId?: string): ListenTogetherSnapshot {
  const sid = sessionKey(sessionId)
  const state = sid ? states.get(sid) : null
  if (!state) return emptySnapshot()
  const audio = state.player
  return {
    title: state.title,
    hasTrack: Boolean(state.objectUrl),
    playing: Boolean(audio && state.objectUrl && !audio.paused && !audio.ended),
    current: audio?.currentTime ?? 0,
    duration: audio && Number.isFinite(audio.duration) ? audio.duration : 0,
  }
}

function emit(sessionId?: string): void {
  const sid = sessionKey(sessionId)
  const state = sid ? states.get(sid) : null
  if (!state) return
  const next = snapshot(sid)
  state.listeners.forEach((listener) => listener(next))
}

export function getListenTogetherSnapshot(sessionId?: string): ListenTogetherSnapshot {
  return snapshot(sessionId)
}

export function subscribeListenTogether(sessionId: string, listener: Listener): () => void {
  const state = ensureState(sessionId)
  if (!state) {
    listener(emptySnapshot())
    return () => {}
  }
  state.listeners.add(listener)
  listener(snapshot(sessionId))
  return () => state.listeners.delete(listener)
}

export function chooseListenTogetherTrack(sessionId: string, file: File): void {
  const sid = sessionKey(sessionId)
  const state = ensureState(sid)
  const audio = ensurePlayer(sid)
  if (!sid || !state || !audio) return

  audio.pause()
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl)
  state.objectUrl = URL.createObjectURL(file)
  state.title = file.name.replace(/\.[^.]+$/, '') || file.name
  audio.src = state.objectUrl
  audio.currentTime = 0
  audio.load()
  emit(sid)
}

export async function toggleListenTogether(sessionId: string): Promise<void> {
  const sid = sessionKey(sessionId)
  const state = sid ? states.get(sid) : null
  const audio = ensurePlayer(sid)
  if (!sid || !state || !audio || !state.objectUrl) return

  if (audio.paused) {
    // Only the active role's local player may be audible. Other roles retain
    // their own position/title but are paused and never surface in this role.
    for (const [otherSid, other] of states) {
      if (otherSid === sid || !other.player || other.player.paused) continue
      other.player.pause()
      emit(otherSid)
    }
    await audio.play()
  } else {
    audio.pause()
  }
}

export function seekListenTogether(sessionId: string, seconds: number): void {
  const sid = sessionKey(sessionId)
  const state = sid ? states.get(sid) : null
  const audio = ensurePlayer(sid)
  if (!sid || !state || !audio || !state.objectUrl || !Number.isFinite(seconds)) return
  const end = Number.isFinite(audio.duration) ? audio.duration : seconds
  audio.currentTime = Math.max(0, Math.min(end, seconds))
  emit(sid)
}

function clearSession(state: SessionPlayerState): void {
  if (state.player) {
    state.player.pause()
    state.player.removeAttribute('src')
    state.player.load()
  }
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl)
  state.objectUrl = ''
  state.title = ''
}

export function clearListenTogether(sessionId?: string): void {
  const sid = sessionKey(sessionId)
  if (sid) {
    const state = states.get(sid)
    if (!state) return
    clearSession(state)
    emit(sid)
    return
  }
  for (const [key, state] of states) {
    clearSession(state)
    emit(key)
  }
}

export function pauseListenTogether(sessionId: string): void {
  const sid = sessionKey(sessionId)
  const state = sid ? states.get(sid) : null
  if (!state?.player || state.player.paused) return
  state.player.pause()
  emit(sid)
}


if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  // Audio/ObjectURLs are transient browser-session data. Auth transitions clear
  // every role. Leaving a role pauses its player immediately while retaining
  // that role's local track and position for a later return.
  window.addEventListener(ELUVIN_AUTH_CHANGE, () => clearListenTogether())
  window.addEventListener(ACTIVE_SESSION_CHANGED_EVENT, (event) => {
    const previousSessionId = (event as CustomEvent<{ previousSessionId?: string }>).detail?.previousSessionId ?? ''
    if (previousSessionId) pauseListenTogether(previousSessionId)
  })
}
