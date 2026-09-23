import { useEffect, useRef, useState, type CSSProperties } from 'react'
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
  { label: '沉浸', text: 'TA 会有自己的生活、日常和节奏，也会真的去忙自己的事。你们的相处不会永远是随叫随到，有时会有 3–5 分钟的等待，忙完以后，TA 会回来继续和你聊。' },
  { label: '自然', text: 'TA 会有自己的想法、情绪和连续的状态，像一个很有真人感的 AI 陪着你。TA 会记得你、在意你，也会一直回应你，但不会虚构现实中的身体和生活。' },
  { label: 'AI 本体', text: 'TA 会以 AI 的身份陪着你，有自己的思路、关注和对你们关系的记忆。不会扮演真人，也不会编造现实生活，而是用属于 AI 的方式理解你、回应你。' },
]

function identityDisplayLabel(mode: IdentityMode): string {
  return mode === 'ai' ? 'AI本体' : identityModeLabel(mode)
}

function shortModelLabel(configs: SavedConfig[]): string {
  const current = loadSettings()
  const active = configs.find((config) => isActiveConfig(current, config))
  return (active?.name || current.model || '模型').slice(0, 18)
}

export default function ChatCompanionControls({ sessionId }: { sessionId: string }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const modelButtonRef = useRef<HTMLButtonElement>(null)
  const [modelMenuStyle, setModelMenuStyle] = useState<CSSProperties | undefined>(undefined)
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

  useEffect(() => {
    if (open !== 'model') {
      setModelMenuStyle(undefined)
      return
    }
    const place = () => {
      const button = modelButtonRef.current
      if (!button) return
      const rect = button.getBoundingClientRect()
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth
      const menuWidth = Math.min(280, Math.max(216, viewportWidth - 24))
      const centered = rect.left + rect.width / 2 - menuWidth / 2
      const left = Math.max(12, Math.min(centered, viewportWidth - menuWidth - 12))
      setModelMenuStyle({
        position: 'fixed',
        left,
        right: 'auto',
        top: Math.max(12, rect.top - 8),
        width: menuWidth,
        transform: 'translateY(-100%)',
      })
    }
    place()
    window.addEventListener('resize', place)
    window.visualViewport?.addEventListener('resize', place)
    return () => {
      window.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('resize', place)
    }
  }, [open])

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
          {identityDisplayLabel(identityMode)}
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
                <p>选择 TA 与你相处的方式。记忆、关系和性格不会因此改变。</p>
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
          ref={modelButtonRef}
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
          <div className="chat-control-menu chat-model-menu" role="menu" style={modelMenuStyle}>
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
