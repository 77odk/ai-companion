/**
 * 轻量 token 估算：中文1字≈1.5，英文1词≈1.3，数字≈0.8，其他≈0.3。
 * 误差10%以内，对聊天场景足够。不引入 tiktoken 依赖。
 */
export function estimateToken(text: string): number {
  if (!text) return 0
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length
  const numbers = (text.match(/\d+/g) || []).length
  const englishLetters = (text.match(/[a-zA-Z]/g) || []).length
  const digitChars = (text.match(/\d/g) || []).length
  const otherChars = Math.max(0, text.length - chineseChars - englishLetters - digitChars)
  return Math.ceil(chineseChars * 1.5 + englishWords * 1.3 + numbers * 0.8 + otherChars * 0.3)
}

export interface TokenMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * 按 token 预算从最新消息往前截断，保证最新的一定在。
 * 至少保留最新一条（哪怕超预算）。
 */
export function truncateByToken(messages: TokenMessage[], budget: number): TokenMessage[] {
  if (!messages || messages.length === 0) return []
  const result: TokenMessage[] = []
  let used = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    const tokens = estimateToken(msg.content)
    if (used + tokens > budget && result.length > 0) break
    result.unshift(msg)
    used += tokens
  }
  return result
}
