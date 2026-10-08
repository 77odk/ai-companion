import { ELUVIN_AUTH_CHANGE } from './dataChange.ts'

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

interface UserPlayerState {
  player: HTMLAudioElement | null
  tracks: LocalTrack[]
  currentIndex: number
  mode: ListenPlaybackMode
  volume: number
  listeners: Set<Listener>
}

const state: UserPlayerState = {
  player: null,
  tracks: [],
  currentIndex: 0,
  mode: 'sequence',
  volume: .8,
  listeners: new Set(),
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

function currentTrack(): LocalTrack | null {
  return state.tracks[state.currentIndex] ?? null
}

function snapshot(): ListenTogetherSnapshot {
  const audio = state.player
  const track = currentTrack()
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

function emit(): void {
  const next = snapshot()
  state.listeners.forEach((listener) => listener(next))
}

function ensurePlayer(): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null
  if (state.player) return state.player

  const audio = new Audio()
  audio.preload = 'metadata'
  audio.volume = state.volume
  for (const event of ['play', 'pause', 'timeupdate', 'loadedmetadata', 'durationchange']) {
    audio.addEventListener(event, emit)
  }
  audio.addEventListener('ended', () => {
    void stepListenTogether('', 1, true)
  })
  state.player = audio
  return audio
}

function titleForFile(file: File): string {
  return file.name.replace(/\.[^.]+$/, '') || file.name
}

function nextIndex(direction: 1 | -1): number {
  const count = state.tracks.length
  if (count <= 1) return 0
  if (state.mode === 'shuffle' && direction === 1) {
    const offset = 1 + Math.floor(Math.random() * (count - 1))
    return (state.currentIndex + offset) % count
  }
  return (state.currentIndex + direction + count) % count
}

async function loadIndex(index: number, autoplay: boolean): Promise<void> {
  const audio = ensurePlayer()
  if (!audio || state.tracks.length === 0) return

  state.currentIndex = Math.max(0, Math.min(state.tracks.length - 1, index))
  const track = currentTrack()
  if (!track) return

  audio.src = track.objectUrl
  audio.currentTime = 0
  audio.volume = state.volume
  audio.load()
  emit()

  if (autoplay) {
    try {
      await audio.play()
    } catch {
      // 浏览器若要求新的用户手势，保留选中歌曲并停在可播放状态。
      emit()
    }
  }
}

/**
 * 播放器属于当前用户/浏览器会话，而不是某个 TA。
 * 保留 sessionId 参数只是为了兼容现有调用点；切换 TA 不会切断或复制播放状态。
 */
export function getListenTogetherSnapshot(_sessionId?: string): ListenTogetherSnapshot {
  return state.tracks.length || state.player ? snapshot() : emptySnapshot()
}

export function subscribeListenTogether(
  _sessionId: string,
  listener: Listener,
): () => void {
  state.listeners.add(listener)
  listener(getListenTogetherSnapshot())
  return () => state.listeners.delete(listener)
}

export function chooseListenTogetherTracks(
  _sessionId: string,
  files: FileList | File[],
): void {
  const audio = ensurePlayer()
  if (!audio) return

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
    emit()
    return
  }

  void loadIndex(0, false)
}

export function chooseListenTogetherTrack(sessionId: string, file: File): void {
  chooseListenTogetherTracks(sessionId, [file])
}

export async function toggleListenTogether(_sessionId: string): Promise<void> {
  const audio = ensurePlayer()
  if (!audio || !currentTrack()) return
  if (audio.paused) await audio.play()
  else audio.pause()
}

export async function stepListenTogether(
  _sessionId: string,
  direction: 1 | -1,
  autoplay?: boolean,
): Promise<void> {
  if (state.tracks.length === 0) return
  const shouldPlay = autoplay ?? Boolean(state.player && !state.player.paused && !state.player.ended)
  await loadIndex(nextIndex(direction), shouldPlay)
}

export function seekListenTogether(_sessionId: string, seconds: number): void {
  const audio = ensurePlayer()
  if (!audio || !currentTrack() || !Number.isFinite(seconds)) return
  const end = Number.isFinite(audio.duration) ? audio.duration : seconds
  audio.currentTime = Math.max(0, Math.min(end, seconds))
  emit()
}

export function setListenTogetherVolume(_sessionId: string, volume: number): void {
  if (!Number.isFinite(volume)) return
  state.volume = Math.max(0, Math.min(1, volume))
  const audio = ensurePlayer()
  if (audio) audio.volume = state.volume
  emit()
}

export function setListenTogetherMode(_sessionId: string, mode: ListenPlaybackMode): void {
  state.mode = mode === 'shuffle' ? 'shuffle' : 'sequence'
  emit()
}

export function clearListenTogether(): void {
  if (state.player) {
    state.player.pause()
    state.player.removeAttribute('src')
    state.player.load()
  }
  for (const track of state.tracks) URL.revokeObjectURL(track.objectUrl)
  state.tracks = []
  state.currentIndex = 0
  emit()
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  // 登录账号变化才清理；切 TA 不影响用户正在播放的音乐。
  window.addEventListener(ELUVIN_AUTH_CHANGE, clearListenTogether)
}
