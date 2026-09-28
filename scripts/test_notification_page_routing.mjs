// Notification navigation contract: one full page, source-aware return, no Home bottom sheet.
import assert from 'node:assert/strict'
import fs from 'node:fs'

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const home = fs.readFileSync(new URL('../src/components/Home.tsx', import.meta.url), 'utf8')
const settings = fs.readFileSync(new URL('../src/components/Settings.tsx', import.meta.url), 'utf8')
const life = fs.readFileSync(new URL('../src/lib/spaceChatInject.ts', import.meta.url), 'utf8')

assert.match(app, /'notifications'/)
assert.match(app, /setNotificationFrom\(from\)/)
assert.match(app, /onGoNotifications=\{\(\) => openNotifications\('home'\)\}/)
assert.match(app, /onGoNotifications=\{\(\) => openNotifications\('settings'\)\}/)
assert.match(app, /<NotificationsPage onBack=\{\(\) => navigate\(notificationFrom\)\}/)
assert.doesNotMatch(home, /inboxOpen|setInboxOpen/)
assert.match(home, /onClick=\{onGoNotifications\}/)
assert.match(settings, /onGoNotifications\?\.\(\)/)
assert.doesNotMatch(life, /你在这个城市|life in this city/i)

console.log('notification page routing: PASS')

assert.doesNotMatch(app, /<NotificationsPage onBack=\{\(\) => navigate\(notificationFrom\)\}/)
