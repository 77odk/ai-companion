import { ELUVIN_AUTH_CHANGE } from './dataChange.ts'
import { ACTIVE_SESSION_CHANGED_EVENT } from './sessionStore.ts'

export type ListenPlaybackMode = 'sequence' | 'shuffle'

export interface ListenTogetherSnapshot {
  title: string
  hasTrack: boolean
  playing: boolean
  current: number
  duration: number
  trackIndex: number
  trackCount: number
  volume: number
  mode: ListenPlaybackMode
}

type Listener = (snapshot: ListenTogetherSnapshot) => void

interface LocalTrack {
  url: string
  title: string
}

interface SessionPlayerState {
  player: HTMLAudioElement | null
  tracks: LocalTrack[]
  trackIndex: number
  volume: number
  mode: ListenPlaybackMode
  listeners: Set<Listener>
}

const states = new Map<string, SessionPlayerState>()

function sessionKey(sessionId?: string): string {
  return String(sessionId ?? '').trim()
}

function emptySnapshot(): ListenTogetherSnapshot {
  return {
    title: '',
    hasTrack: false,
    playing: false,
    current: 0,
    duration: 0,
    trackIndex: 0,
    trackCount: 0,
    volume: .82,
    mode: 'sequence',
  }
}

function ensureState(sessionId?: string): SessionPlayerState | null {
  const sid = sessionKey(sessionId)
  if (!sid) return null
  let state = states.get(sid)
  if (!state) {
    state = {
      player: null,
      tracks: [],
      trackIndex: 0,
      volume: .82,
      mode: 'sequence',
      listeners: new Set(),
    }
    states.set(sid, state)
  }
  return state
}

function currentTrack(state: SessionPlayerState): LocalTrack | null {
  return state.tracks[state.trackIndex] ?? null
}

function ensurePlayer(sessionId?: string): HTMLAudioElement | null {
  const sid = sessionKey(sessionId)
  const state = ensureState(sid)
  if (!sid || !state || typeof window === 'undefined' || typeof Audio === 'undefined') return null
  if (state.player) return state.player

  const audio = new Audio()
  audio.preload = 'metadata'
  audio.volume = state.volume
  for (const event of ['play', 'pause', 'timeupdate', 'loadedmetadata', 'durationchange']) {
    audio.addEventListener(event, () => emit(sid))
  }
  audio.addEventListener('ended', () => {
    void stepListenTogether(sid, 1, true)
  })
  state.player = audio
  return audio
}

function snapshot(sessionId?: string): ListenTogetherSnapshot {
  const sid = sessionKey(sessionId)
  const state = sid ? states.get(sid) : null
  if (!state) return emptySnapshot()
  const audio = state.player
  const track = currentTrack(state)
  return {
    title: track?.title ?? '',
    hasTrack: Boolean(track),
    playing: Boolean(audio && track && !audio.paused && !audio.ended),
    current: audio?.currentTime ?? 0,
    duration: audio && Number.isFinite(audio.duration) ? audio.duration : 0,
    trackIndex: state.trackIndex,
    trackCount: state.tracks.length,
    volume: state.volume,
    mode: state.mode,
  }
}

function emit(sessionId?: string): void {
  const sid = sessionKey(sessionId)
  const state = sid ? states.get(sid) : null
  if (!state) return
  const next = snapshot(sid)
  state.listeners.forEach((listener) => listener(next))
}

function pauseOtherSessions(sessionId: string): void {
  for (const [otherSid, other] of states) {
    if (otherSid === sessionId || !other.player || other.player.paused) continue
    other.player.pause()
    emit(otherSid)
  }
}

async function loadTrack(sessionId: string, index: number, autoplay: boolean): Promise<void> {
  const sid = sessionKey(sessionId)
  const state = sid ? states.get(sid) : null
  const audio = ensurePlayer(sid)
  if (!sid || !state || !audio || state.tracks.length === 0) return

  const count = state.tracks.length
  state.trackIndex = ((index % count) + count) % count
  const track = currentTrack(state)
  if (!track) return

  audio.pause()
  audio.src = track.url
  audio.currentTime = 0
  audio.volume = state.volume
  audio.load()
  emit(sid)

  if (autoplay) {
    pauseOtherSessions(sid)
    try {
      await audio.play()
    } catch {
      emit(sid)
    }
  }
}

function nextIndex(state: SessionPlayerState, direction: -1 | 1): number {
  const count = state.tracks.length
  if (count <= 1) return 0
  if (state.mode === 'shuffle') {
    let next = state.trackIndex
    while (next === state.trackIndex) next = Math.floor(Math.random() * count)
    return next
  }
  return (state.trackIndex + direction + count) % count
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

export function chooseListenTogetherTracks(sessionId: string, files: File[]): void {
  const sid = sessionKey(sessionId)
  const state = ensureState(sid)
  const audio = ensurePlayer(sid)
  const usable = (files ?? []).filter((file) => file instanceof File)
  if (!sid || !state || !audio || usable.length === 0) return

  audio.pause()
  for (const track of state.tracks) URL.revokeObjectURL(track.url)
  state.tracks = usable.map((file) => ({
    url: URL.createObjectURL(file),
    title: file.name.replace(/\.[^.]+$/, '') || file.name,
  }))
  state.trackIndex = 0
  void loadTrack(sid, 0, false)
}

/** Compatibility wrapper for the existing one-file call path/tests. */
export function chooseListenTogetherTrack(sessionId: string, file: File): void {
  chooseListenTogetherTracks(sessionId, [file])
}

export async function toggleListenTogether(sessionId: string): Promise<void> {
  const sid = sessionKey(sessionId)
  const state = sid ? states.get(sid) : null
  const audio = ensurePlayer(sid)
  if (!sid || !state || !audio || !currentTrack(state)) return

  if (audio.paused) {
    pauseOtherSessions(sid)
    await audio.play()
  } else {
    audio.pause()
  }
}

export async function stepListenTogether(
  sessionId: string,
  direction: -1 | 1,
  autoplay = false,
): Promise<void> {
  const sid = sessionKey(sessionId)
  const state = sid ? states.get(sid) : null
  if (!sid || !state || state.tracks.length === 0) return
  const shouldPlay = autoplay || Boolean(state.player && !state.player.paused && !state.player.ended)
  await loadTrack(sid, nextIndex(state, direction), shouldPlay)
}

export function seekListenTogether(sessionId: string, seconds: number): void {
  const sid = sessionKey(sessionId)
  const state = sid ? states.get(sid) : null
  const audio = ensurePlayer(sid)
  if (!sid || !state || !audio || !currentTrack(state) || !Number.isFinite(seconds)) return
  const end = Number.isFinite(audio.duration) ? audio.duration : seconds
  audio.currentTime = Math.max(0, Math.min(end, seconds))
  emit(sid)
}

export function setListenTogetherVolume(sessionId: string, volume: number): void {
  const sid = sessionKey(sessionId)
  const state = ensureState(sid)
  if (!sid || !state || !Number.isFinite(volume)) return
  state.volume = Math.max(0, Math.min(1, volume))
  if (state.player) state.player.volume = state.volume
  emit(sid)
}

export function setListenTogetherMode(sessionId: string, mode: ListenPlaybackMode): void {
  const sid = sessionKey(sessionId)
  const state = ensureState(sid)
  if (!sid || !state) return
  state.mode = mode === 'shuffle' ? 'shuffle' : 'sequence'
  emit(sid)
}

function clearSession(state: SessionPlayerState): void {
  if (state.player) {
    state.player.pause()
    state.player.removeAttribute('src')
    state.player.load()
  }
  for (const track of state.tracks) URL.revokeObjectURL(track.url)
  state.tracks = []
  state.trackIndex = 0
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
  // that role's local queue and position for a later return.
  window.addEventListener(ELUVIN_AUTH_CHANGE, () => clearListenTogether())
  window.addEventListener(ACTIVE_SESSION_CHANGED_EVENT, (event) => {
    const previousSessionId = (event as CustomEvent<{ previousSessionId?: string }>).detail?.previousSessionId ?? ''
    if (previousSessionId) pauseListenTogether(previousSessionId)
  })
}
