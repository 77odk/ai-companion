import type { PhotoMeta } from './photoWall'

export interface PhotoWallLayout {
  rotate: number
  shift: number
  width: 'narrow' | 'normal' | 'wide'
  pin: 'tape' | 'pin' | 'none'
}

/** Stable FNV-1a style hash: same photo id => same wall position/rotation forever. */
export function hashPhotoId(id: string): number {
  let hash = 2166136261
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function layoutForPhoto(id: string): PhotoWallLayout {
  const hash = hashPhotoId(id || '_photo')
  const rotate = ((hash % 17) - 8) * 0.42
  const shift = (((hash >>> 5) % 17) - 8) * 0.9
  const widthRoll = (hash >>> 10) % 10
  const width: PhotoWallLayout['width'] = widthRoll < 2 ? 'wide' : widthRoll < 5 ? 'narrow' : 'normal'
  const pinRoll = (hash >>> 14) % 6
  const pin: PhotoWallLayout['pin'] = pinRoll === 0 ? 'pin' : pinRoll <= 2 ? 'tape' : 'none'
  return { rotate, shift, width, pin }
}

export function photoMonthKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function photoMonthLabel(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()} · ${String(d.getMonth() + 1).padStart(2, '0')}`
}

export interface PhotoMonthGroup {
  key: string
  label: string
  photos: PhotoMeta[]
}

/** Newest month first; photos inside each month remain newest first. */
export function groupPhotosByMonth(photos: PhotoMeta[]): PhotoMonthGroup[] {
  const sorted = [...(photos ?? [])].sort((a, b) => b.createdAt - a.createdAt)
  const groups = new Map<string, PhotoMonthGroup>()
  for (const photo of sorted) {
    const key = photoMonthKey(photo.createdAt)
    const existing = groups.get(key)
    if (existing) {
      existing.photos.push(photo)
      continue
    }
    groups.set(key, {
      key,
      label: photoMonthLabel(photo.createdAt),
      photos: [photo],
    })
  }
  return [...groups.values()]
}
