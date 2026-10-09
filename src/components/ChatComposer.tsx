// 聊天页 · 输入区面板（C 级拆分第 4 刀）
// 搬走：引用草稿条、输入框与发送/停止、动作旁白按钮、思考链提示、伴侣控制条、上下文用量胶囊（含浮层与详情）、上下文提示条。
// 状态仍由 Chat.tsx 持有，这里只通过 props 使用；本文件不新增任何副作用。
import type { Dispatch, RefObject, SetStateAction } from 'react'
import ChatCompanionControls from './ChatCompanionControls'
import { getContextBridge, type ContextUsageState, type StoredMessage } from '../lib/storage'
import type { MessageQuote } from '../lib/messageQuote'
import type { Lang } from '../lib/langDetect'

// 供 Chat.tsx 的 send 流程共用（承接按钮的可用性判断）
export function hasBridgableHistory(messages: StoredMessage[], sessionStart: number): boolean {
  return sessionStart > 0 && messages.some((message) => message.ts < sessionStart)
}

function formatTokenCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—'
  if (value < 1000) return String(Math.round(value))
  const compact = value >= 10000 ? (value / 1000).toFixed(0) : (value / 1000).toFixed(1)
  return `${compact.replace(/\.0$/, '')}k`
}

const SendArrowIcon = () => (  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.1"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4.5 16.2c3.2 2.4 6.8 1.9 9.3-.6 2.5-2.5 3.6-5.8 5.7-9.7" />
    <path d="M13.1 7.1l6.4-1.2-1.3 6.2" />
  </svg>
)

interface ChatComposerProps {
  chatUiLang: Lang
  input: string
  setInput: Dispatch<SetStateAction<string>>
  inputRef: RefObject<HTMLTextAreaElement>
  quoteDraft: MessageQuote | null
  setQuoteDraft: Dispatch<SetStateAction<MessageQuote | null>>
  handleSend: () => void
  handleStop: () => void
  streaming: boolean
  isBusy: boolean
  actionNarrationEnabled: boolean
  insertActionNarration: () => void
  activeSessionId: string | null
  contextMeterRef: RefObject<HTMLDivElement>
  contextMeter: ContextUsageState | null
  contextMenuOpen: boolean
  setContextMenuOpen: Dispatch<SetStateAction<boolean>>
  contextDetailOpen: boolean
  setContextDetailOpen: Dispatch<SetStateAction<boolean>>
  contextBusy: 'compact' | 'bridge' | null
  compactDone: boolean
  bridgeInfo: ReturnType<typeof getContextBridge>
  activeMessages: StoredMessage[]
  sessionStart: number
  handleCompact: () => void
  handleBridge: () => void
  contextNotice: string | null
  thinkingUnsupported: boolean
}

export default function ChatComposer(props: ChatComposerProps) {
  const {
    chatUiLang, input, setInput, inputRef, quoteDraft, setQuoteDraft, handleSend, handleStop,
    streaming, isBusy, actionNarrationEnabled, insertActionNarration, activeSessionId,
    contextMeterRef, contextMeter, contextMenuOpen, setContextMenuOpen, contextDetailOpen,
    setContextDetailOpen, contextBusy, compactDone, bridgeInfo, activeMessages, sessionStart,
    handleCompact, handleBridge, contextNotice, thinkingUnsupported,
  } = props
  return (
<div className="chat-composer-panel">
  {quoteDraft && (
    <div className="chat-quote-draft">
      <div className="chat-quote-draft-text">
        <strong>
          {chatUiLang === 'en'
            ? `Quoting ${quoteDraft.speaker === 'assistant' ? 'TA' : 'me'}`
            : `引用${quoteDraft.speaker === 'assistant' ? ' TA' : '我'}`}
        </strong>
        <span>{quoteDraft.text.replace(/\s+/g, ' ').slice(0, 120)}</span>
      </div>
      <button
        type="button"
        onClick={() => setQuoteDraft(null)}
        aria-label={chatUiLang === 'en' ? 'Remove quote' : '取消引用'}
        title={chatUiLang === 'en' ? 'Remove quote' : '取消引用'}
      >
        ×
      </button>
    </div>
  )}
  <div className="composer">
    <textarea
      ref={inputRef}
      className="composer-input"
      rows={1}
      placeholder={isBusy ? 'TA 正在忙，消息会稍后回复' : '说点什么…'}
      value={input}
      onChange={(e) => setInput(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault()
          handleSend()
        }
      }}
    />
    {actionNarrationEnabled && (
      <button
        type="button"
        className="btn-action-narration"
        onPointerDown={(event) => event.preventDefault()}
        onClick={insertActionNarration}
        disabled={streaming}
        aria-label="插入动作或旁白括号"
        title="动作与旁白"
      >
        （）
      </button>
    )}
    {streaming ? (
      <button className="btn btn-stop" onClick={handleStop}>
        停止
      </button>
    ) : (
      <button
        type="button"
        className="btn btn-send"
        onPointerDown={(e) => e.preventDefault()}
        onClick={handleSend}
        disabled={!input.trim()}
        aria-label="发送"
        title="发送"
      >
        <SendArrowIcon />
      </button>
    )}
  </div>

  {thinkingUnsupported && <p className="chat-thinking-hint">该模型不支持思考链</p>}

  {activeSessionId && (
    <div className="chat-inline-controls">
      <ChatCompanionControls sessionId={activeSessionId} />
      <div
        className="context-meter-slot"
        ref={contextMeterRef}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setContextMenuOpen(false)
        }}
      >
        <button
          type="button"
          className="context-meter-circle"
          aria-label={contextMeter
            ? `上下文占用 ${Math.round((contextMeter.used / contextMeter.budget) * 100)}%`
            : '查看上下文用量'}
          aria-expanded={contextMenuOpen}
          onClick={() => setContextMenuOpen((value) => !value)}
        >
          <span
            className="context-meter-ring"
            data-level={contextMeter
              ? contextMeter.used >= contextMeter.budget
                ? 'over'
                : contextMeter.used >= contextMeter.budget * 0.85
                  ? 'high'
                  : contextMeter.used >= contextMeter.budget * 0.7
                    ? 'warn'
                    : 'normal'
              : 'idle'}
            style={{
              background: contextMeter
                ? `conic-gradient(var(--context-meter-accent) ${Math.min(100, Math.max(0, Math.round((contextMeter.used / contextMeter.budget) * 100)))}%, var(--ui2-hairline, rgba(51, 43, 40, 0.1)) 0)`
                : undefined,
            }}
          >
            <span className="context-meter-value">
              {contextMeter ? `${Math.min(100, Math.max(0, Math.round((contextMeter.used / contextMeter.budget) * 100)))}%` : '—'}
            </span>
          </span>
        </button>

        {contextMenuOpen && (
          <div className="context-meter-popover">
            <div className="context-meter-summary">
              <strong>{contextMeter ? `上下文 ${Math.round((contextMeter.used / contextMeter.budget) * 100)}%` : '还没有数据'}</strong>
              {contextMeter && (
                <span className="context-meter-source">
                  {contextMeter.source === 'actual' ? '本轮真实' : '本轮估算'}
                </span>
              )}
            </div>
            {contextMeter ? (
              <div className="context-meter-stats">
                <span>上下文总量</span><strong>{formatTokenCount(contextMeter.used)} / {formatTokenCount(contextMeter.budget)}</strong>
                <span>本轮输入</span><strong>{formatTokenCount(contextMeter.inputTokens)}</strong>
                <span>本轮输出</span><strong>{contextMeter.outputTokens == null ? '—' : formatTokenCount(contextMeter.outputTokens)}</strong>
                <span>Cache 命中</span><strong>{contextMeter.cachedTokens == null ? '—' : formatTokenCount(contextMeter.cachedTokens)}</strong>
              </div>
            ) : (
              <p>发送一条消息后显示。</p>
            )}
            {contextMeter && (
              <p>{contextMeter.source === 'actual'
                ? '上下文总量 = 刷新之后这一段的内容量（已用服务商 usage 校准）；本轮输入 / 输出 / Cache 来自最近一轮的服务商 usage。'
                : '上下文总量 = 刷新之后这一段的内容量（本地估算）；服务商没返回 usage，本轮明细按本地估算。'}</p>
            )}
            <div className="context-meter-actions">
              {!compactDone && (
                <button
                  type="button"
                  onClick={() => {
                    setContextMenuOpen(false)
                    void handleCompact()
                  }}
                  disabled={contextBusy !== null}
                >
                  {contextBusy === 'compact' ? '整理中…' : '整理'}
                </button>
              )}
              {!bridgeInfo && hasBridgableHistory(activeMessages, sessionStart) && (
                <button
                  type="button"
                  onClick={() => {
                    setContextMenuOpen(false)
                    void handleBridge()
                  }}
                  disabled={contextBusy !== null}
                >
                  {contextBusy === 'bridge' ? '承接中…' : '承接'}
                </button>
              )}
            </div>
            <div className="context-meter-footer">
              <button
                type="button"
                className="context-meter-detail-toggle"
                aria-expanded={contextDetailOpen}
                onClick={() => setContextDetailOpen((value) => !value)}
              >
                详情
              </button>
            </div>
            {contextDetailOpen && (
              <div className="context-meter-detail">
                <p>
                  <strong>上下文总量</strong>
                  ：刷新对话之后这一段的内容量，聊一句涨一点，只增不减；刷新或整理之后重新起算。本轮输入 / 输出 / Cache 是服务商返回的这一次用量。
                </p>
                <p>
                  <strong>承接</strong>
                  ：刷新之后想让 TA 还记得上一段，就点它。TA 会读一遍上一段最后约 30 条里的重点，临时挂在对话里，大约 8 轮后自动退场；上一段的记录不会被搬进来，也不会被删。
                </p>
                <p>
                  <strong>整理</strong>
                  ：这一段聊得太长时点它，较早的对话会被压成一段话，最近 12 条保留原文。聊天记录一条不少，只是发给 TA 的形式变了。
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )}

  {contextNotice && (
    <div className="context-notice" role="status">{contextNotice}</div>
  )}
</div>
  )
}
