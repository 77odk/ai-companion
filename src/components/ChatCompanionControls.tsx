import { useEffect, useRef, useState } from 'react'
import { ELUVIN_DATA_CHANGE } from '../lib/dataChange'
import { identityModeLabel, resolveIdentityMode, saveIdentityMode, type IdentityMode } from '../lib/companionPolicy'
import { isActiveConfig, loadSavedConfigs, type SavedConfig } from '../lib/savedConfigs'
import { loadSettings, saveModelHistory, saveSettings } from '../lib/storage'

const IDENTITY_OPTIONS: Array<{ value: IdentityMode; label: string; note: string }> = [
  { value: 'immersive', label: '沉浸', note: '完整真人感' },
  { value: 'natural', label: '自然', note: '平衡真人感与 AI' },
  { value: 'ai', label: 'AI 本体', note: '保留 AI 身份' },
]

const IDENTITY_DETAILS: Array<{ label: string; text: string }> = [
  { label: '沉浸', text: '完整真人感。TA 会有自己的日常与忙碌，也会短暂离开，约 3–5 分钟后再回来。' },
  { label: '自然', text: '有真人感的 AI。TA 会有情绪、想法和陪伴感，但不会虚构现实中的身体与生活。' },
  { label: 'AI 本体', text: '保留 AI 身份。TA 会以 AI 的方式思考、回应和陪伴，不模拟真人生活。' },
]

function identityDisplayLabel(mode: IdentityMode): string {
  return mode === 'ai' ? 'AI 本体' : identityModeLabel(mode)
}

function shortModelLabel(configs: SavedConfig[]): string {
  const current = loadSettings()
  const active = configs.find((config) => isActiveConfig(current, config))
  return (active?.name || current.model || '模型').slice(0, 18)
}

export default function ChatCompanionControls({ sessionId }: { sessionId: string }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [identityMode, setIdentityMode] = useState<IdentityMode>(() => resolveIdentityMode(sessionId))
  const [configs, setConfigs] = useState<SavedConfig[]>(() => loadSavedConfigs())
  const [modelLabel, setModelLabel] = useState(() => shortModelLabel(loadSavedConfigs()))
  const [open, setOpen] = useState<'identity' | 'model' | null>(null)
  const [showIdentityHelp, setShowIdentityHelp] = useState(false)

  useEffect(() => {
    const refresh = () => {
      const nextConfigs = loadSavedConfigs()
      setIdentityMode(resolveIdentityMode(sessionId))
      setConfigs(nextConfigs)
      setModelLabel(shortModelLabel(nextConfigs))
    }
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(null)
        setShowIdentityHelp(false)
      }
    }
    window.addEventListener(ELUVIN_DATA_CHANGE, refresh)
    window.addEventListener('model-settings-changed', refresh)
    document.addEventListener('pointerdown', closeOutside)
    return () => {
      window.removeEventListener(ELUVIN_DATA_CHANGE, refresh)
      window.removeEventListener('model-settings-changed', refresh)
      document.removeEventListener('pointerdown', closeOutside)
    }
  }, [sessionId])

  const chooseIdentity = (mode: IdentityMode) => {
    if (saveIdentityMode(sessionId, mode)) setIdentityMode(mode)
    setOpen(null)
    setShowIdentityHelp(false)
  }

  const toggleIdentityMenu = () => {
    const nextOpen = open === 'identity' ? null : 'identity'
    setOpen(nextOpen)
    setShowIdentityHelp(false)
  }

  const chooseModel = (config: SavedConfig) => {
    saveSettings({
      provider: config.provider,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
    })
    saveModelHistory(config.model)
    setModelLabel(config.name || config.model)
    setOpen(null)
    window.dispatchEvent(new CustomEvent('model-settings-changed'))
  }

  return (
    <div className="chat-companion-controls" ref={rootRef} aria-label="聊天身份与模型">
      <div className="chat-control-slot">
        <button
          type="button"
          className="chat-control-capsule"
          aria-expanded={open === 'identity'}
          onClick={toggleIdentityMenu}
        >
          <span className="chat-control-dot" aria-hidden="true" />
          沉浸感 · {identityDisplayLabel(identityMode)}
        </button>
        {open === 'identity' && (
          <div className="chat-control-menu chat-identity-menu" role="menu">
            <div className="chat-control-menu-head">
              <strong>{showIdentityHelp ? '沉浸感说明' : '选择沉浸感'}</strong>
              <button
                type="button"
                className="chat-control-help-button"
                aria-label={showIdentityHelp ? '返回沉浸感选项' : '查看沉浸感说明'}
                aria-expanded={showIdentityHelp}
                onClick={() => setShowIdentityHelp((value) => !value)}
              >
                {showIdentityHelp ? '‹' : '?'}
              </button>
            </div>

            {showIdentityHelp ? (
              <div className="chat-identity-help" role="note">
                <p>选择 TA 与你相处的方式，不影响记忆、关系和性格。</p>
                {IDENTITY_DETAILS.map((detail) => (
                  <div key={detail.label} className="chat-identity-help-item">
                    <strong>{detail.label}</strong>
                    <span>{detail.text}</span>
                  </div>
                ))}
              </div>
            ) : (
              IDENTITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={option.value === identityMode ? 'is-active' : ''}
                  onClick={() => chooseIdentity(option.value)}
                  role="menuitemradio"
                  aria-checked={option.value === identityMode}
                >
                  <strong>{option.label}</strong>
                  <small>{option.note}</small>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="chat-control-slot chat-model-slot">
        <button
          type="button"
          className="chat-control-capsule chat-model-capsule"
          aria-expanded={open === 'model'}
          onClick={() => {
            setOpen((value) => value === 'model' ? null : 'model')
            setShowIdentityHelp(false)
          }}
        >
          {modelLabel}
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <path d="m5 6 3 3 3-3" />
          </svg>
        </button>
        {open === 'model' && (
          <div className="chat-control-menu chat-model-menu" role="menu">
            {configs.length > 0 ? configs.map((config) => {
              const active = isActiveConfig(loadSettings(), config)
              return (
                <button
                  key={config.id}
                  type="button"
                  className={active ? 'is-active' : ''}
                  onClick={() => chooseModel(config)}
                  role="menuitemradio"
                  aria-checked={active}
                >
                  <strong>{config.name || config.model}</strong>
                  <small>{config.model}</small>
                </button>
              )
            }) : <p className="chat-control-empty">还没有保存的模型配置</p>}
          </div>
        )}
      </div>
    </div>
  )
}
