import assert from 'node:assert/strict'
import fs from 'node:fs'

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')
const index = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const home = fs.readFileSync(new URL('../src/styles/home.css', import.meta.url), 'utf8')
const chat = fs.readFileSync(new URL('../src/styles/ui2.css', import.meta.url), 'utf8')
const space = fs.readFileSync(new URL('../src/styles/space.css', import.meta.url), 'utf8')
const mine = fs.readFileSync(new URL('../src/styles/mine.css', import.meta.url), 'utf8')
const memory = fs.readFileSync(new URL('../src/styles/memory.css', import.meta.url), 'utf8')
const photo = fs.readFileSync(new URL('../src/styles/photoWallArchive.css', import.meta.url), 'utf8')
const event = fs.readFileSync(new URL('../src/styles/eventArchive.css', import.meta.url), 'utf8')

console.log('[responsive] mobile remains canonical')
assert.match(index, /--max-width:\s*480px/)
assert.match(index, /\.app\s*\{[\s\S]*max-width:\s*var\(--max-width\)/)
assert.doesNotMatch(main, /responsive\.css/)

console.log('[responsive] React owns whether the primary rail exists')
assert.match(app, /const primaryNavVisible =[\s\S]*isNavView\(view\)[\s\S]*settingsPrivacyOpen/)
assert.ok(app.includes("app--with-primary-nav"))
assert.match(app, /\{primaryNavVisible && \([\s\S]*<nav className="app-nav">/)

console.log('[responsive] root shell owns only shell geometry')
assert.match(index, /@media \(min-width:\s*768px\)[\s\S]*--el-wide-rail-width:\s*88px/)
assert.match(index, /\.app\.app--with-primary-nav\s*\{[\s\S]*padding-left:\s*var\(--el-wide-rail-width\)/)
assert.match(index, /\.app\.app--with-primary-nav > \.app-nav\s*\{[\s\S]*position:\s*fixed;[\s\S]*width:\s*var\(--el-wide-rail-width\)[\s\S]*flex-direction:\s*column/)
assert.match(index, /\.app\.app--with-primary-nav > \.app-nav > \.nav-btn\s*\{[\s\S]*flex:\s*0 0 auto;[\s\S]*min-height:\s*52px/)
assert.match(index, /\.app\.app--with-primary-nav > \.app-nav > \.nav-btn\.active::after\s*\{[\s\S]*right:\s*2px;[\s\S]*width:\s*3px;[\s\S]*height:\s*18px/)
const shellBlock = index.slice(index.lastIndexOf('/* Responsive App Shell: desktop root layout lives with the root shell. */'))
assert.doesNotMatch(shellBlock, /body\s*\{[\s\S]*overflow:\s*hidden/)
assert.doesNotMatch(shellBlock, /:has\(/)

console.log('[responsive] each page owns its own desktop width')
assert.match(home, /@media \(min-width:\s*768px\)[\s\S]*\.home-inner\s*\{[\s\S]*max-width:\s*var\(--el-content-home-max\)/)
assert.match(chat, /@media \(min-width:\s*768px\)[\s\S]*\.chat-shell\s*\{[\s\S]*var\(--el-content-chat-max\)/)
assert.match(space, /@media \(min-width:\s*768px\)[\s\S]*\.ai-space-v2\s*\{[\s\S]*var\(--el-content-space-max\)/)
assert.match(mine, /@media \(min-width:\s*768px\)[\s\S]*\.settings-page\s*\{[\s\S]*var\(--el-content-reading-max\)/)
assert.match(memory, /@media \(min-width:\s*768px\)[\s\S]*\.memory-page\s*\{[\s\S]*var\(--el-content-reading-max\)/)

console.log('[responsive] lazy archives own their desktop overlays locally')
assert.match(photo, /@media \(min-width:\s*768px\)[\s\S]*\.photo-archive-page,[\s\S]*\.photo-archive-lightbox[\s\S]*max-width:\s*none/)
assert.match(photo, /\.photo-archive-scroll\s*\{[\s\S]*var\(--el-content-photo-max\)/)
assert.match(event, /@media \(min-width:\s*768px\)[\s\S]*\.event-archive-page,[\s\S]*\.event-archive-form-backdrop[\s\S]*max-width:\s*none/)
assert.match(event, /\.event-archive-form\s*\{[\s\S]*width:\s*min\(680px, 100%\)/)

console.log('[responsive] no patch-layer coupling remains')
for (const source of [index, home, chat, space, mine, memory, photo, event]) {
  assert.doesNotMatch(source, /body \.photo-archive|body \.event-archive/)
}
assert.doesNotMatch(main, /styles\/responsive\.css/)

console.log('responsive shell contract: PASS')
