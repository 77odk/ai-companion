// 语言检测：中文字符占比 > 阈值 → zh，否则 en
// 纯函数，可 Node 单测
export type Lang = 'zh' | 'en'
/** 中文字符占比阈值：> 0.25 算中文，否则英文 */
const ZH_RATIO_THRESHOLD = 0.25
/**
 * 检测文本语言。
 * - 中文字符（\u4e00-\u9fff）占总字符数比例 > 0.25 → zh
 * - 否则 → en
 * - 空字符串 / 纯标点 → en（保守，英文用户不会被误判成中文）
 *
 * 纯函数，无副作用，可 Node 单测。
 */
export function detectLang(text: string): Lang {
  const t = String(text ?? '')
  if (!t) return 'en'
  const total = t.length
  if (total === 0) return 'en'
  let zhCount = 0
  for (let i = 0; i < total; i++) {
    const code = t.charCodeAt(i)
    if (code >= 0x4e00 && code <= 0x9fff) zhCount++
  }
  const ratio = zhCount / total
  return ratio > ZH_RATIO_THRESHOLD ? 'zh' : 'en'
}
/**
 * 从多条消息里判定多数语言。
 * 用于人设为空时，看最近 N 条用户消息的多数语言。
 * 空数组 → 'zh'（默认中文用户）
 */
export function detectLangFromMessages(messages: string[]): Lang {
  if (!Array.isArray(messages) || messages.length === 0) return 'zh'
  let zh = 0
  let en = 0
  for (const m of messages) {
    if (detectLang(m) === 'zh') zh++
    else en++
  }
  return zh > en ? 'zh' : 'en'
}
