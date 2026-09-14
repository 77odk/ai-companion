// UI2-03-POLISH-03 · Memory Book Portal + Image-ready River 视觉/结构测试
// 覆盖（任务书验收项）：
//   1. Memory.tsx 不再引用旧 .memory-book-tag（右上角书签标签已删除）
//   2. 存在 .memory-book-portal 实体书 button（整本可点击、aria-label、onClick=openBookCover）
//   3. Portal 由 spine / cover / kicker / title / copy / open 构成
//   4. Portal 位于 Year Nav 上方（JSX 顺序：portal 在 .memory-river 之前）
//   5. River entry 包 .memory-entry-content 容器（Image-ready seam）
//   6. 生产代码无 .memory-entry-media 渲染（无图不渲染占位）
//   7. ui2.css 含 portal 实体书规则（paper stack / reduced-motion / 接触阴影）
//   8. 未改 Memory schema：memory.ts 无 imageUrl / images / media 字段
//   9. Refresh 独立：Memory.tsx 仍引用 .home-web-refresh（不与 book 共用 actions）

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const memoryPath = path.join(root, 'src/components/Memory.tsx')
const cssPath = path.join(root, 'src/styles/ui2.css')
const memoryLibPath = path.join(root, 'src/lib/memory.ts')

const Memory = readFileSync(memoryPath, 'utf8')
const CSS = readFileSync(cssPath, 'utf8')
const MemoryLib = existsSync(memoryLibPath) ? readFileSync(memoryLibPath, 'utf8') : ''

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  ok - ${name}`)
  } else {
    failed++
    console.log(`  FAIL - ${name}${detail ? ` :: ${detail}` : ''}`)
  }
}

console.log('[1] Memory.tsx 结构')
check('无旧 .memory-book-tag 引用', !/memory-book-tag/.test(Memory))
check('存在 .memory-book-portal', /className="memory-book-portal"/.test(Memory) || /className=\{?["']memory-book-portal/.test(Memory))
check('portal 是整本可点击 button（onClick=openBookCover）', /<button[^>]*className="memory-book-portal"[^>]*onClick=\{openBookCover\}[^>]*>/.test(Memory))
check('portal aria-label=翻开记忆书', /aria-label="翻开记忆书"/.test(Memory))
check('含 spine 元素（mbp-spine）', /mbp-spine/.test(Memory))
check('含 cover / kicker / title / copy / open（mbp-*）', ['mbp-cover', 'mbp-kicker', 'mbp-title', 'mbp-copy', 'mbp-open'].every((c) => Memory.includes(c)))
check('文案固定：MEMORY BOOK / 记忆书 / 有些记忆，适合重新翻开。', ['MEMORY BOOK', '记忆书', '有些记忆，', '适合重新翻开。'].every((t) => Memory.includes(t)))
check('Portal 位于 .memory-river 之前（Book → Year → River 层级）', Memory.indexOf('memory-book-portal') < Memory.indexOf('memory-river'))
check('Refresh 独立保留（.home-web-refresh）', /className="home-web-refresh"/.test(Memory))
check('无新增"slogan/副标题/刷新文字"', !Memory.includes('Same you') && !Memory.includes('花语') && !Memory.includes('「刷新」'))
check('无新增图片标签渲染', !/<img/.test(Memory))

console.log('[2] Image-ready River seam')
check('entry 包 .memory-entry-content', /memory-entry-content/.test(Memory))
// 真实断言（原实现尾部有 `|| true`，永远 PASS；这里是集成时修正的假绿）
const codeWithoutComments = Memory.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
check('生产代码无 .memory-entry-media 渲染（注释外）', !/memory-entry-media/.test(codeWithoutComments))

console.log('[3] ui2.css 实体书规则')
check('含 .memory-book-portal 基础规则', /\.memory-book-portal\s*\{/.test(CSS))
check('含显式纸页层 + 封底（mbp-paper-1/2 + mbp-back）', /mbp-paper-1/.test(Memory) && /mbp-paper-2/.test(Memory) && /mbp-back/.test(Memory))
check('含 spine CSS', /\.mbp-spine\s*\{/.test(CSS))
check('含 cover CSS', /\.mbp-cover\s*\{/.test(CSS))
check('含接触阴影（贴地非漂浮）', /0 3px 6px -2px/.test(CSS) && /0 8px 12px -6px/.test(CSS))
check('含 press 轻反馈（translateY 非 scale）', /translateY\(1px\)/.test(CSS) && !/scale\(\.9\d\)/.test(CSS))
check('含 reduced-motion 降级', /@media \(prefers-reduced-motion: reduce\)/.test(CSS) && /\.mbp-cover/.test(CSS))
check('含 .memory-entry-content 规则', /\.memory-entry-content\s*\{/.test(CSS))
check('book-tag 旧样式已移除', !/\.memory-book-tag\s*\{/.test(CSS))

console.log('[4] Protected / 数据层')
check('memory.ts 无 imageUrl/images/media 字段（schema 未改）', !/imageUrl|\bimages\b|\.media\b/.test(MemoryLib))
check('Memory.tsx 未引用 imageUrl', !/imageUrl|\.images\b/.test(Memory))
check('CSS 无 .memory-entry-media 生产规则（仅注释 seam，无占位）', !/\.memory-entry-media\s*\{/.test(CSS))

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
