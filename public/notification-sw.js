self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification?.data?.url
  if (!targetUrl || typeof targetUrl !== 'string') return

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const target = new URL(targetUrl, self.location.origin).href
    for (const client of windows) {
      if ('navigate' in client) {
        await client.navigate(target)
        await client.focus()
        return
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target)
  })())
})
