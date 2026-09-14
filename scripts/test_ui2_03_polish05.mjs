// UI2-03-POLISH-05 · Memory Book Album Fidelity 结构测试
// 任务书：保持 Portal 比例/尺寸/位置/交互不变，只把「横向书」装帧语言收敛为「相册/纪念册气质」。
// 静态断言覆盖（视觉相似度由 390×844 真实渲染截图对照验收）：
//   1. 比例保持：封面 grid 58fr/42fr、书脊宽度 24–34px、封面圆角形制不变
//   2. Spine → Album Binding：布脊纤维纹理（repeating-linear-gradient）+ 柔和收口（::before）+ Accent 混色
//   3. Botanical 植物花枝：位置中部偏右（left 52%）、明显大于旧 bookmark、inline SVG、不占 grid 流
//   4. Photo Slot：presentation-only 空相纸框，无 img / 无 imageUrl / 无网络图
//   5. 右侧竖排装帧字 mbp-side-vertical（writing-mode: vertical-rl）
//   6. 旧 bookmark / 旧侧区星芒完全移除
//   7. 纸页自然错落：back/paper-1/paper-2 各有轻微 rotateZ 差异
//   8. 「翻开 →」去 CTA：主文字 ink、箭头 Accent
//   9. Year Nav 去 Pill：无 999px 圆角、无 active background，当前年为细 Accent underline（::after）
//   10. Editorial Typography：.memory-title / .mbp-title 使用宋体系 serif 栈，正文不强制 serif
//   11. Theme：Accent 仅参与材质混色/细线（color-mix 层数足够），V2 environment tint 保留
//   12. Protected：memory.ts 无 schema 触碰、无新依赖、无外链图片

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

console.log('[1] 比例 / 尺寸保持')
check('封面 Grid 58/42 保留', /grid-template-columns: 58fr 42fr/.test(CSS))
check('书脊宽度 24–34px 保留', /width: (2[4-9]|3[0-4])px/.test(CSS))
check('封面圆角形制保留（4px 12px 12px 4px）', /border-radius: 4px 12px 12px 4px/.test(CSS))
check('Portal 结构层保留：back/paper-1/paper-2/cover/spine', ['mbp-back', 'mbp-paper-1', 'mbp-paper-2', 'mbp-cover', 'mbp-spine'].every((c) => Memory.includes(c) && CSS.includes(`.${c} {`)))

console.log('[2] Spine → Album Binding（布脊装订）')
check('布脊纤维纹理（repeating-linear-gradient 于 .mbp-spine）', /\.mbp-spine\s*\{[\s\S]{0,500}repeating-linear-gradient/.test(CSS))
check('布脊收口 ::before（柔和弧光）', /\.mbp-spine::before\s*\{[\s\S]{0,300}border-radius: 6px 0 0 0/.test(CSS))
check('布脊 Accent 混色（非纯色块）', /\.mbp-spine\s*\{[\s\S]{0,500}color-mix\(in srgb, var\(--ta-accent\)/.test(CSS))
check('ELUVIN 竖排保留', /mbp-spine-brand/.test(Memory) && /writing-mode: vertical-rl/.test(CSS) && /ELUVIN/.test(Memory))

console.log('[3] Botanical 植物花枝（本轮重点）')
check('mbp-botanical 存在（JSX + CSS + SVG）', /mbp-botanical/.test(Memory) && /\.mbp-botanical\s*\{/.test(CSS) && /<svg/.test(Memory))
check('位置中部偏右（left: 52%）', /\.mbp-botanical\s*\{[\s\S]{0,200}left: 52%/.test(CSS))
check('明显大于旧 bookmark（宽 56px 高 84px）', /\.mbp-botanical\s*\{[\s\S]{0,300}width: 56px[\s\S]{0,80}height: 84px/.test(CSS))
check('植物为 Accent 细线装帧', /\.mbp-botanical\s*\{[\s\S]{0,300}color: color-mix\(in srgb, var\(--ta-accent\)/.test(CSS))
check('不占 grid 流（absolute 定位）', /\.mbp-botanical\s*\{[\s\S]{0,120}position: absolute/.test(CSS))

console.log('[4] Photo Slot（presentation-only 空相纸位）')
check('mbp-photo-slot 存在（JSX + CSS）', /mbp-photo-slot/.test(Memory) && /\.mbp-photo-slot\s*\{/.test(CSS))
check('空相纸框：无 <img> 渲染', !/<img/.test(Memory))
check('相纸角标存在', /mbp-photo-slot-corner/.test(Memory) && /\.mbp-photo-slot-corner\s*\{/.test(CSS))

console.log('[5] 右侧竖排装帧字')
check('mbp-side-vertical 竖排 MEMORY BOOK', /mbp-side-vertical/.test(Memory) && /\.mbp-side-vertical\s*\{[\s\S]{0,200}writing-mode: vertical-rl/.test(CSS) && /MEMORY BOOK/.test(Memory))

console.log('[6] 旧结构移除')
check('旧 mbp-bookmark 完全移除', !/mbp-bookmark/.test(Memory) && !/\.mbp-bookmark/.test(CSS))
check('旧侧区星芒 mbp-side-star 移除', !/mbp-side-star/.test(Memory) && !/\.mbp-side-star/.test(CSS))

console.log('[7] 纸页自然错落')
check('back / paper-1 / paper-2 各有轻微 rotateZ', /\.mbp-back\s*\{[\s\S]{0,420}rotateZ\(0\.18deg\)/.test(CSS) && /\.mbp-paper-1\s*\{[\s\S]{0,320}rotateZ\(-0\.22deg\)/.test(CSS) && /\.mbp-paper-2\s*\{[\s\S]{0,280}rotateZ\(0\.12deg\)/.test(CSS))
check('底部 ≥3 层错位保留', /\.mbp-back\s*\{[\s\S]{0,160}bottom: -16px/.test(CSS) && /\.mbp-paper-1\s*\{[\s\S]{0,160}bottom: -10px/.test(CSS) && /\.mbp-paper-2\s*\{[\s\S]{0,160}bottom: -6px/.test(CSS))

console.log('[8] 「翻开 →」去 CTA 感')
check('主文字 ink（非纯 Accent）', /\.mbp-open\s*\{[\s\S]{0,240}color: color-mix\(in srgb, var\(--ui2-text\)/.test(CSS))
check('箭头 Accent（主题跟随）', /\.mbp-open span\s*\{[\s\S]{0,80}color: var\(--ta-accent\)/.test(CSS))
check('无 pill / button 底色', !/\.mbp-open[\s\S]{0,300}background:/.test(CSS))

console.log('[9] Year Navigation 去 Pill')
check('无 999px 圆角（btn）', !/\.memory-year-nav-btn\s*\{[\s\S]{0,200}border-radius: 999px/.test(CSS))
check('当前年无背景填充（透明或未声明 bg）', !/\.memory-year-nav-btn\.is-current\s*\{[\s\S]{0,180}background: (?:color-mix|rgba|#)/.test(CSS))
check('当前年为 Accent 细下划线 ::after', /\.memory-year-nav-btn\.is-current::after\s*\{[\s\S]{0,220}background: var\(--memory-accent\)/.test(CSS))

console.log('[10] Editorial Typography')
check('页面标题宋体系 serif 栈', /\.memory-title\s*\{[\s\S]{0,300}"Songti SC"/.test(CSS))
check('「记忆书」封面标题 serif 栈', /\.mbp-title\s*\{[\s\S]{0,300}"Songti SC"/.test(CSS))
check('正文不强制 serif（River 条目不受影响）', !/\.memory-entry[\s\S]{0,80}font-family:/.test(CSS))

console.log('[11] Theme / Environment')
check('Accent 参与层 ≥6（spine/botanical/photo-slot/vertical/open/underline）', (CSS.match(/color-mix\(in srgb, var\(--ta-accent\)/g) || []).length >= 6)
check('V2 环境色保留（--memory-accent: var(--ta-accent)）', /--memory-accent: var\(--ta-accent\)/.test(CSS))
check('无整块 Accent 填充封面', !/\.mbp-cover\s*\{[\s\S]{0,400}background:.*var\(--ta-accent\)[^,}\n]*\)\s*;/.test(CSS))

console.log('[12] Protected / 无污染')
check('memory.ts 无 imageUrl/media schema', !/imageUrl|\bimages\b|\.media\b/.test(MemoryLib))
check('无外链图片', !/url\(['"]?https?:/.test(CSS) && !/<img/.test(Memory))
check('无 @import / 新依赖', !CSS.includes('@import') && !/package\.json/.test(Memory))
check('reduced-motion 覆盖 botanical/photo-slot', /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,260}\.mbp-botanical[\s\S]{0,40}\.mbp-photo-slot/.test(CSS))

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
