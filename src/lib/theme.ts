// 主题系统（TASK_THEME，2026-09-04 七七拍板）
// 全站配色由 CSS 变量驱动，主题 = 一套色值，改主题不改组件。
// 5 套默认预设（手调好值直接用，不跑算法）+ 自定义主色自动派生整套。
// 纯逻辑零依赖，派生算法可被 Node 单测（test_theme.mjs）。
export interface ThemeVars {
  primary: string
  soft: string
  deep: string
  bg: string
  card: string
  border: string
  /** 主色底上的文字色：主色够深用 #fff，主色过浅（L>70%）用 deep 保证对比度 */
  onPrimary: string
}
export interface ThemeState {
  type: 'preset' | 'custom'
  presetId?: string
  customColor?: string
}
export interface ThemePreset {
  id: string
  name: string
  vars: ThemeVars
}
export const THEME_KEY = 'ai_companion_theme'
/** 5 套默认预设（色值是拍板定稿，直接用手调值，不经过派生算法） */
export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'peach',
    name: '蜜桃暖（经典）',
    vars: {
      primary: '#ff8a5c',
      soft: '#ffd3b6',
      deep: '#e96f3e',
      bg: '#fff8f3',
      card: '#ffffff',
      border: '#f0dcd0',
      onPrimary: '#ffffff',
    },
  },
  {
    id: 'dusk',
    name: '暮色蓝紫',
    vars: {
      primary: '#6a6fdc',
      soft: '#e6e5f8',
      deep: '#565bc4',
      bg: '#f7f7fd',
      card: '#ffffff',
      border: '#e4e3f4',
      onPrimary: '#ffffff',
    },
  },
  {
    id: 'ink',
    name: '墨绿暖金',
    vars: {
      primary: '#3f6b5c',
      soft: '#e2ece7',
      deep: '#2e5346',
      bg: '#f8f7f2',
      card: '#ffffff',
      border: '#e2e0d2',
      onPrimary: '#ffffff',
    },
  },
  {
    id: 'mist',
    name: '雾霾蓝',
    vars: {
      primary: '#7089a6',
      soft: '#e6ecf3',
      deep: '#5a7390',
      bg: '#f5f7fa',
      card: '#ffffff',
      border: '#e0e6ee',
      onPrimary: '#ffffff',
    },
  },
  {
    id: 'clay',
    name: '陶土橘',
    vars: {
      primary: '#c05f3a',
      soft: '#f6e3da',
      deep: '#a54a28',
      bg: '#faf5f1',
      card: '#ffffff',
      border: '#eedfd5',
      onPrimary: '#ffffff',
    },
  },
]
const DEFAULT_PRESET_ID = 'peach'
export const DEFAULT_THEME_STATE: ThemeState = { type: 'preset', presetId: DEFAULT_PRESET_ID }
/** 每套变量写进 :root 的 CSS 变量名（onPrimary 是新增的按钮字色） */
export const THEME_CSS_KEYS = [
  '--color-primary',
  '--color-primary-soft',
  '--color-primary-deep',
  '--color-bg',
  '--color-card',
  '--color-border',
  '--color-on-primary',
] as const
// ---- 纯函数：hex <-> hsl ----
function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}
/** #rrggbb → { h: 0-360, s: 0-100, l: 0-100 }（s/l 用百分比数） */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim())
  if (!m) return { h: 0, s: 0, l: 100 }
  const n = parseInt(m[1], 16)
  const r = ((n >> 16) & 0xff) / 255
  const g = ((n >> 8) & 0xff) / 255
  const b = (n & 0xff) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return { h, s: s * 100, l: l * 100 }
}
/** { h, s, l }（s/l 百分比数）→ #rrggbb */
export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360 / 360
  const ss = clamp255(s) / 100
  const ll = clamp255(l) / 100
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss
  const p = 2 * ll - q
  const hue = (t: number) => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  const r = clamp255(hue(hh + 1 / 3) * 255)
  const g = clamp255(hue(hh) * 255)
  const b = clamp255(hue(hh - 1 / 3) * 255)
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}
// ---- 自定义主色 → 派生整套（TASK_THEME 派生算法） ----
// soft  = 主色降饱和至 ~30%、提亮至 ~88%
// deep  = 主色压暗（L 降至 ~38%）
// bg    = 主色极淡（L ~97%、饱和 ~25%）
// border= bg 与 primary 之间（L ~90%）
// onPrimary = 主色 L>70% 用 deep（保证浅主色下按钮字可读），否则 #fff
export function deriveThemeFromPrimary(primary: string): ThemeVars {
  const { h, l } = hexToHsl(primary)
  const soft = hslToHex(h, 30, 88)
  const deep = hslToHex(h, Math.max(20, Math.min(60, 45)), 38)
  const bg = hslToHex(h, 25, 97)
  const border = hslToHex(h, 25, 90)
  const onPrimary = l > 70 ? deep : '#ffffff'
  return { primary, soft, deep, bg, card: '#ffffff', border, onPrimary }
}
/** 预设 id → 预设（找不到回落 peach） */
export function getPresetById(id: string): ThemePreset | null {
  return THEME_PRESETS.find((p) => p.id === id) ?? null
}
/** 解析主题状态 → 实际色值（preset 直接用预设值；custom 走派生算法） */
export function resolveThemeVars(state: ThemeState): ThemeVars {
  if (state?.type === 'custom' && state.customColor && /^#?[0-9a-f]{6}$/i.test(state.customColor.trim())) {
    return deriveThemeFromPrimary(state.customColor.trim())
  }
  const presetId = state?.presetId ?? DEFAULT_PRESET_ID
  return (getPresetById(presetId) ?? THEME_PRESETS[0])!.vars
}
/** 读取当前主题状态（损坏/不存在回落默认 peach） */
export function loadThemeState(): ThemeState {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    if (!raw) return { ...DEFAULT_THEME_STATE }
    const p = JSON.parse(raw) as ThemeState
    if (p && (p.type === 'preset' || p.type === 'custom')) return p
    return { ...DEFAULT_THEME_STATE }
  } catch {
    return { ...DEFAULT_THEME_STATE }
  }
}
/** 存主题状态 */
export function saveThemeState(state: ThemeState): void {
  try {
    localStorage.setItem(THEME_KEY, JSON.stringify(state))
  } catch {
    // 存不下不影响功能
  }
}
/** 把某套色值写进 document 根节点的 CSS 变量（inline，无需换 stylesheet） */
export function applyThemeVars(vars: ThemeVars): void {
  const root = typeof document !== 'undefined' ? document.documentElement : null
  if (!root) return
  root.style.setProperty('--color-primary', vars.primary)
  root.style.setProperty('--color-primary-soft', vars.soft)
  root.style.setProperty('--color-primary-deep', vars.deep)
  root.style.setProperty('--color-bg', vars.bg)
  root.style.setProperty('--color-card', vars.card)
  root.style.setProperty('--color-border', vars.border)
  root.style.setProperty('--color-on-primary', vars.onPrimary)
}
/** 应用一次主题：读状态 → 解析色值 → 写 CSS 变量 */
export function applyTheme(): void {
  applyThemeVars(resolveThemeVars(loadThemeState()))
}
