import { useState } from 'react'
import type { StoredMessage } from '../lib/storage'
import { loadAIProfile, loadSettings, loadUserProfile, shouldShowMemorySaved } from '../lib/storage'
import { extractMemories, isPureThinkBlock, stripMemoryMarkers, stripThinkBlocks } from '../lib/memory'
import { getActiveSessionId, getSessionLang } from '../lib/sessionStore'
import { chatBubbleTime } from '../lib/time'
import { chatCompletion } from '../lib/api'
import { detectLang } from '../lib/langDetect'
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
// 内心戏翻译缓存：localStorage key 前缀，按消息 ts 存翻译结果（StoredMessage 无 id，用 ts 作唯一标识）
const THINK_ZH_CACHE_PREFIX = 'ai_companion_thinkzh_'
function getThinkZhCache(ts: number): string | null {
  try {
    return localStorage.getItem(THINK_ZH_CACHE_PREFIX + ts)
  } catch {
    return null
  }
}
function setThinkZhCache(ts: number, text: string): void {
  try {
    localStorage.setItem(THINK_ZH_CACHE_PREFIX + ts, text)
  } catch {
    // 存不下不影响功能
  }
}
// 翻译 prompt：把英文思考链改写成第一人称中文心里话
const THINK_TRANSLATE_PROMPT = `把下面这段 AI 的思考过程改写成第一人称中文心里话，3-5句，150字以内，口语化，去技术味，保留在意对方的点。只输出改写后的中文，不要解释。`
export default function MessageBubble({ message, typing = false, onAvatarClick }: Props) {
  const isUser = message.role === 'user'
  // 模块三·内心戏：思考链展开/收起状态（Hooks 必须在所有条件返回之前调用，防 React Hooks 顺序崩溃）
  const [thinkOpen, setThinkOpen] = useState(false)
  // 懒翻译状态：翻译中/翻译结果
  const [thinkZh, setThinkZh] = useState<string | null>(() => {
    // 组件挂载时先读缓存（用 ts 作 key）
    return getThinkZhCache(message.ts)
  })
  const [thinkTranslating, setThinkTranslating] = useState(false)
  // 模块三：纯思考链消息不渲染气泡（历史泄漏的英文推理段，没 `` 包裹的那种）
  // 注意：必须在 useState 之后再条件返回，否则列表重排时同一位置组件实例 Hooks 调用次数不一致会崩
  if (!isUser && isPureThinkBlock(message.content)) return null
  // TA 头像按会话隔离：聊天气泡用当前会话自己的头像；用户头像全局
  const avatar = isUser ? loadUserProfile().avatar : loadAIProfile(getActiveSessionId() || undefined).avatar
  // 展示时把「【记忆】xxx」那行和思考链「」藏起来，不让用户看到标记（原文仍保存在存储里）
  const displayText = isUser ? message.content : stripThinkBlocks(stripMemoryMarkers(message.content))
  const hasMemory = !isUser && extractMemories(message.content).length > 0
  // 内心戏：TA 消息有 thinking 字段时显示灰条
  const hasThink = !isUser && !!message.thinking && message.thinking.trim().length > 0
  // TASK-ENGLISH-MODE：会话语言决定灰条标签
  const sessionLang = getSessionLang(getActiveSessionId() || undefined)
  const thinkLabel = sessionLang === 'en' ? 'TA was thinking' : 'TA 想了想'
  // 思考链是否需要翻译：中文会话 + thinking 是英文 → 需要懒翻译
  const thinkingRaw = message.thinking ?? ''
  const needThinkTranslate = hasThink && sessionLang === 'zh' && detectLang(thinkingRaw) === 'en'
  // 展示内容：有翻译用翻译，没有用原文（限600字）
  const thinkDisplay = hasThink
    ? thinkZh
      ? thinkZh.length > 600 ? `${thinkZh.slice(0, 600)}…` : thinkZh
      : thinkingRaw.length > 600 ? `${thinkingRaw.slice(0, 600)}…` : thinkingRaw
    : ''
  // 用户这条消息触发记忆写入时，气泡下方给个「已帮你记下」的反馈
  const showMemorySaved = shouldShowMemorySaved(message)
  // 点开灰条时触发懒翻译（仅中文会话+英文思考链）
  const handleThinkToggle = () => {
    const nextOpen = !thinkOpen
    setThinkOpen(nextOpen)
    if (nextOpen && needThinkTranslate && !thinkZh && !thinkTranslating) {
      setThinkTranslating(true)
      const settings = loadSettings()
      if (!settings.apiKey || !settings.baseUrl || !settings.model) {
        // 无 key 降级：显示原文
        setThinkTranslating(false)
        return
      }
      const translateInput = thinkingRaw.slice(0, 2000)
      void chatCompletion(
        settings,
        [
          { role: 'system', content: THINK_TRANSLATE_PROMPT },
          { role: 'user', content: translateInput },
        ],
        { maxTokens: 200, temperature: 0.7 },
      )
        .then((text) => {
          const result = (text ?? '').trim()
          if (result) {
            setThinkZh(result)
            setThinkZhCache(message.ts, result)
          }
        })
        .catch(() => {
          // 翻译失败降级：显示原文（thinkZh 保持 null，显示原文）
        })
        .finally(() => {
          setThinkTranslating(false)
        })
    }
  }
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
        {/* 模块三·内心戏：思考链灰条，默认收起，点开展开 */}
        {hasThink && (
          <div className="think-block">
            <button
              type="button"
              className="think-bar"
              onClick={handleThinkToggle}
              aria-expanded={thinkOpen}
            >
              <span className="think-bar-label">{thinkLabel}</span>
              <span className="think-bar-arrow">{thinkOpen ? '⌃' : '⌄'}</span>
            </button>
            {thinkOpen && (
              <div className="think-content">
                {thinkTranslating ? '翻译中…' : thinkDisplay}
              </div>
            )}
          </div>
        )}
        <div className={`bubble ${isUser ? 'bubble-user' : 'bubble-assistant'}`}>
          {typing ? (
            <span className="typing" aria-label="正在输入">
              <span className="typing-text">正在输入</span>
              <i />
              <i />
              <i />
            </span>
          ) : (
            <span className="bubble-text">{displayText}</span>
          )}
        </div>
        {/* 每条消息都带时间（2026-08-26 七七拍板，AM/PM 微信式） */}
        <span className="msg-bubble-time">{chatBubbleTime(message.ts)}</span>
        {hasMemory && <span className="memory-remembered">已记住</span>}
        {showMemorySaved && <span className="memory-saved">✅已帮你记下</span>}
      </div>
      {isUser && <Avatar value={avatar} kind="user" className="user-avatar" />}
    </div>
  )
}
