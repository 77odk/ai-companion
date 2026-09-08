// OpenAI 兼容协议 · 聊天封装（2026-09-09 手术拆分：职责迁往 chatPrompts.ts / modelChat.ts）
// 本文件保留为兼容出口：老 import 路径（'../lib/api'）零改动，全部名字照旧可引，行为不变。
// - chatPrompts.ts：提示词层（聊天规矩/身份/记忆规则/时间/纪念日/认识天数/systemPrompt/质检/busy 提示词）
// - modelChat.ts：模型调用层（ChatError/连接测试/chatCompletion/streamChat SSE/思考延迟）
export * from './chatPrompts.ts'
export * from './modelChat.ts'
