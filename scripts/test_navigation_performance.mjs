// Navigation performance second pass: source contracts only.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const app = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8')

console.log('\n[1] 主导航 lazy chunk 登录后空闲预取')
assert.match(app, /const loadSettingsView = \(\) => import\('\.\/components\/Settings'\)/)
assert.match(app, /const loadAISpaceView = \(\) => import\('\.\/components\/AISpace'\)/)
assert.match(app, /const loadMemoryView = \(\) => import\('\.\/components\/Memory'\)/)
assert.match(app, /Promise\.allSettled\(\[loadAISpaceView\(\), loadMemoryView\(\), loadSettingsView\(\)\]\)/)
assert.match(app, /requestIdleCallback\(preloadPrimaryViews/)
assert.match(app, /setTimeout\(preloadPrimaryViews, 500\)/)

console.log('\n[2] 切页前滚动位置捕获保持单遍扫描')
const captureStart = app.indexOf('const captureScroll = useCallback')
const restoreStart = app.indexOf('const restoreScroll = useCallback')
assert.ok(captureStart >= 0 && restoreStart > captureStart)
const capture = app.slice(captureStart, restoreStart)
assert.match(capture, /const counts = new Map<string, number>\(\)/)
assert.match(capture, /for \(const el of els\)/)
assert.equal(capture.includes('els.filter('), false, 'captureScroll 不再为每个元素重复扫描整棵 DOM')

console.log('\n[3] 滚动恢复同样单遍遍历 DOM')
const restoreEnd = app.indexOf('/** 用户主动导航', restoreStart)
const restore = app.slice(restoreStart, restoreEnd)
assert.match(restore, /const wanted = new Map<string, Map<number, number>>\(\)/)
assert.match(restore, /for \(const el of container\.querySelectorAll<HTMLElement>\('\*'\)\)/)
assert.equal(restore.includes('for (const el of els)'), false, 'restoreScroll 不再按每条记录重复遍历全部元素')

console.log('\nnavigation performance contracts: all passed')
