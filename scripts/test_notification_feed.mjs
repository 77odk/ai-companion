// Official notification feed V1（保留的静态资产）：格式校验 + 通知页纯文本安全渲染。
// V3 起通知页的事实来源是后端 GET /api/notifications，public/notifications.json 不再是数据源，只作为兜底文件保留。
import assert from 'node:assert/strict'
import fs from 'node:fs'

const page = fs.readFileSync(new URL('../src/components/NotificationsPage.tsx', import.meta.url), 'utf8')
const feed = JSON.parse(fs.readFileSync(new URL('../public/notifications.json', import.meta.url), 'utf8'))

assert.equal(feed.schemaVersion, 1)
assert.ok(Array.isArray(feed.items))
assert.ok(feed.items.length >= 1)

const ids = new Set()
for (const item of feed.items) {
  assert.equal(typeof item.id, 'string')
  assert.ok(item.id.trim())
  assert.ok(!ids.has(item.id), `duplicate notification id: ${item.id}`)
  ids.add(item.id)
  assert.ok(item.kind === 'update' || item.kind === 'announcement')
  assert.equal(typeof item.title, 'string')
  assert.ok(item.title.trim())
  assert.equal(typeof item.body, 'string')
  assert.ok(item.body.trim())
  assert.match(item.publishedAt, /^\d{4}-\d{2}-\d{2}$/)
}

assert.doesNotMatch(page, /notifications\.json/)
assert.match(page, /Array\.isArray\(payload\.items\)/)
assert.doesNotMatch(page, /dangerouslySetInnerHTML/)
assert.match(page, /TA 想对你说的话仍然只在聊天里/)
assert.doesNotMatch(page, /重要账号提醒会集中在这里/)

console.log('official notification feed: PASS')
