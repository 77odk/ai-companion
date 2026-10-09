// 聊天页 · 状态提示条（C 级拆分第 1 刀）
// 本文件只做展示：跳转提示、分支操作提示、回复中断恢复提示。
// 所有状态与回调由 Chat.tsx 通过 props 传入，本文件不含任何 hooks 与副作用。
import type { Lang } from '../lib/langDetect'
import type { RecoverableReply } from '../lib/replyLifecycle'

interface Props {
  /** 顶部跳转提示（如“已跳到第 N 条”），由 App 层传入 */
  jumpNotice?: string | null
  /** 分支操作提示（撤销提示） */
  branchActionNotice: { branchId: string; previousBranchId: string; text: string } | null
  onUndoBranchAction: () => void
  /** 是否展示“回复中断”恢复条 */
  showReplyRecovery: boolean
  recoverableReply: RecoverableReply | null
  onContinue: () => void
  onRetryInterruptedReply: () => void
  streaming: boolean
  contextBusy: 'compact' | 'bridge' | null
  isBusy: boolean
  lang: Lang
}

export default function ChatNotices({
  jumpNotice,
  branchActionNotice,
  onUndoBranchAction,
  showReplyRecovery,
  recoverableReply,
  onContinue,
  onRetryInterruptedReply,
  streaming,
  contextBusy,
  isBusy,
  lang,
}: Props) {
  return (
    <>
      {jumpNotice && (
        <div className="chat-jump-notice" role="status">{jumpNotice}</div>
      )}

      {branchActionNotice && (
        <div className="chat-branch-action-notice" role="status">
          <span>{branchActionNotice.text}</span>
          <button type="button" onClick={onUndoBranchAction} disabled={streaming}>{lang === 'en' ? 'Undo' : '撤销'}</button>
        </div>
      )}

      {showReplyRecovery && recoverableReply && (
        <div className="chat-reply-recovery" role="status">
          <span>
            {lang === 'en'
              ? 'That reply was interrupted. Any part already received is kept.'
              : '刚才的回复中断了，已经收到的部分会保留。'}
          </span>
          <div className="chat-reply-recovery-actions">
            <button type="button" onClick={onContinue}>
              {lang === 'en' ? 'Continue' : '继续'}
            </button>
            <button type="button" onClick={onRetryInterruptedReply} disabled={streaming || Boolean(contextBusy) || isBusy}>
              {lang === 'en' ? 'Retry TA only' : '只重试 TA'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
