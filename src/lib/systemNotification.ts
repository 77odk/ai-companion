import { isSystemNotificationEnabled } from './storage.ts'

export type SystemNotificationRequestResult =
  | 'granted'
  | 'denied'
  | 'unsupported'
  | 'needs-home-screen'

export interface SystemNotificationTarget {
  view: 'chat' | 'notifications'
  sessionId?: string
  commitmentId?: string
}

export const SYSTEM_NOTIFICATION_CLICK_EVENT = 'eluvin-system-notification-click'
export const SYSTEM_NOTIFICATION_SW_MESSAGE = 'ELUVIN_NOTIFICATION_CLICK'

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

function targetUrl(target?: SystemNotificationTarget): string | undefined {
  if (!target || typeof window === 'undefined') return undefined
  try {
    const url = new URL(window.location.href)
    url.searchParams.set('eluvin_notify', target.view)
    if (target.sessionId) url.searchParams.set('eluvin_sid', target.sessionId)
    else url.searchParams.delete('eluvin_sid')
    if (target.commitmentId) url.searchParams.set('eluvin_commitment', target.commitmentId)
    else url.searchParams.delete('eluvin_commitment')
    url.hash = ''
    return url.toString()
  } catch {
    return undefined
  }
}

function notificationData(target?: SystemNotificationTarget): Record<string, string> {
  const data: Record<string, string> = {
    type: SYSTEM_NOTIFICATION_SW_MESSAGE,
    ...(target?.view ? { view: target.view } : {}),
    ...(target?.sessionId ? { sessionId: target.sessionId } : {}),
    ...(target?.commitmentId ? { commitmentId: target.commitmentId } : {}),
  }
  const url = targetUrl(target)
  if (url) data.url = url
  return data
}

export function readSystemNotificationLaunchTarget(): SystemNotificationTarget | null {
  if (typeof window === 'undefined') return null
  try {
    const params = new URL(window.location.href).searchParams
    const view = params.get('eluvin_notify')
    if (view !== 'chat' && view !== 'notifications') return null
    const sessionId = params.get('eluvin_sid')?.trim() || undefined
    const commitmentId = params.get('eluvin_commitment')?.trim() || undefined
    return {
      view,
      ...(sessionId ? { sessionId } : {}),
      ...(commitmentId ? { commitmentId } : {}),
    }
  } catch {
    return null
  }
}

export function clearSystemNotificationLaunchTarget(): void {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    url.searchParams.delete('eluvin_notify')
    url.searchParams.delete('eluvin_sid')
    url.searchParams.delete('eluvin_commitment')
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
  } catch {
    // A malformed location must never block notification navigation.
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
  const data = notificationData(target)

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration()
      if (registration) {
        await registration.showNotification(cleanTitle, {
          body: cleanBody,
          tag: cleanTag,
          data,
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
      data,
    })
    notification.onclick = () => {
      try { window.focus() } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent<SystemNotificationTarget>(SYSTEM_NOTIFICATION_CLICK_EVENT, {
        detail: target ?? { view: 'notifications' },
      }))
      notification.close()
    }
    window.setTimeout(() => notification.close(), 10_000)
    return true
  } catch {
    return false
  }
}
