// 聊天页 · 记忆纠正确认卡（C 级拆分第 3 刀）
// 本文件只做展示：TA 提出纠正记忆时的确认卡，以及纠正结果提示条。
// 状态与回调全部由 Chat.tsx 通过 props 传入，本文件不含 hooks 与副作用。
import type { MemoryCorrectionTarget } from '../lib/memoryCorrection'

interface ChatMemoryCorrectionProps {
  pending: { target: MemoryCorrectionTarget; value: string } | null
  busy: boolean
  notice: string | null
  onReject: () => void
  onConfirm: () => void
}

export default function ChatMemoryCorrection({ pending, busy, notice, onReject, onConfirm }: ChatMemoryCorrectionProps) {
  return (
    <>
      {pending && (
        <div className="memory-correction-consent" role="group" aria-label="确认纠正记忆">
          <div className="memory-correction-consent-title">TA 想纠正一条记忆</div>
          <div className="memory-correction-consent-row">
            <span>原来记的是</span>
            <strong>{pending.target.item.text}</strong>
          </div>
          <div className="memory-correction-consent-row">
            <span>准备改成</span>
            <strong>{pending.value}</strong>
          </div>
          <div className="memory-correction-consent-actions">
            <button type="button" onClick={onReject} disabled={busy}>先不改</button>
            <button type="button" onClick={onConfirm} disabled={busy}>
              {busy ? '正在纠正…' : '确认纠正'}
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div className="memory-correction-notice" role="status">{notice}</div>
      )}
    </>
  )
}
