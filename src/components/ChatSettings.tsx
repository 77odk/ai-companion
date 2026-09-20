import { useState } from 'react'
import { getAccount } from '../lib/sync'
import { getActiveSessionId, getSessionsCache } from '../lib/sessionStore'
import { displaySessionName } from '../lib/sessionFlow'
import { setSessionStart } from '../lib/storage'
import { notifyDataChanged } from '../lib/dataChange'
import {
  clearReplyLengthOverride,
  getGlobalReplyLength,
  getReplyLengthOverride,
  replyLengthLabel,
  saveReplyLengthOverride,
  type ReplyLength,
} from '../lib/replyLength'

interface Props {
  onBack: () => void
  onRefreshed: () => void
}

type LocalChoice = 'global' | ReplyLength

export default function ChatSettings({ onBack, onRefreshed }: Props) {
  const accountId = getAccount()?.account ?? ''
  const sessionId = getActiveSessionId()
  const session = getSessionsCache().find((item) => String(item.id) === sessionId)
  const taName = session ? displaySessionName(session) : '当前 TA'
  const globalValue = getGlobalReplyLength(accountId)
  const [choice, setChoice] = useState<LocalChoice>(() => getReplyLengthOverride(accountId, sessionId) ?? 'global')
  const [error, setError] = useState('')
  const [confirmRefresh, setConfirmRefresh] = useState(false)

  const choose = (next: LocalChoice) => {
    if (!accountId || !sessionId) return
    if (next === 'global') {
      clearReplyLengthOverride(accountId, sessionId)
      setChoice('global')
      setError('')
      return
    }
    if (!saveReplyLengthOverride(accountId, sessionId, next)) {
      setError('没有保存成功，稍后再试一下')
      return
    }
    setChoice(next)
    setError('')
  }

  const refreshConversation = () => {
    if (!sessionId) return
    setSessionStart(Date.now(), sessionId)
    notifyDataChanged()
    setConfirmRefresh(false)
    onRefreshed()
  }

  const options: Array<{ value: LocalChoice; title: string; note: string }> = [
    { value: 'global', title: '跟随全局', note: `现在是「${replyLengthLabel(globalValue)}」` },
    { value: 'natural', title: '自然', note: '不加任何限制，让 TA 自己说' },
    { value: 'short', title: '短', note: '简短自然，几句话说完' },
    { value: 'medium', title: '中', note: '不多不少，日常聊天的量' },
    { value: 'long', title: '长', note: '可以多说一点，按话题自然展开' },
  ]

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
          <p>这里只影响 {taName}。选「跟随全局」时，会自动使用「我的 → 关于 TA → 回复长度」里的设置。</p>
        </div>
        <div className="reply-length-options" role="radiogroup" aria-label={`${taName} 的回复长度`}>
          {options.map((option) => {
            const selected = choice === option.value
            return (
              <button
                key={option.value}
                type="button"
                className={`reply-length-option${selected ? ' is-selected' : ''}`}
                role="radio"
                aria-checked={selected}
                onClick={() => choose(option.value)}
              >
                <span className="reply-length-option-copy">
                  <strong>{option.title}</strong>
                  <span>{option.note}</span>
                </span>
                <span className="reply-length-radio" aria-hidden="true">
                  {selected ? <span /> : null}
                </span>
              </button>
            )
          })}
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
