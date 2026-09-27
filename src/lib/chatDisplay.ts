// Chat 展示层去重：只处理“相邻、内容完全相同”的 TA 气泡。
// 不修改 StoredMessage、不改上传/合并/上下文/分条顺序；只避免同一句在 UI 连续显示两次。
// 当前持久化没有稳定 batchId，且云端确认会分别改写 split 气泡的 ts；因此不能把“ts 完全相等”当业务规则。
// 正常不同聊天轮次之间有 user 消息隔开，所以“相邻 assistant + 完全同文”是跨刷新仍稳定的最小展示判据。

export interface ChatDisplayMessage {
  role: string
  content: string
}

export function collapseAdjacentDuplicateAssistantReplies<T extends ChatDisplayMessage>(
  messages: readonly T[],
): T[] {
  if (messages.length < 2) return [...messages]

  const visible: T[] = []
  for (const message of messages) {
    const previous = visible[visible.length - 1]
    if (
      previous?.role === 'assistant' &&
      message.role === 'assistant' &&
      previous.content === message.content
    ) {
      continue
    }
    visible.push(message)
  }
  return visible
}
