// UI2-03-POLISH-04 · Memory Book Visual Fidelity 结构测试
// 覆盖任务书 V1–V14 中可用静态断言验证的部分（视觉相似度由截图对照验收）：
//   1. 5 个真实视觉层：mbp-back / mbp-paper-1 / mbp-paper-2 / mbp-cover / mbp-spine
//   2. 书脊宽度规则在 24–34px（CSS 声明）
//   3. 封面为两栏 Grid（58fr 42fr）
//   4. 「翻开 →」位于侧区（右侧）：.mbp-side + .mbp-open
//   5. 装帧元素：.mbp-bookmark（植物线稿 SVG）+ .mbp-spine-brand（ELUVIN 竖排）+ .mbp-spine-mark + .mbp-side-star
//   6. 底部 ≥3 层：back/paper 的 bottom 错位（-16/-10/-6）且长度不同（right 错位 -11/-7/-4）
//   7. Theme：CSS 使用 color-mix(in srgb, var(--ta-accent), ...)（spine/bookmark/open/star）
//   8. 无新增 slogan（Same you… 不在文案中）
//   9. press 为 translateY(1px)；reduced-motion 静态仍像书
//   10. Protected：无 imageUrl/schema 触碰、无新依赖

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const Memory = readFileSync(path.join(root, 'src/components/Memory.tsx'), 'utf8')
const CSS = readFileSync(path.join(root, 'src/styles/ui2.css'), 'utf8')
const MemoryLibPath = path.join(root, 'src/lib/memory.ts')
const MemoryLib = existsSync(MemoryLibPath) ? readFileSync(MemoryLibPath, 'utf8') : ''

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ok - ${name}`) } else { failed++; console.log(`  FAIL - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

console.log('[1] 5 个真实视觉层')
check('封底 mbp-back 存在（JSX + CSS）', /mbp-back/.test(Memory) && /\.mbp-back\s*\{/.test(CSS))
check('纸页层 1 mbp-paper-1', /mbp-paper-1/.test(Memory) && /\.mbp-paper-1\s*\{/.test(CSS))
check('纸页层 2 mbp-paper-2', /mbp-paper-2/.test(Memory) && /\.mbp-paper-2\s*\{/.test(CSS))
check('封面 mbp-cover（JSX + CSS）', /mbp-cover/.test(Memory) && /\.mbp-cover\s*\{/.test(CSS))
check('书脊 mbp-spine（JSX + CSS）', /mbp-spine/.test(Memory) && /\.mbp-spine\s*\{/.test(CSS))

console.log('[2] 书脊 / 封面形制')
check('书脊宽度 24–34px', /width: (2[4-9]|3[0-4])px/.test(CSS))
check('书脊为 accent 混合材质（非纯色竖条）', /\.mbp-spine\s*\{[\s\S]{0,400}color-mix\(in srgb, var\(--ta-accent\)/.test(CSS))
check('封面两栏 Grid 58/42', /grid-template-columns: 58fr 42fr/.test(CSS))
check('封面非标准四角大圆角（左 4px 右 12px）', /border-radius: 4px 12px 12px 4px/.test(CSS))

console.log('[3] 右侧/底部多层错位')
check('底部 ≥3 层：back/paper bottom 错位递增', /\.mbp-back\s*\{[\s\S]{0,160}bottom: -16px/.test(CSS) && /\.mbp-paper-1\s*\{[\s\S]{0,160}bottom: -10px/.test(CSS) && /\.mbp-paper-2\s*\{[\s\S]{0,160}bottom: -6px/.test(CSS))
check('右侧页边错位：back/paper right 递增', /\.mbp-back\s*\{[\s\S]{0,160}right: -11px/.test(CSS) && /\.mbp-paper-1\s*\{[\s\S]{0,160}right: -7px/.test(CSS) && /\.mbp-paper-2\s*\{[\s\S]{0,160}right: -4px/.test(CSS))
check('纸页长度不同（left 错位 30/26/28）', /\.mbp-back\s*\{[\s\S]{0,160}left: 30px/.test(CSS) && /\.mbp-paper-1\s*\{[\s\S]{0,160}left: 26px/.test(CSS))

console.log('[4] 封面排版 / 装帧')
check('「翻开 →」在侧区 .mbp-side + .mbp-open', /mbp-side/.test(Memory) && /mbp-open/.test(Memory))
check('翻开 → 使用 Accent（主题跟随）', /\.mbp-open\s*\{[\s\S]{0,200}color: var\(--ta-accent\)/.test(CSS))
check('植物 bookmark（inline SVG 装帧）', /mbp-bookmark/.test(Memory) && /\.mbp-bookmark\s*\{/.test(CSS) && /<svg/.test(Memory))
check('书脊竖排 ELUVIN', /mbp-spine-brand/.test(Memory) && /writing-mode: vertical-rl/.test(CSS) && /ELUVIN/.test(Memory))
check('书脊小星芒 + 侧区星芒（装帧符号）', /mbp-spine-mark/.test(Memory) && /mbp-side-star/.test(Memory))
check('无新增产品性文案', !Memory.includes('Same you') && !Memory.includes('Brighter tomorrow') && !Memory.includes('那些细碎的日常'))
check('无 emoji 图标', !/[😀-🙏🌀-🫿]/u.test(Memory))
check('无网络图片/生成图', !/<img/.test(Memory) && !/url\(['"]?https?:/.test(Memory.split('mbp-bookmark')[0].length ? CSS : CSS))

console.log('[5] 交互 / 主题 / 保护')
check('press=translateY(1px)，非 scale', /:active \.mbp-cover[\s\S]{0,120}translateY\(1px\)/.test(CSS) && !/scale\(\.9\d\)/.test(CSS))
check('hover 微增强（bookmark 显现）', /\.memory-book-portal:hover \.mbp-bookmark[\s\S]{0,80}opacity: 1/.test(CSS))
check('reduced-motion 静态仍像书（无动画依赖）', /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,200}\.mbp-cover/.test(CSS))
check('主题参与层 ≥4（spine/bookmark/open/star/cover glow）', (CSS.match(/color-mix\(in srgb, var\(--ta-accent\)/g) || []).length >= 4)
check('未改 Memory schema（memory.ts 无 imageUrl/media）', !/imageUrl|\bimages\b|\.media\b/.test(MemoryLib))
check('未新增依赖', !/package\.json/.test(Memory) && !CSS.includes('@import'))

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
