import assert from 'node:assert/strict'
import fs from 'node:fs'

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')
const index = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const responsive = fs.readFileSync(new URL('../src/styles/responsive.css', import.meta.url), 'utf8')

console.log('[responsive] mobile contract remains canonical')
assert.match(index, /--max-width:\s*480px/)
assert.match(index, /\.app\s*\{[\s\S]*max-width:\s*var\(--max-width\)/)
assert.match(responsive, /@media \(min-width:\s*768px\)/)
assert.ok(main.lastIndexOf("import './styles/responsive.css'") > main.lastIndexOf("import './styles/taProfile.css'"), 'responsive overrides must load last')

console.log('[responsive] wide shell becomes rail + fluid app')
assert.match(responsive, /\.app\s*\{[\s\S]*max-width:\s*none;[\s\S]*padding-left:\s*var\(--el-wide-rail-width\)/)
assert.match(responsive, /\.app-nav\s*\{[\s\S]*width:\s*var\(--el-wide-rail-width\)[\s\S]*flex-direction:\s*column/)
assert.match(responsive, /\.app-nav \.nav-btn\.active::after\s*\{[\s\S]*width:\s*3px;[\s\S]*height:\s*18px/)
assert.match(responsive, /\.app-main\s*\{[\s\S]*padding-bottom:\s*0 !important/)

console.log('[responsive] page types use different wide-screen containers')
assert.match(responsive, /--el-content-chat-max:\s*820px/)
assert.match(responsive, /--el-content-reading-max:\s*860px/)
assert.match(responsive, /--el-content-space-max:\s*1120px/)
assert.match(responsive, /--el-content-photo-max:\s*1180px/)
assert.match(responsive, /\.chat-shell\s*\{[\s\S]*var\(--el-content-chat-max\)/)
assert.match(responsive, /\.settings-page\s*\{[\s\S]*var\(--el-content-reading-max\)/)
assert.match(responsive, /\.memory-page\s*\{[\s\S]*var\(--el-content-reading-max\)/)
assert.match(responsive, /\.ai-space-page\s*\{[\s\S]*var\(--el-content-space-max\)/)
assert.match(responsive, /\.photo-archive-page\s*\{[\s\S]*max-width:\s*none/)
assert.match(responsive, /\.photo-archive-scroll\s*\{[\s\S]*var\(--el-content-photo-max\)/)

console.log('[responsive] full-width page backgrounds are preserved')
assert.match(responsive, /\.home-page\s*\{[\s\S]*padding-inline:\s*var\(--el-wide-gutter\)/)
assert.match(responsive, /\.home-inner\s*\{[\s\S]*var\(--el-content-home-max\)[\s\S]*margin-inline:\s*auto/)
assert.match(responsive, /\.settings-page\s*\{[\s\S]*width:\s*100%/)
assert.match(responsive, /\.memory-page\s*\{[\s\S]*width:\s*100%/)
assert.match(responsive, /\.ai-space-page\s*\{[\s\S]*width:\s*100%/)

console.log('responsive shell contract: PASS')
