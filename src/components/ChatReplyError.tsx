// 聊天页 · 回复失败与限流兜底（C 级拆分第 2 刀）
// 本文件只做展示：错误条、只重试 TA、限流时切到豆包 / 去配置的兜底卡。
// 状态与回调全部由 Chat.tsx 通过 props 传入，本文件不含 hooks 与副作用。
import type { Lang } from '../lib/langDetect'

function isRateLimitError(message: string): boolean {
  return message.includes('429') || message.includes('太频繁') || message.includes('访问量过大')
}

interface ChatReplyErrorProps {
  error: string | null
  failedReplyRetryAvailable: boolean
  onRetryFailedReply: () => void
  streaming: boolean
  lang: Lang
  hasDoubao: boolean
  onSwitchToDoubao: () => void
  onGoSettings: () => void
}

export function RateLimitFallback({
  hasDoubao,
  onSwitch,
  onGoSettings,
}: {
  hasDoubao: boolean
  onSwitch: () => void
  onGoSettings: () => void
}) {
  if (hasDoubao) {
    return (
      <div className="rate-fallback">
        <span className="rate-fallback-text">智谱现在太挤了，切到豆包不排队。</span>
        <button type="button" className="rate-fallback-btn" onClick={onSwitch}>
          切到豆包
        </button>
      </div>
    )
  }
  return (
    <div className="rate-fallback">
      <span className="rate-fallback-text">智谱现在太挤了，去配个豆包（免费）不排队。</span>
      <button type="button" className="rate-fallback-btn" onClick={onGoSettings}>
        去配置豆包
      </button>
    </div>
  )
}

export default function ChatReplyError({
  error,
  failedReplyRetryAvailable,
  onRetryFailedReply,
  streaming,
  lang,
  hasDoubao,
  onSwitchToDoubao,
  onGoSettings,
}: ChatReplyErrorProps) {
  if (!error) return null
  return (
    <div className="chat-error-wrap">
      <div className="chat-error">
        {failedReplyRetryAvailable
          ? (lang === 'en' ? 'That reply was interrupted. You can retry TA only.' : 'TA 刚才的回复中断了，可以只重试 TA。')
          : error}
      </div>
      {failedReplyRetryAvailable && (
        <button
          type="button"
          className="btn btn-ghost"
          disabled={streaming}
          onClick={onRetryFailedReply}
        >
          {lang === 'en' ? 'Retry TA only' : '只重试 TA'}
        </button>
      )}
      {isRateLimitError(error) && (
        <RateLimitFallback
          hasDoubao={hasDoubao}
          onSwitch={onSwitchToDoubao}
          onGoSettings={onGoSettings}
        />
      )}
    </div>
  )
}
