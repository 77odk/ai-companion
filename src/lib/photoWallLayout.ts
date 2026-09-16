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

export const PHOTO_WALL_TOP = 18
/** 一行 = 该月「有照片的一天」；行距按卡片高度给，不再按日历天数换算成上百上千 px。 */
export const PHOTO_WALL_ROW_STEP = 172
export const PHOTO_WALL_CARD_SAFE_HEIGHT = 230
const PHOTO_WALL_MIN_BOARD_HEIGHT = 390

function localDayKeyFromTs(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/**
 * 每个月内，把「有照片的那几天」从新到旧编号：最新的一天 = 行 0。
 * 同一天的照片共享同一行（靠 hash 抖动 + 左右槽位散开），这样：
 * - 月份标题下面马上就是照片，不会再空出整月那么长的空白；
 * - 同月照片紧凑；已有照片只在「多出新的拍照日」时才整体下移一行。
 */
export function assignDayRows(photos: PhotoMeta[]): Map<string, number> {
  const daysByMonth = new Map<string, Map<string, number>>()
  for (const photo of photos ?? []) {
    const ts = finitePhotoTimestamp(photo.createdAt)
    const month = photoMonthKey(ts)
    const day = localDayKeyFromTs(ts)
    const days = daysByMonth.get(month) ?? new Map<string, number>()
    days.set(day, Math.max(days.get(day) ?? 0, ts))
    daysByMonth.set(month, days)
  }
  const rankByMonth = new Map<string, Map<string, number>>()
  for (const [month, days] of daysByMonth) {
    const ranked = new Map<string, number>()
    ;[...days.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([day], index) => ranked.set(day, index))
    rankByMonth.set(month, ranked)
  }
  const out = new Map<string, number>()
  for (const photo of photos ?? []) {
    const ts = finitePhotoTimestamp(photo.createdAt)
    const row = rankByMonth.get(photoMonthKey(ts))?.get(localDayKeyFromTs(ts))
    out.set(photo.id, typeof row === 'number' ? row : 0)
  }
  return out
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

function finitePhotoTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

export function layoutForPhoto(id: string, createdAt: number | string = 0, dayRow = 0): PhotoWallLayout {
  const hash = hashPhotoId(id || '_photo')
  const rotate = ((hash % 17) - 8) * 0.42
  const shift = (((hash >>> 5) % 17) - 8) * 0.9
  const widthRoll = (hash >>> 10) % 10
  const width: PhotoWallLayout['width'] = widthRoll < 2 ? 'wide' : widthRoll < 5 ? 'narrow' : 'normal'
  const pinRoll = (hash >>> 14) % 6
  const pin: PhotoWallLayout['pin'] = pinRoll === 0 ? 'pin' : pinRoll <= 2 ? 'tape' : 'none'
  const zIndex = 2 + ((hash >>> 26) % 7)
  // 行号来自「该月有照片的那几天」（assignDayRows），不再按日历天数换算：
  // 旧模型 AgeWithinMonth * 72 会让 9/16 的照片被排到 1000px 往下，月份标题下面整屏空白。
  const slotX = width === 'wide' ? 8 + ((hash >>> 18) % 13) : (hash >>> 18) % 2 === 0 ? 4 : 52
  const sameDayOffset = ((hash >>> 22) % 17) - 8
  const row = Number.isFinite(dayRow) ? Math.max(0, Math.floor(dayRow)) : 0
  // 同一天里再用「拍照时刻」做一次轻抖动：同一天的几张照片不会完全叠死，且依旧可重复。
  const timeJitter = ((finitePhotoTimestamp(createdAt) % 86_400_000) / 86_400_000) * 28 - 14
  const rawSlotY = PHOTO_WALL_TOP + row * PHOTO_WALL_ROW_STEP + sameDayOffset + timeJitter
  const slotY = Number.isFinite(rawSlotY) ? rawSlotY : PHOTO_WALL_TOP
  return { rotate, shift, width, pin, slotX, slotY, zIndex }
}

export function boardHeightForPhotos(photos: PhotoMeta[]): number {
  const rows = assignDayRows(photos)
  const maxSlotY = (photos ?? []).reduce((max, photo) => {
    const slotY = layoutForPhoto(photo.id, photo.createdAt, rows.get(photo.id) ?? 0).slotY
    return Number.isFinite(slotY) ? Math.max(max, slotY) : max
  }, 0)
  const rawHeight = maxSlotY + PHOTO_WALL_CARD_SAFE_HEIGHT + 1
  return Math.max(PHOTO_WALL_MIN_BOARD_HEIGHT, Number.isFinite(rawHeight) ? Math.ceil(rawHeight) : PHOTO_WALL_MIN_BOARD_HEIGHT)
}

export function photoMonthKey(ts: number | string): string {
  const d = new Date(finitePhotoTimestamp(ts))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function photoMonthLabel(ts: number | string): string {
  const d = new Date(finitePhotoTimestamp(ts))
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
