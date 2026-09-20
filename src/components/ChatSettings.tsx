import { useEffect, useMemo, useState } from 'react'
import { getAccount } from '../lib/sync'
import { getActiveSessionId, getSessionsCache } from '../lib/sessionStore'
import { displaySessionName } from '../lib/sessionFlow'
import { setSessionStart } from '../lib/storage'
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

  useEffect(() => {
    const refresh = () => {
      setGlobalValue(getGlobalReplyLength(accountId))
      setPreference(getReplyLengthPreference(accountId, sessionId))
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
