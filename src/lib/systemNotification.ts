import { isSystemNotificationEnabled } from './storage.ts'

export type SystemNotificationRequestResult =
  | 'granted'
  | 'denied'
  | 'unsupported'
  | 'needs-home-screen'

export interface SystemNotificationTarget {
  sessionId?: string
  view?: 'chat'
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  const classic = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const ipadDesktopUa = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return classic || ipadDesktopUa
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
  target?: SystemNotificationTarget,
): Promise<boolean> {
  if (!isSystemNotificationEnabled()) return false
  if (!canUseSystemNotifications() || Notification.permission !== 'granted') return false

  const cleanTitle = String(title ?? '').trim() || '忆文'
  const cleanBody = String(body ?? '').trim()
  const cleanTag = String(tag ?? '').trim() || 'eluvin'
  const cleanTarget: SystemNotificationTarget = {
    ...(target?.sessionId ? { sessionId: String(target.sessionId) } : {}),
    ...(target?.view === 'chat' ? { view: 'chat' as const } : {}),
  }
  const routeUrl = (() => {
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('eluvin_notification_session')
      url.searchParams.delete('eluvin_notification_view')
      if (cleanTarget.sessionId) url.searchParams.set('eluvin_notification_session', cleanTarget.sessionId)
      if (cleanTarget.view) url.searchParams.set('eluvin_notification_view', cleanTarget.view)
      url.hash = ''
      return url.href
    } catch {
      return './'
    }
  })()

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration()
      if (registration) {
        await registration.showNotification(cleanTitle, {
          body: cleanBody,
          tag: cleanTag,
          data: { ...cleanTarget, url: routeUrl },
        })
        return true
      }
    }
  } catch {
    // Fallback to the page Notification API below.
  }

  try {
    const notification = new Notification(cleanTitle, {
      body: cleanBody,
      tag: cleanTag,
      data: { ...cleanTarget, url: routeUrl },
    })
    notification.onclick = () => {
      window.focus()
      window.dispatchEvent(new CustomEvent('eluvin-system-notification-click', {
        detail: cleanTarget,
      }))
      notification.close()
    }
    window.setTimeout(() => notification.close(), 10_000)
    return true
  } catch {
    return false
  }
}
