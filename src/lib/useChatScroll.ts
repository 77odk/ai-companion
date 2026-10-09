import { useEffect, useLayoutEffect, useRef } from 'react'
import { verifyChatJumpTarget, type ChatJumpTarget } from './chatJump'
import type { StoredMessage } from './storage'

// UI2-03B-1：「看原对话」跳转保护窗口（模块级时间戳）——
// dev StrictMode 会模拟卸载/重挂载，组件内 ref 快照会被重置成 false，
// 于是 auto-scroll 立刻把列表拉回底部、覆盖 jump 的第一帧定位。
// 模块级时间戳不受 remount 影响；用户发消息时由 releaseJumpHold 立刻清掉。
let chatJumpHoldUntil = 0
const markChatJumpHold = (ms: number) => {
  chatJumpHoldUntil = Date.now() + ms
}
const isChatJumpHolding = () => Date.now() < chatJumpHoldUntil
const clearChatJumpHold = () => {
  chatJumpHoldUntil = 0
}

/**
 * 第二组拆分：滚动与跳转（UI2-03B-1「看原对话」）。
 * 只搬结构，不改逻辑：scrollRef / 跳转锚相关 refs / auto-scroll / jump 定位。
 * 返回 scrollRef（JSX 挂载点）与 releaseJumpHold（send 里用户发消息时解除保护）。
 */
export function useChatScroll(options: {
  visibleMessages: StoredMessage[]
  pendingJump: ChatJumpTarget | null
  activeSessionId: string | null
  onJumpConsumed?: () => void
  onJumpNotice?: (text: string) => void
}) {
  const { visibleMessages, pendingJump, activeSessionId, onJumpConsumed, onJumpNotice } = options

  // UI2-03B-1：jump effect 只依赖 pendingJump/session，消息列表通过 ref 读取最新值 ——
  // 这样消息每次更新都不会重跑 jump effect（否则 cleanup 会把跳转保护窗口的定时器提前清掉）
  const visibleMessagesRef = useRef(visibleMessages)
  visibleMessagesRef.current = visibleMessages

  const scrollRef = useRef<HTMLDivElement>(null)
  // UI2-03B-1：pending jump 时让 scroll-bottom 让位一次（不能先滚到底再跳，也不能跳完被拉回）
  const jumpSuppressRef = useRef(false)
  // UI2-03B-1：本次 mount 是否带 pending jump —— 挂载时快照，保证「第一次 scroll-bottom」就让位
  // （auto-scroll effect 声明在 jump effect 之前，靠 jumpSuppressRef 来不及）
  const jumpAtMountRef = useRef(Boolean(pendingJump))
  // UI2-03B-1：跳转保护窗口。跳完立即放开会被同帧/随后的异步更新（busy 状态、云端消息合并）再次拉到底，
  // 所以跳转成功后保持保护，直到用户自己发了消息或窗口超时（2.5s）自动解除。
  const jumpHoldRef = useRef(Boolean(pendingJump))
  const jumpHoldTimerRef = useRef<number | null>(null)
  const releaseJumpHold = () => {
    jumpHoldRef.current = false
    clearChatJumpHold()
    if (jumpHoldTimerRef.current !== null) {
      window.clearTimeout(jumpHoldTimerRef.current)
      jumpHoldTimerRef.current = null
    }
  }
  // 防重复消费同一 pending target（StrictMode 双跑 / deps 抖动时只处理一次）
  const jumpHandledRef = useRef(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // UI2-03B-1：本次 mount 带 pending jump / 跳转保护窗口内，scroll-bottom 让位（由 jump 接管定位）
    if (jumpAtMountRef.current || jumpHoldRef.current || jumpSuppressRef.current || isChatJumpHolding()) return
    el.scrollTop = el.scrollHeight
  }, [visibleMessages])

  // UI2-03B-1「看原对话」：消费 App 传来的一次性 jump target。
  // 用 useLayoutEffect：DOM commit 后、paint 前直接定位 —— 第一可见帧就在目标附近，
  // 不再出现「先看到底部，再 smooth 滑回来」。首次定位必须 instant（behavior: 'auto'）。
  // 二次校验（session 未变 + visibleMessages 中 ts/content 完全一致的唯一 user 消息）通过才滚动；
  // 失败 → 清 pending + 上报提示（由 App 展示），绝不滚到别的消息。
  useLayoutEffect(() => {
    if (!pendingJump) return
    if (jumpHandledRef.current) return
    // 失败路径统一：释放保护 → 消费 pending → 上报提示（App 展示），绝不滚动
    const fail = () => {
      releaseJumpHold()
      jumpAtMountRef.current = false
      jumpSuppressRef.current = false
      onJumpConsumed?.()
      onJumpNotice?.('暂时无法定位原对话')
    }
    if (!activeSessionId) {
      // 无会话：跳不了，同样消费 pending + 提示，避免 pending 残留 / 死状态
      fail()
      return
    }
    jumpHandledRef.current = true
    if (!verifyChatJumpTarget(pendingJump, activeSessionId, visibleMessagesRef.current)) {
      fail()
      return
    }
    // 让 auto-scroll 让位：本轮滚动由 jump 接管
    jumpSuppressRef.current = true
    const ts = pendingJump.ts
    // DOM 定位必须同时锁 role=user + ts：同 ts 下可能存在 assistant 行，不能只靠 ts
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-msg-role="user"][data-msg-ts="${ts}"]`,
    )
    if (el) {
      // paint 前 instant 落位：第一眼就在原文附近（不再用 smooth 二次滚动）
      el.scrollIntoView({ block: 'center', behavior: 'auto' })
      el.classList.add('msg-jump-highlight')
      window.setTimeout(() => el.classList.remove('msg-jump-highlight'), 1800)
    } else {
      // 目标节点不存在（数据/渲染异常）：仍要消费 pending 并提示，不滚错位置
      onJumpNotice?.('暂时无法定位原对话')
    }
    jumpAtMountRef.current = false
    jumpSuppressRef.current = false
    // 跳转保护窗口：挡住跳完之后同帧/随后的异步更新（busy 状态、云端消息合并）再次把列表拉到底
    if (jumpHoldTimerRef.current !== null) window.clearTimeout(jumpHoldTimerRef.current)
    markChatJumpHold(2500)
    jumpHoldTimerRef.current = window.setTimeout(() => {
      jumpHoldRef.current = false
      chatJumpHoldUntil = 0
      jumpHoldTimerRef.current = null
    }, 2500)
    onJumpConsumed?.()
    // 注意：这里故意不写 cleanup —— 失败路径会当场消费 pending（pendingJump → null）触发 cleanup；
    // 提示状态由 App 持有，不受本 effect 生命周期影响。
  }, [pendingJump, activeSessionId])

  return { scrollRef, releaseJumpHold }
}
