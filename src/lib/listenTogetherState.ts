import { ELUVIN_AUTH_CHANGE } from './dataChange.ts'

export interface ListenTogetherSnapshot {
  title: string
  hasTrack: boolean
  playing: boolean
  current: number
  duration: number
}

type Listener = (snapshot: ListenTogetherSnapshot) => void

let player: HTMLAudioElement | null = null
let objectUrl = ''
let title = ''
const listeners = new Set<Listener>()

function ensurePlayer(): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null
  if (player) return player
  player = new Audio()
  player.preload = 'metadata'
  for (const event of ['play', 'pause', 'timeupdate', 'loadedmetadata', 'durationchange', 'ended']) {
    player.addEventListener(event, emit)
  }
  return player
}

function snapshot(): ListenTogetherSnapshot {
  const audio = ensurePlayer()
  return {
    title,
    hasTrack: Boolean(objectUrl),
    playing: Boolean(audio && objectUrl && !audio.paused && !audio.ended),
    current: audio?.currentTime ?? 0,
    duration: audio && Number.isFinite(audio.duration) ? audio.duration : 0,
  }
}

function emit(): void {
  const next = snapshot()
  listeners.forEach((listener) => listener(next))
}

export function getListenTogetherSnapshot(): ListenTogetherSnapshot {
  return snapshot()
}

export function subscribeListenTogether(listener: Listener): () => void {
  listeners.add(listener)
  listener(snapshot())
  return () => listeners.delete(listener)
}

export function chooseListenTogetherTrack(file: File): void {
  const audio = ensurePlayer()
  if (!audio) return
  audio.pause()
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = URL.createObjectURL(file)
  title = file.name.replace(/\.[^.]+$/, '') || file.name
  audio.src = objectUrl
  audio.currentTime = 0
  audio.load()
  emit()
}

export async function toggleListenTogether(): Promise<void> {
  const audio = ensurePlayer()
  if (!audio || !objectUrl) return
  if (audio.paused) await audio.play()
  else audio.pause()
}

export function seekListenTogether(seconds: number): void {
  const audio = ensurePlayer()
  if (!audio || !objectUrl || !Number.isFinite(seconds)) return
  const end = Number.isFinite(audio.duration) ? audio.duration : seconds
  audio.currentTime = Math.max(0, Math.min(end, seconds))
  emit()
}

export function clearListenTogether(): void {
  const audio = player
  if (audio) {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = ''
  title = ''
  emit()
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  // Audio/ObjectURL belong to the current signed-in browser session. Any auth
  // transition invalidates that transient selection without touching auth.ts.
  window.addEventListener(ELUVIN_AUTH_CHANGE, clearListenTogether)
}
