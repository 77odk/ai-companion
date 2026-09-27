// Chat 展示层去重：只处理“同一生成批次内，相邻、内容完全相同”的 TA 气泡。
// 不修改 StoredMessage、不改上传/合并/上下文/分条顺序，也不影响跨轮次的正常重复表达。

export interface ChatDisplayMessage {
  role: string
  content: string
  ts: number
}

function isSameAssistantBatch(a: ChatDisplayMessage, b: ChatDisplayMessage): boolean {
  // 当前消息模型用同一 ts 表示同一轮生成批次；这是识别实现，不是长期业务语义。
  // 若未来引入稳定 batchId，只需替换这里，调用方仍按“同一轮次”工作。
  return a.role === 'assistant' && b.role === 'assistant' && a.ts === b.ts
}

export function collapseAdjacentDuplicateAssistantReplies<T extends ChatDisplayMessage>(
  messages: readonly T[],
): T[] {
  if (messages.length < 2) return [...messages]

  const visible: T[] = []
  for (const message of messages) {
    const previous = visible[visible.length - 1]
    if (
      previous &&
      isSameAssistantBatch(previous, message) &&
      previous.content === message.content
    ) {
      continue
    }
    visible.push(message)
  }
  return visible
}
