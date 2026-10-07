/* Imported by the generated Workbox service worker.
 * Keep this file self-contained: it runs in ServiceWorkerGlobalScope, not the page.
 */
self.addEventListener('notificationclick', (event) => {
  const notification = event.notification
  const data = notification && notification.data && typeof notification.data === 'object'
    ? notification.data
    : {}
  notification?.close()

  const message = {
    type: 'ELUVIN_NOTIFICATION_CLICK',
    ...(typeof data.view === 'string' ? { view: data.view } : {}),
    ...(typeof data.sessionId === 'string' ? { sessionId: data.sessionId } : {}),
    ...(typeof data.commitmentId === 'string' ? { commitmentId: data.commitmentId } : {}),
  }

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const visible = windows.find((client) => client.visibilityState === 'visible') || windows[0]
    if (visible) {
      visible.postMessage(message)
      if ('focus' in visible) await visible.focus()
      return
    }
    if (typeof data.url === 'string' && data.url) {
      await self.clients.openWindow(data.url)
      return
    }
    await self.clients.openWindow(self.registration.scope)
  })())
})
