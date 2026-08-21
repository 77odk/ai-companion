import type { StoredMessage } from '../lib/storage'
import { loadAIProfile, loadUserProfile } from '../lib/storage'

interface Props {
  message: StoredMessage
  /** 流式输出中且内容为空时显示"正在输入"动画 */
  typing?: boolean
  /** 点头像触发（如进 AI 空间） */
  onAvatarClick?: () => void
}

function Avatar({ value, className, onClick }: { value: string; className: string; onClick?: () => void }) {
  const inner = value.startsWith('data:') ? (
    <img src={value} alt="" className="msg-avatar-img" />
  ) : (
    <span>{value}</span>
  )
  return onClick ? (
    <button type="button" className={`msg-avatar ${className} msg-avatar-btn`} onClick={onClick} aria-label="打开 TA 的空间">
      {inner}
    </button>
  ) : (
    <span className={`msg-avatar ${className}`} aria-hidden="true">
      {inner}
    </span>
  )
}

export default function MessageBubble({ message, typing = false, onAvatarClick }: Props) {
  const isUser = message.role === 'user'
  const avatar = isUser ? loadUserProfile().avatar : loadAIProfile().avatar
  return (
    <div className={`message-row ${isUser ? 'row-user' : 'row-assistant'}`}>
      {!isUser && <Avatar value={avatar} className="ai-avatar" onClick={onAvatarClick} />}
      <div className={`bubble ${isUser ? 'bubble-user' : 'bubble-assistant'}`}>
        {typing ? (
          <span className="typing" aria-label="正在输入">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <span className="bubble-text">{message.content}</span>
        )}
      </div>
      {isUser && <Avatar value={avatar} className="user-avatar" />}
    </div>
  )
}
