import { ELUVIN_AUTH_CHANGE } from './dataChange.ts'
import { ACTIVE_SESSION_CHANGED_EVENT } from './sessionStore.ts'

export type ListenPlaybackMode = 'sequence' | 'shuffle'

export interface ListenTogetherSnapshot {
  title: string
  hasTrack: boolean
  playing: boolean
  current: number
  duration: number
  volume: number
  mode: ListenPlaybackMode
  trackCount: number
  currentIndex: number
}

type Listener = (snapshot: ListenTogetherSnapshot) => void

interface LocalTrack {
  id: string
  title: string
  objectUrl: string
}

interface SessionPlayerState {
  player: HTMLAudioElement | null
  tracks: LocalTrack[]
  currentIndex: number
  mode: ListenPlaybackMode
  volume: number
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
    volume: .8,
    mode: 'sequence',
    trackCount: 0,
    currentIndex: 0,
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
      currentIndex: 0,
      mode: 'sequence',
      volume: .8,
      listeners: new Set(),
    }
    states.set(sid, state)
  }
  return state
}

function emit(sessionId?: string): void {
  const sid = sessionKey(sessionId)
  const state = sid ? states.get(sid) : null
  if (!state) return
  const next = snapshot(sid)
  state.listeners.forEach((listener) => listener(next))
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

function currentTrack(state: SessionPlayerState): LocalTrack | null {
  return state.tracks[state.currentIndex] ?? null
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
    volume: state.volume,
    mode: state.mode,
    trackCount: state.tracks.length,
    currentIndex: state.currentIndex,
  }
}

function titleForFile(file: File): string {
  return file.name.replace(/\.[^.]+$/, '') || file.name
}

function nextIndex(state: SessionPlayerState, direction: 1 | -1): number {
  const count = state.tracks.length
  if (count <= 1) return 0
  if (state.mode === 'shuffle' && direction === 1) {
    const offset = 1 + Math.floor(Math.random() * (count - 1))
    return (state.currentIndex + offset) % count
  }
  return (state.currentIndex + direction + count) % count
}

async function loadIndex(sessionId: string, index: number, autoplay: boolean): Promise<void> {
  const sid = sessionKey(sessionId)
  const state = sid ? states.get(sid) : null
  const audio = ensurePlayer(sid)
  if (!sid || !state || !audio || state.tracks.length === 0) return

  state.currentIndex = Math.max(0, Math.min(state.tracks.length - 1, index))
  const track = currentTrack(state)
  if (!track) return
  audio.src = track.objectUrl
  audio.currentTime = 0
  audio.volume = state.volume
  audio.load()
  emit(sid)
  if (autoplay) {
    try {
      await audio.play()
    } catch {
      // 浏览器若要求新的用户手势，保留选中歌曲并停在可播放状态。
      emit(sid)
    }
  }
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

export function chooseListenTogetherTracks(sessionId: string, files: FileList | File[]): void {
  const sid = sessionKey(sessionId)
  const state = ensureState(sid)
  const audio = ensurePlayer(sid)
  if (!sid || !state || !audio) return

  audio.pause()
  for (const track of state.tracks) URL.revokeObjectURL(track.objectUrl)

  state.tracks = Array.from(files).map((file, index) => ({
    id: `${Date.now()}-${index}-${file.name}`,
    title: titleForFile(file),
    objectUrl: URL.createObjectURL(file),
  }))
  state.currentIndex = 0

  if (state.tracks.length === 0) {
    audio.removeAttribute('src')
    audio.load()
    emit(sid)
    return
  }

  void loadIndex(sid, 0, false)
}

export function chooseListenTogetherTrack(sessionId: string, file: File): void {
  chooseListenTogetherTracks(sessionId, [file])
}

export async function toggleListenTogether(sessionId: string): Promise<void> {
  const sid = sessionKey(sessionId)
  const state = sid ? states.get(sid) : null
  const audio = ensurePlayer(sid)
  if (!sid || !state || !audio || !currentTrack(state)) return

  if (audio.paused) {
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

export async function stepListenTogether(
  sessionId: string,
  direction: 1 | -1,
  autoplay?: boolean,
): Promise<void> {
  const sid = sessionKey(sessionId)
  const state = sid ? states.get(sid) : null
  if (!sid || !state || state.tracks.length === 0) return
  const shouldPlay = autoplay ?? Boolean(state.player && !state.player.paused && !state.player.ended)
  await loadIndex(sid, nextIndex(state, direction), shouldPlay)
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
  const audio = ensurePlayer(sid)
  if (audio) audio.volume = state.volume
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
  for (const track of state.tracks) URL.revokeObjectURL(track.objectUrl)
  state.tracks = []
  state.currentIndex = 0
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
  window.addEventListener(ELUVIN_AUTH_CHANGE, () => clearListenTogether())
  window.addEventListener(ACTIVE_SESSION_CHANGED_EVENT, (event) => {
    const previousSessionId = (event as CustomEvent<{ previousSessionId?: string }>).detail?.previousSessionId ?? ''
    if (previousSessionId) pauseListenTogether(previousSessionId)
  })
}
