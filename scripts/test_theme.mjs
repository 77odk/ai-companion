// 主题系统派生算法纯逻辑自测（TASK_THEME）
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_theme.mjs
// 覆盖：hex/hsl 互转 / 预设表完整性 / 自定义主色派生关系 / 浅主色按钮字规则 / 状态解析
import {
  hexToHsl,
  hslToHex,
  deriveThemeFromPrimary,
  THEME_PRESETS,
  DEFAULT_THEME_STATE,
  getPresetById,
  resolveThemeVars,
  THEME_CSS_KEYS,
} from '../src/lib/theme.ts'
let passed = 0
let failed = 0
function ok(cond, name) {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}
function near(a, b, tol, name) {
  ok(Math.abs(a - b) <= tol, `${name}（得 ${a}，期望约 ${b}）`)
}
console.log('\n[1] hexToHsl / hslToHex 互转')
{
  const h = hexToHsl('#ff8a5c')
  near(h.h, 17, 2, 'peach 主色色相约 17°')
  near(h.l, 68, 3, 'peach 主色亮度约 68%')
  const back = hslToHex(h.h, h.s, h.l)
  ok(back === '#ff8a5c', `hslToHex(hexToHsl) 还原 #ff8a5c（得 ${back}）`)
  // HSL↔HEX 往返允许 ±1 通道舍入误差（标准取整，非精度问题）
  const h2 = hexToHsl('#3f6b5c')
  const [r2, g2, b2] = [62, 106, 91] // #3e6a5b 的 rgb
  const backR = parseInt(hslToHex(h2.h, h2.s, h2.l).slice(1, 3), 16)
  const backG = parseInt(hslToHex(h2.h, h2.s, h2.l).slice(3, 5), 16)
  const backB = parseInt(hslToHex(h2.h, h2.s, h2.l).slice(5, 7), 16)
  ok(Math.abs(backR - r2) <= 1 && Math.abs(backG - g2) <= 1 && Math.abs(backB - b2) <= 1, `墨绿主色往返误差 ≤1（得 ${hslToHex(h2.h, h2.s, h2.l)}）`)
  ok(hexToHsl('not-a-color').l === 100, '非法输入 → 回落白色（不抛错）')
}
console.log('\n[2] 预设表完整性')
ok(THEME_PRESETS.length === 5, '共 5 套预设')
ok(THEME_PRESETS[0].id === 'peach' && DEFAULT_THEME_STATE.presetId === 'peach', '默认 = peach（老用户无感）')
for (const p of THEME_PRESETS) {
  const v = p.vars
  ok(/^#[0-9a-f]{6}$/i.test(v.primary), `${p.id} primary 是合法 hex`)
  ok(/^#[0-9a-f]{6}$/i.test(v.soft), `${p.id} soft 是合法 hex`)
  ok(/^#[0-9a-f]{6}$/i.test(v.deep), `${p.id} deep 是合法 hex`)
  ok(/^#[0-9a-f]{6}$/i.test(v.bg), `${p.id} bg 是合法 hex`)
  ok(/^#[0-9a-f]{6}$/i.test(v.border), `${p.id} border 是合法 hex`)
  // 每套手调色也验证"soft 比 primary 浅、deep 比 primary 深"
  ok(hexToHsl(v.soft).l > hexToHsl(v.primary).l, `${p.id} soft 亮度高于 primary`)
  ok(hexToHsl(v.deep).l < hexToHsl(v.primary).l, `${p.id} deep 亮度低于 primary`)
  ok(hexToHsl(v.bg).l > 95, `${p.id} bg 是极淡底（L>95）`)
}
ok(getPresetById('dusk')?.id === 'dusk', 'getPresetById 命中')
ok(getPresetById('nope') === null, 'getPresetById 未命中 → null')
ok(THEME_CSS_KEYS.includes('--color-on-primary'), 'CSS 变量清单含按钮字色 --color-on-primary')
console.log('\n[3] 自定义主色 → 派生关系（#ff8a5c 蜜桃暖）')
{
  const v = deriveThemeFromPrimary('#ff8a5c')
  const h = hexToHsl('#ff8a5c')
  const hSoft = hexToHsl(v.soft)
  const hDeep = hexToHsl(v.deep)
  const hBg = hexToHsl(v.bg)
  const hBorder = hexToHsl(v.border)
  ok(v.primary === '#ff8a5c', 'primary 保留用户所选')
  near(hSoft.l, 88, 2, 'soft 亮度约 88%')
  ok(hSoft.l > h.l, 'soft 比 primary 浅')
  near(hDeep.l, 38, 3, 'deep 亮度约 38%')
  ok(hDeep.l < h.l, 'deep 比 primary 深')
  near(hBg.l, 97, 1, 'bg 亮度约 97%')
  near(hBorder.l, 90, 1, 'border 亮度约 90%')
  ok(v.onPrimary === '#ffffff', '正常主色按钮字为白')
}
console.log('\n[4] 浅主色对比度保护（L>70% → 按钮字切 deep）')
{
  const pale = deriveThemeFromPrimary('#ffe0e0') // 粉白，L≈94%
  const h = hexToHsl('#ffe0e0')
  ok(h.l > 70, '粉白主色确实够浅（作为前置）')
  ok(pale.onPrimary === pale.deep, `浅主色按钮字用 deep 而非白（得 ${pale.onPrimary}）`)
  ok(pale.onPrimary !== '#ffffff', '浅主色按钮字不是白色')
  // 深主色（墨绿）仍白字
  const dark = deriveThemeFromPrimary('#3f6b5c')
  ok(dark.onPrimary === '#ffffff', '深主色按钮字仍为白')
}
console.log('\n[5] resolveThemeVars 状态解析')
{
  const preset = resolveThemeVars({ type: 'preset', presetId: 'clay' })
  ok(preset.primary === '#c05f3a', 'preset 直接用拍板色值（clay）')
  const custom = resolveThemeVars({ type: 'custom', customColor: '#123456' })
  ok(custom.primary === '#123456', 'custom 用用户所选主色')
  ok(custom.soft !== '#123456', 'custom 派生 soft 与主色不同')
  const fallback = resolveThemeVars({ type: 'preset', presetId: 'nope' })
  ok(fallback.primary === '#ff8a5c', '未知 preset 回落默认 peach')
  const bad = resolveThemeVars({ type: 'custom', customColor: 'oops' })
  ok(bad.primary === '#ff8a5c', '非法自定义色回落默认 peach（不崩）')
  const empty = resolveThemeVars(null)
  ok(empty.primary === '#ff8a5c', '空状态回落默认 peach')
}
console.log('\n[6] 派生产物不翻车（选 8 个代表色全测一遍）')
for (const hex of ['#ff8a5c', '#6a6fdc', '#3f6b5c', '#7089a6', '#c05f3a', '#39ff14', '#1a2b3c', '#ffd700']) {
  const v = deriveThemeFromPrimary(hex)
  const hBg = hexToHsl(v.bg)
  const hSoft = hexToHsl(v.soft)
  ok(hBg.l > 95, `${hex} bg 永远极淡（L=${hBg.l.toFixed(0)}）`)
  ok(hSoft.l > 80, `${hex} soft 永远够浅（L=${hSoft.l.toFixed(0)}）`)
  ok(/^#[0-9a-f]{6}$/i.test(v.deep) && /^#[0-9a-f]{6}$/i.test(v.border), `${hex} 全部产物合法 hex`)
}
console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
