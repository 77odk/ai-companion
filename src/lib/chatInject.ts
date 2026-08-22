// 工作台「跟 TA 说」→ 聊天页带话：跨页传一条要由 TA 回复的用户消息。
// 用模块级变量暂存：先切页，等 Chat 挂载时取走，避免自定义事件在 Chat 未挂载时丢失。

let pending: string | null = null

/** 存下要带进聊天页的话（工作台入口调用） */
export function queueChatMessage(text: string): void {
  pending = text
}

/** Chat 挂载时取走并清空；没有待带的话返回 null */
export function takeChatMessage(): string | null {
  const t = pending
  pending = null
  return t
}
