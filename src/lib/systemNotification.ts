import { isSystemNotificationEnabled } from './storage.ts'

export type SystemNotificationRequestResult =
  | 'granted'
  | 'denied'
  | 'unsupported'
  | 'needs-home-screen'

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true
}

export function canUseSystemNotifications(): boolean {
  return typeof Notification !== 'undefined'
}

export function systemNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!canUseSystemNotifications()) return 'unsupported'
  return Notification.permission
}

export async function requestSystemNotificationPermission(): Promise<SystemNotificationRequestResult> {
  if (!canUseSystemNotifications()) return 'unsupported'
  if (isIos() && !isStandalone()) return 'needs-home-screen'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  try {
    const permission = await Notification.requestPermission()
    return permission === 'granted' ? 'granted' : 'denied'
  } catch {
    return 'denied'
  }
}

export async function showSystemNotification(
  title: string,
  body: string,
  tag: string,
): Promise<boolean> {
  if (!isSystemNotificationEnabled()) return false
  if (!canUseSystemNotifications() || Notification.permission !== 'granted') return false

  const cleanTitle = String(title ?? '').trim() || '忆文'
  const cleanBody = String(body ?? '').trim()
  const cleanTag = String(tag ?? '').trim() || 'eluvin'

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready
      await registration.showNotification(cleanTitle, {
        body: cleanBody,
        tag: cleanTag,
      })
      return true
    }
  } catch {
    // Fallback to the page Notification API below.
  }

  try {
    const notification = new Notification(cleanTitle, {
      body: cleanBody,
      tag: cleanTag,
    })
    window.setTimeout(() => notification.close(), 10_000)
    return true
  } catch {
    return false
  }
}
