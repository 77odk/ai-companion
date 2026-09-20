import { useEffect, useRef, useState } from 'react'
import { ELUVIN_DATA_CHANGE } from '../lib/dataChange'
import { identityModeLabel, resolveIdentityMode, saveIdentityMode, type IdentityMode } from '../lib/companionPolicy'
import { isActiveConfig, loadSavedConfigs, type SavedConfig } from '../lib/savedConfigs'
import { loadSettings, saveModelHistory, saveSettings } from '../lib/storage'

const IDENTITY_OPTIONS: Array<{ value: IdentityMode; label: string; note: string }> = [
  { value: 'immersive', label: '沉浸', note: 'TA 始终以真人身份相处' },
  { value: 'natural', label: '自然', note: '被问起时自然承认 AI 身份' },
  { value: 'ai', label: 'AI', note: '明确以 AI 身份陪伴' },
]

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

  useEffect(() => {
    const refresh = () => {
      const nextConfigs = loadSavedConfigs()
      setIdentityMode(resolveIdentityMode(sessionId))
      setConfigs(nextConfigs)
      setModelLabel(shortModelLabel(nextConfigs))
    }
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null)
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
          onClick={() => setOpen((value) => value === 'identity' ? null : 'identity')}
        >
          <span className="chat-control-dot" aria-hidden="true" />
          {identityModeLabel(identityMode)}
        </button>
        {open === 'identity' && (
          <div className="chat-control-menu chat-identity-menu" role="menu">
            {IDENTITY_OPTIONS.map((option) => (
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
            ))}
          </div>
        )}
      </div>

      <div className="chat-control-slot chat-model-slot">
        <button
          type="button"
          className="chat-control-capsule chat-model-capsule"
          aria-expanded={open === 'model'}
          onClick={() => setOpen((value) => value === 'model' ? null : 'model')}
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
