// 第二轮拆分 第 7 组：输入区状态与设置读取从 Chat.tsx 原样下沉。
// 只搬不改：input / quoteDraft / actionNarrationEnabled 状态、ELUVINDATACHANGE 刷新订阅、
// inputRef、textarea 高度自适应 effect。
// send 内的清空/恢复调用（setInput('')、setQuoteDraft(null)、setInput(failedText)）
// 与 insertActionNarration 等调用面留在 Chat.tsx，经本 hook 返回值接入。
import { useEffect, useRef, useState, type Dispatch, type SetStateAction, type RefObject } from 'react'
import { isActionNarrationEnabled } from './storage'
import { type MessageQuote } from './messageQuote'
import { ELUVIN_DATA_CHANGE } from './dataChange'

export function useChatComposer(): {
  input: string
  setInput: Dispatch<SetStateAction<string>>
  quoteDraft: MessageQuote | null
  setQuoteDraft: Dispatch<SetStateAction<MessageQuote | null>>
  actionNarrationEnabled: boolean
  inputRef: RefObject<HTMLTextAreaElement>
} {
  const [input, setInput] = useState('')
  const [quoteDraft, setQuoteDraft] = useState<MessageQuote | null>(null)
  const [actionNarrationEnabled, setActionNarrationEnabledState] = useState(() => isActionNarrationEnabled())

  // 设置变更（ELUVINDATACHANGE）时重新读回旁白开关，避免只在挂载时读一次。
  useEffect(() => {
    const refreshActionNarration = () => setActionNarrationEnabledState(isActionNarrationEnabled())
    window.addEventListener(ELUVIN_DATA_CHANGE, refreshActionNarration)
    return () => window.removeEventListener(ELUVIN_DATA_CHANGE, refreshActionNarration)
  }, [])

  const inputRef = useRef<HTMLTextAreaElement>(null)

  // textarea 高度自适应：只跟随 input 变化（与原依赖语义一致）
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [input])

  return { input, setInput, quoteDraft, setQuoteDraft, actionNarrationEnabled, inputRef }
}
