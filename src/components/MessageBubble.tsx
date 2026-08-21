import type { StoredMessage } from '../lib/storage'
import { loadAIProfile, loadUserProfile } from '../lib/storage'
import { extractMemories, stripMemoryMarkers } from '../lib/memory'
import DefaultAvatar from './DefaultAvatar'

interface Props {
  message: StoredMessage
  /** 流式输出中且内容为空时显示"正在输入"动画 */
  typing?: boolean
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

export default function MessageBubble({ message, typing = false }: Props) {
  const isUser = message.role === 'user'
  const avatar = isUser ? loadUserProfile().avatar : loadAIProfile().avatar
  // 展示时把「【记忆】xxx」那行藏起来，不让用户看到标记（原文仍保存在存储里）
  const displayText = isUser ? message.content : stripMemoryMarkers(message.content)
  const hasMemory = !isUser && extractMemories(message.content).length > 0
  return (
    <div className={`message-row ${isUser ? 'row-user' : 'row-assistant'}`}>
      {!isUser && <Avatar value={avatar} kind="ai" className="ai-avatar" />}
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
      </div>
      {isUser && <Avatar value={avatar} kind="user" className="user-avatar" />}
    </div>
  )
}
