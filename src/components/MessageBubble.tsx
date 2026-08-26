import type { StoredMessage } from '../lib/storage'
import { loadAIProfile, loadUserProfile, shouldShowMemorySaved } from '../lib/storage'
import { extractMemories, stripMemoryMarkers } from '../lib/memory'
import { getActiveSessionId } from '../lib/sessionStore'
import DefaultAvatar from './DefaultAvatar'

interface Props {
  message: StoredMessage
  /** 流式输出中且内容为空时显示"正在输入"动画 */
  typing?: boolean
  /** 点 TA 的头像 → 打开聊天头像资料卡（TASK-UI3）；不传时头像不可点 */
  onAvatarClick?: () => void
}

function Avatar({ value, kind, className }: { value: string; kind: 'user' | 'ai'; className: string }) {
  return (
    <span className={`msg-avatar ${className}`} aria-hidden="true">
      {value.startsWith('data:') ? (
        <img src={value} alt="" className="msg-avatar-img" />
      ) : (
        <DefaultAvatar kind={kind} className="avatar-default" />
      )}
    </span>
  )
}

export default function MessageBubble({ message, typing = false, onAvatarClick }: Props) {
  const isUser = message.role === 'user'
  // TA 头像按会话隔离：聊天气泡用当前会话自己的头像；用户头像全局
  const avatar = isUser ? loadUserProfile().avatar : loadAIProfile(getActiveSessionId() || undefined).avatar
  // 展示时把「【记忆】xxx」那行藏起来，不让用户看到标记（原文仍保存在存储里）
  const displayText = isUser ? message.content : stripMemoryMarkers(message.content)
  const hasMemory = !isUser && extractMemories(message.content).length > 0
  // 用户这条消息触发记忆写入时，气泡下方给个「已帮你记下」的反馈
  const showMemorySaved = shouldShowMemorySaved(message)
  return (
    <div className={`message-row ${isUser ? 'row-user' : 'row-assistant'}`}>
      {!isUser &&
        (onAvatarClick ? (
          <button
            type="button"
            className="msg-avatar-btn"
            onClick={onAvatarClick}
            aria-label="打开 TA 的资料卡"
            title="TA 的资料卡"
          >
            <Avatar value={avatar} kind="ai" className="ai-avatar" />
          </button>
        ) : (
          <Avatar value={avatar} kind="ai" className="ai-avatar" />
        ))}
      <div className="message-body">
        <div className={`bubble ${isUser ? 'bubble-user' : 'bubble-assistant'}`}>
          {typing ? (
            <span className="typing" aria-label="正在输入">
              <i />
              <i />
              <i />
            </span>
          ) : (
            <span className="bubble-text">{displayText}</span>
          )}
        </div>
        {hasMemory && <span className="memory-remembered">已记住</span>}
        {showMemorySaved && <span className="memory-saved">✅已帮你记下</span>}
      </div>
      {isUser && <Avatar value={avatar} kind="user" className="user-avatar" />}
    </div>
  )
}
