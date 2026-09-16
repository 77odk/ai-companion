import type { PhotoMeta } from './photoWall'

export interface PhotoWallLayout {
  rotate: number
  shift: number
  width: 'narrow' | 'normal' | 'wide'
  pin: 'tape' | 'pin' | 'none'
  slotX: number
  slotY: number
  zIndex: number
}

export const PHOTO_WALL_CARD_SAFE_HEIGHT = 320
const PHOTO_WALL_MIN_BOARD_HEIGHT = 390

/** Stable FNV-1a style hash: same photo id => same wall position/rotation forever. */
export function hashPhotoId(id: string): number {
  let hash = 2166136261
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function layoutForPhoto(id: string, createdAt = 0): PhotoWallLayout {
  const hash = hashPhotoId(id || '_photo')
  const rotate = ((hash % 17) - 8) * 0.42
  const shift = (((hash >>> 5) % 17) - 8) * 0.9
  const widthRoll = (hash >>> 10) % 10
  const width: PhotoWallLayout['width'] = widthRoll < 2 ? 'wide' : widthRoll < 5 ? 'narrow' : 'normal'
  const pinRoll = (hash >>> 14) % 6
  const pin: PhotoWallLayout['pin'] = pinRoll === 0 ? 'pin' : pinRoll <= 2 ? 'tape' : 'none'
  const zIndex = 2 + ((hash >>> 26) % 7)
  // Calendar-relative coordinates keep an existing photo fixed when siblings change.
  const date = new Date(createdAt)
  const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime()
  const ageWithinMonth = Math.max(0, (nextMonth - createdAt) / 86_400_000)
  const slotX = width === 'wide' ? 8 + ((hash >>> 18) % 13) : (hash >>> 18) % 2 === 0 ? 4 : 52
  const sameDayOffset = ((hash >>> 22) % 17) - 8
  const slotY = 18 + ageWithinMonth * 72 + sameDayOffset
  return { rotate, shift, width, pin, slotX, slotY, zIndex }
}

export function boardHeightForPhotos(photos: PhotoMeta[]): number {
  const maxSlotY = photos.reduce(
    (max, photo) => Math.max(max, layoutForPhoto(photo.id, photo.createdAt).slotY),
    0,
  )
  return Math.max(PHOTO_WALL_MIN_BOARD_HEIGHT, Math.ceil(maxSlotY + PHOTO_WALL_CARD_SAFE_HEIGHT + 1))
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
