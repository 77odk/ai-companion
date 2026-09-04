// 外观（TASK_THEME）：主题切换子页
// 顶部预览卡 + 5 套默认预设 + 自定义主色取色器。
// 选完即时应用即时存 localStorage，云同步字段见 sync.ts。
import { useState } from 'react'
import {
  THEME_PRESETS,
  DEFAULT_THEME_STATE,
  loadThemeState,
  saveThemeState,
  applyTheme,
  resolveThemeVars,
  type ThemeState,
} from '../lib/theme'
interface Props {
  onBack: () => void
}
export default function Appearance({ onBack }: Props) {
  const [theme, setTheme] = useState<ThemeState>(() => loadThemeState())
  const apply = (next: ThemeState) => {
    setTheme(next)
    saveThemeState(next)
    applyTheme()
  }
  const vars = resolveThemeVars(theme)
  const isCustom = theme.type === 'custom'
  const currentHex = isCustom && theme.customColor ? theme.customColor : vars.primary
  return (
    <div className="page settings-page appearance-page">
      <div className="detail-header">
        <button type="button" className="detail-back" onClick={onBack} aria-label="返回「我的」">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="detail-title">外观</h2>
        <span className="detail-spacer" aria-hidden="true" />
      </div>
      {/* 预览卡：当前主题下的聊天气泡示意 */}
      <section className="appearance-preview">
        <div className="appearance-preview-bubbles">
          <div className="appearance-bubble ai" style={{ background: vars.card, border: `1px solid ${vars.border}` }}>
            今天过得怎么样？
          </div>
          <div className="appearance-bubble user" style={{ background: vars.primary, color: vars.onPrimary }}>
            还不错，刚忙完
          </div>
          <div className="appearance-bubble ai" style={{ background: vars.card, border: `1px solid ${vars.border}` }}>
            那就好，晚上一起散步吗？
          </div>
        </div>
        <div className="appearance-preview-caption">
          现在的样子：<span style={{ color: vars.primary }}>{isCustom ? '自定义' : THEME_PRESETS.find((p) => p.id === theme.presetId)?.name ?? '蜜桃暖（经典）'}</span>
        </div>
      </section>
      {/* 默认预设 */}
      <section className="profile-group">
        <h3 className="profile-group-title">默认主题</h3>
        <div className="profile-group-card">
          <div className="appearance-preset-row">
            {THEME_PRESETS.map((p) => {
              const active = theme.type === 'preset' && theme.presetId === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`appearance-preset${active ? ' active' : ''}`}
                  aria-pressed={active}
                  aria-label={p.name}
                  title={p.name}
                  onClick={() => apply({ type: 'preset', presetId: p.id })}
                >
                  <span className="appearance-swatch" style={{ background: p.vars.primary }} />
                  {active && (
                    <span className="appearance-check">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <div className="appearance-preset-names">
            {THEME_PRESETS.map((p) => (
              <span key={p.id} className={`appearance-preset-name${theme.type === 'preset' && theme.presetId === p.id ? ' active' : ''}`}>
                {p.name.replace('（经典）', '')}
              </span>
            ))}
          </div>
        </div>
      </section>
      {/* 自定义主色 */}
      <section className="profile-group">
        <h3 className="profile-group-title">自定义主色</h3>
        <div className="profile-group-card">
          <div className="appearance-custom-row">
            <label className="appearance-custom-pick">
              <input
                type="color"
                value={currentHex}
                onChange={(e) => apply({ type: 'custom', customColor: e.target.value })}
                aria-label="选择主色"
              />
              <span className="appearance-swatch" style={{ background: currentHex }} />
            </label>
            <div className="appearance-custom-info">
              <span className="appearance-custom-desc">
                {isCustom ? '已应用自定义主色' : '选一个颜色，自动派生整套'}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost appearance-reset"
            onClick={() => apply({ ...DEFAULT_THEME_STATE })}
          >
            恢复默认（蜜桃暖）
          </button>
        </div>
      </section>
    </div>
  )
}
