import type { StoredMessage } from '../lib/storage'
import { loadAIProfile, loadUserProfile } from '../lib/storage'

interface Props {
  message: StoredMessage
  /** 流式输出中且内容为空时显示"正在输入"动画 */
  typing?: boolean
}

export default function MessageBubble({ message, typing = false }: Props) {
  const isUser = message.role === 'user'
  const avatar = isUser ? loadUserProfile().avatar : loadAIProfile().avatar
  return (
    <div className={`message-row ${isUser ? 'row-user' : 'row-assistant'}`}>
      {!isUser && (
        <span className="msg-avatar ai-avatar" aria-hidden="true">
          {avatar}
        </span>
      )}
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
      {isUser && (
        <span className="msg-avatar user-avatar" aria-hidden="true">
          {avatar}
        </span>
      )}
    </div>
  )
}
