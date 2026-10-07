import { useEffect, useMemo, useState } from 'react'
import { getAccount } from '../lib/sync'
import { getActiveSessionId, getSessionsCache } from '../lib/sessionStore'
import { displaySessionName } from '../lib/sessionFlow'
import { getInitiativePreference, saveInitiativePreference, setSessionStart } from '../lib/storage'
import { ELUVIN_DATA_CHANGE, notifyDataChanged } from '../lib/dataChange'
import {
  getGlobalReplyLength,
  getReplyLengthPreference,
  replyLengthLabel,
  saveReplyLengthFollowGlobal,
  saveReplyLengthMode,
  type ReplyLength,
  type ReplyLengthPreference,
} from '../lib/replyLength'

interface Props {
  onBack: () => void
  onRefreshed: () => void
}

const LENGTH_OPTIONS: Array<{ value: ReplyLength; label: string }> = [
  { value: 'natural', label: '自然' },
  { value: 'short', label: '简洁' },
  { value: 'medium', label: '适中' },
  { value: 'long', label: '详细' },
]

export default function ChatSettings({ onBack, onRefreshed }: Props) {
  const accountId = getAccount()?.account ?? ''
  const sessionId = getActiveSessionId()
  const session = getSessionsCache().find((item) => String(item.id) === sessionId)
  const taName = session ? displaySessionName(session) : '当前 TA'
  const [globalValue, setGlobalValue] = useState<ReplyLength>(() => getGlobalReplyLength(accountId))
  const [preference, setPreference] = useState<ReplyLengthPreference>(() => getReplyLengthPreference(accountId, sessionId))
  const [error, setError] = useState('')
  const [confirmRefresh, setConfirmRefresh] = useState(false)
  const [initiativePreference, setInitiativePreference] = useState(() => getInitiativePreference(accountId, sessionId))
  const initiativeEnabled = initiativePreference.enabled
  const [confirmInitiative, setConfirmInitiative] = useState(false)

  useEffect(() => {
    const refresh = () => {
      setGlobalValue(getGlobalReplyLength(accountId))
      setPreference(getReplyLengthPreference(accountId, sessionId))
      setInitiativePreference(getInitiativePreference(accountId, sessionId))
    }
    window.addEventListener(ELUVIN_DATA_CHANGE, refresh)
    return () => window.removeEventListener(ELUVIN_DATA_CHANGE, refresh)
  }, [accountId, sessionId])

  const selectedIndex = useMemo(
    () => Math.max(0, LENGTH_OPTIONS.findIndex((option) => option.value === preference.mode)),
    [preference.mode],
  )

  const toggleGlobal = () => {
    if (!accountId || !sessionId) return
    const next = !preference.followGlobal
    if (!saveReplyLengthFollowGlobal(accountId, sessionId, next)) {
      setError('没有保存成功，稍后再试一下')
      return
    }
    setPreference((current) => ({ ...current, followGlobal: next }))
    setError('')
  }

  const chooseIndex = (index: number) => {
    if (!accountId || !sessionId || preference.followGlobal) return
    const option = LENGTH_OPTIONS[index]
    if (!option || option.value === preference.mode) return
    if (!saveReplyLengthMode(accountId, sessionId, option.value)) {
      setError('没有保存成功，稍后再试一下')
      return
    }
    setPreference((current) => ({ ...current, mode: option.value }))
    setError('')
  }

  const toggleInitiative = () => {
    if (!sessionId) return
    if (!initiativeEnabled) {
      setConfirmInitiative(true)
      return
    }
    if (!saveInitiativePreference(accountId, sessionId, { enabled: false, lastBackgroundAt: 0 })) {
      setError('没有保存成功，稍后再试一下')
      return
    }
    setInitiativePreference(getInitiativePreference(accountId, sessionId))
    setConfirmInitiative(false)
    setError('')
  }

  const enableInitiative = () => {
    if (!sessionId) return
    if (!saveInitiativePreference(accountId, sessionId, { enabled: true, lastBackgroundAt: 0 })) {
      setError('没有保存成功，稍后再试一下')
      return
    }
    setInitiativePreference(getInitiativePreference(accountId, sessionId))
    setConfirmInitiative(false)
    setError('')
  }

  const updateInitiativePreference = (patch: Partial<typeof initiativePreference>) => {
    if (!accountId || !sessionId) return
    if (!saveInitiativePreference(accountId, sessionId, patch)) {
      setError('没有保存成功，稍后再试一下')
      return
    }
    setInitiativePreference(getInitiativePreference(accountId, sessionId))
    setError('')
  }

  const hourOptions = Array.from({ length: 24 }, (_, hour) => ({
    value: hour,
    label: `${String(hour).padStart(2, '0')}:00`,
  }))

  const refreshConversation = () => {
    if (!sessionId) return
    setSessionStart(Date.now(), sessionId)
    notifyDataChanged()
    setConfirmRefresh(false)
    onRefreshed()
  }

  return (
    <div className="page chat-settings-page">
      <div className="detail-header chat-settings-header">
        <button type="button" className="detail-back detail-back-text" onClick={onBack} aria-label="返回">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span>返回</span>
        </button>
        <h1 className="detail-title">聊天设置</h1>
        <span className="detail-spacer" aria-hidden="true" />
      </div>

      <section className="chat-settings-section">
        <div className="chat-settings-section-head">
          <h2>回复长度</h2>
        </div>

        <div className="chat-settings-card chat-reply-card">
          <div className="chat-follow-row">
            <div className="chat-follow-copy">
              <strong>跟随全局</strong>
              <small>当前全局：{replyLengthLabel(globalValue)} · 开启将覆盖已选</small>
            </div>
            <button
              type="button"
              className={`chat-follow-switch${preference.followGlobal ? ' is-on' : ''}`}
              role="switch"
              aria-checked={preference.followGlobal}
              aria-label={`跟随全局，当前${preference.followGlobal ? '已开启' : '已关闭'}`}
              onClick={toggleGlobal}
            >
              <span aria-hidden="true" />
            </button>
          </div>

          <div
            className={`chat-length-control is-index-${selectedIndex}${preference.followGlobal ? ' is-locked' : ''}`}
            aria-disabled={preference.followGlobal}
          >
            <div className="chat-length-control-head">
              <span>当前 TA</span>
              <strong>{replyLengthLabel(preference.mode)}</strong>
            </div>

            <div className="chat-length-slider">
              <div className="chat-length-rail" aria-hidden="true">
                <span className="chat-length-fill" />
                {LENGTH_OPTIONS.map((option, index) => (
                  <span
                    key={option.value}
                    className={`chat-length-dot${index === selectedIndex ? ' is-selected' : ''}`}
                  />
                ))}
              </div>
              <input
                className="chat-length-range"
                type="range"
                min="0"
                max={String(LENGTH_OPTIONS.length - 1)}
                step="1"
                value={selectedIndex}
                disabled={preference.followGlobal}
                aria-label={`${taName} 的回复长度`}
                aria-valuetext={replyLengthLabel(preference.mode)}
                onChange={(event) => chooseIndex(Number(event.target.value))}
              />
            </div>

            <div className="chat-length-labels" aria-hidden="true">
              {LENGTH_OPTIONS.map((option) => (
                <span key={option.value}>{option.label}</span>
              ))}
            </div>
          </div>
        </div>

        {error ? <p className="reply-length-error" role="status">{error}</p> : null}
      </section>

      <section className="chat-settings-section">
        <div className="chat-settings-section-head">
          <h2>主动消息</h2>
          <p>只有有真实理由时，TA 才会主动找你。</p>
        </div>
        <div className="chat-settings-card">
          <div className="chat-follow-row">
            <div className="chat-follow-copy">
              <strong>让 TA 主动找你</strong>
              <small>{initiativeEnabled ? `每天最多 ${initiativePreference.dailyLimit} 次 · ${String(initiativePreference.quietStartHour).padStart(2, '0')}:00–${String(initiativePreference.quietEndHour).padStart(2, '0')}:00 不打扰` : '默认关闭 · 只在有真实理由时开口'}</small>
            </div>
            <button
              type="button"
              className={`chat-follow-switch${initiativeEnabled ? ' is-on' : ''}`}
              role="switch"
              aria-checked={initiativeEnabled}
              aria-label={`主动消息，当前${initiativeEnabled ? '已开启' : '已关闭'}`}
              onClick={toggleInitiative}
            >
              <span aria-hidden="true" />
            </button>
          </div>
          {initiativeEnabled ? (
            <div className="initiative-message-preferences">
              <label>
                <span>频率</span>
                <select
                  className="input"
                  value={initiativePreference.dailyLimit}
                  onChange={(event) => updateInitiativePreference({ dailyLimit: Number(event.target.value) })}
                >
                  <option value={1}>少一点 · 每天最多 1 次</option>
                  <option value={2}>适中 · 每天最多 2 次</option>
                  <option value={3}>多一点 · 每天最多 3 次</option>
                  <option value={4}>常一点 · 每天最多 4 次</option>
                  <option value={5}>最多 · 每天最多 5 次</option>
                </select>
              </label>
              <div className="initiative-quiet-setting">
                <span>静默时段</span>
                <div>
                  <select
                    className="input"
                    value={initiativePreference.quietStartHour}
                    onChange={(event) => updateInitiativePreference({ quietStartHour: Number(event.target.value) })}
                    aria-label="静默开始时间"
                  >
                    {hourOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <span aria-hidden="true">—</span>
                  <select
                    className="input"
                    value={initiativePreference.quietEndHour}
                    onChange={(event) => updateInitiativePreference({ quietEndHour: Number(event.target.value) })}
                    aria-label="静默结束时间"
                  >
                    {hourOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
              </div>
              <p className="initiative-message-hint">如果你没有回应，下一次主动消息会自动隔得更久。</p>
            </div>
          ) : null}
          {confirmInitiative ? (
            <div className="chat-settings-refresh-confirm">
              <p>
                开启后，只有未完约定、真实事件、重要日子等有依据的情况才会触发。
                你回到忆文时，最多用当前设备上的模型 Key 做一次短生成；Key 不上传服务器。无理由时不会调用模型。
              </p>
              <div className="chat-settings-refresh-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmInitiative(false)}>先不开</button>
                <button type="button" className="btn btn-primary" onClick={enableInitiative}>确认开启</button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="chat-settings-section">
        <div className="chat-settings-section-head">
          <h2>会话</h2>
          <p>重新开始当前聊天上下文，不删除历史记录。</p>
        </div>
        <div className="chat-settings-card">
          <button
            type="button"
            className="chat-settings-row chat-settings-refresh"
            onClick={() => setConfirmRefresh((value) => !value)}
            aria-expanded={confirmRefresh}
          >
            <span>
              <strong>刷新对话</strong>
              <small>TA 会从新的一页开始，旧聊天仍可在聊天记录里查看</small>
            </span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 11a8 8 0 1 0-2.3 5.7" />
              <path d="M20 5v6h-6" />
            </svg>
          </button>
          {confirmRefresh ? (
            <div className="chat-settings-refresh-confirm">
              <p>确定刷新和 {taName} 的当前对话吗？聊天记录不会删除。</p>
              <div className="chat-settings-refresh-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmRefresh(false)}>再想想</button>
                <button type="button" className="btn btn-primary" onClick={refreshConversation}>确认刷新</button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
