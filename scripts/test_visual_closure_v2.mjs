// UI2-03 Visual Closure Fix V2 · 布局/视觉静态回归测试
// 覆盖 BUG-B（旧题头删除）与 BUG-C（Refresh/Book 同行动态布局）的源码级约束。
// 真实浏览器 bounding-rect 与双主题视觉证据由 CDP QA 脚本输出（见交付报告）。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const memoryTsx = readFileSync(join(root, 'src/components/Memory.tsx'), 'utf8')
const appTsx = readFileSync(join(root, 'src/App.tsx'), 'utf8')
const ui2Css = readFileSync(join(root, 'src/styles/ui2.css'), 'utf8')

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('\n[BUG-B] Memory 旧品牌题头彻底删除（不渲染、不占位）')
check('Memory.tsx 不含「忆文」', !memoryTsx.includes('忆文'))
check('Memory.tsx 不含「忆过往」', !memoryTsx.includes('忆过往'))
check('Memory.tsx 不含「成文思」', !memoryTsx.includes('成文思'))
check(
  'App.tsx memory 视图不渲染 app-header（全局品牌头仅 home/memory 排除，其余视图保留）',
  /view === 'home' \|\| view === 'memory' \? null :/.test(appTsx),
  appTsx.includes("view === 'home' || view === 'memory'") ? 'ok' : 'missing',
)

console.log('\n[BUG-C] Refresh 与「记忆书」同 head 行内、独立 hit area')
check('Memory.tsx 有 .memory-head-actions 容器', memoryTsx.includes('className="memory-head-actions"'))
check('home-web-refresh 移入 memory-head-actions 内', /<span className="memory-head-actions">\s*<button[\s\S]*?className="home-web-refresh"/.test(memoryTsx))
check('book-tag 与 refresh 同属 actions（book-tag 在 refresh 之后）', /className="home-web-refresh"[\s\S]*?className="memory-book-tag"/.test(memoryTsx))
check('ui2.css 有 .memory-head-actions 布局', /\.memory-head-actions\s*\{[\s\S]*?inline-flex/.test(ui2Css))
check('ui2.css Memory 页内 refresh 转 flow（position:static）', /\.memory-page \.home-web-refresh\s*\{[\s\S]*?position:\s*static/.test(ui2Css))
check('ui2.css 中 home-web-refresh 全局 absolute 定义仍在（Home 不受影响）', /\.home-web-refresh\s*\{[\s\S]*?position:\s*absolute/.test(ui2Css))

console.log('\n[BUG-A] Memory 主环境色消费 TA Accent')
check('memory-page 背景含 accent 均匀基底（6.5% linear tint）', /\.memory-page\s*\{[\s\S]*?linear-gradient\(color-mix\(in srgb, var\(--ta-accent\) 6\.5%/.test(ui2Css))
check('memory-page 背景含顶部 accent halo（16%）', /\.memory-page\s*\{[\s\S]*?color-mix\(in srgb, var\(--ta-accent\) 16%/.test(ui2Css))
check('memory-page 背景保留 Material base（--ui2-canvas 兜底）', /\.memory-page\s*\{[\s\S]*?var\(--ui2-canvas\)/.test(ui2Css))
check('ordinary 节点边框消费 accent', /\.memory-entry-dot\s*\{[\s\S]*?color-mix\(in srgb, var\(--memory-accent\) 48%/.test(ui2Css))
check('explicit 节点实心 accent', /\.memory-entry\.is-explicit \.memory-entry-dot\s*\{[\s\S]*?background:\s*var\(--memory-accent\)/.test(ui2Css))
check('detail 页背景同步 accent tint（含 6.5% 基底）', /\.memory-detail-page\s*\{[\s\S]*?color-mix\(in srgb, var\(--ta-accent\) 6\.5%/.test(ui2Css))

console.log(`\n结果: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
