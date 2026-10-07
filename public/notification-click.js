self.addEventListener('notificationclick', (event) => {
  const notification = event.notification
  const data = notification && notification.data && typeof notification.data === 'object'
    ? notification.data
    : {}
  const sessionId = typeof data.sessionId === 'string' ? data.sessionId : ''
  const view = data.view === 'chat' ? 'chat' : ''
  const url = typeof data.url === 'string' && data.url ? data.url : './'

  notification?.close()

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const message = { type: 'eluvin-notification-click', sessionId, view }

    for (const client of windows) {
      if ('focus' in client) {
        await client.focus()
        client.postMessage(message)
        return
      }
    }

    if (self.clients.openWindow) {
      const opened = await self.clients.openWindow(url)
      opened?.postMessage?.(message)
    }
  })())
})
