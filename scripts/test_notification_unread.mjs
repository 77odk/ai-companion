// Notification unread V2: revision-based local read state on existing user-profile storage.
import assert from 'node:assert/strict'
import fs from 'node:fs'

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const home = fs.readFileSync(new URL('../src/components/Home.tsx', import.meta.url), 'utf8')
const settings = fs.readFileSync(new URL('../src/components/Settings.tsx', import.meta.url), 'utf8')
const page = fs.readFileSync(new URL('../src/components/NotificationsPage.tsx', import.meta.url), 'utf8')
const storage = fs.readFileSync(new URL('../src/lib/storage.ts', import.meta.url), 'utf8')
const cloud = fs.readFileSync(new URL('../src/lib/cloudStateResources.ts', import.meta.url), 'utf8')
const feed = JSON.parse(fs.readFileSync(new URL('../public/notifications.json', import.meta.url), 'utf8'))

assert.equal(feed.schemaVersion, 1)
assert.ok(Number.isInteger(feed.revision) && feed.revision >= 1)

assert.match(storage, /notificationReadRevision\?: number/)
assert.match(storage, /getNotificationReadRevision/)
assert.match(storage, /setNotificationReadRevision/)
assert.doesNotMatch(storage, /NOTIFICATION_READ_KEY|ai_companion_notification_read/)

assert.match(cloud, /type SyncedUserProfile = Pick<UserProfile, 'nickname' \| 'bio' \| 'city'>/)
assert.doesNotMatch(cloud, /Pick<UserProfile,[^\n]*notificationReadRevision/)

assert.match(app, /notifications\.json/)
assert.match(app, /cache:\s*'no-store'/)
assert.match(app, /notificationRevision > notificationReadRevision/)
assert.match(app, /hasUnreadNotifications=\{hasUnreadNotifications\}/)
assert.match(app, /onRead=\{markNotificationsRead\}/)

assert.match(home, /home-inbox-unread-dot/)
assert.match(home, /消息与通知，有新消息/)
assert.match(settings, /entry-unread-dot/)
assert.match(settings, /unread=\{hasUnreadNotifications\}/)

assert.match(page, /onRead\?: \(revision: number\) => void/)
assert.match(page, /onRead\?\.\(payload\.revision\)/)

console.log('notification unread v2: PASS')
