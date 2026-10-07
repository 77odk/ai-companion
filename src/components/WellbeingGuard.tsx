import { useEffect, useRef, useState } from 'react'
import {
  pruneCommittedReplyTimes,
  shouldShowContinuousUseReminder,
  shouldShowRealityBoundaryReminder,
} from '../lib/wellbeingPolicy'

type NoticeKind = 'continuous' | 'reality'

interface Props {
  enabled: boolean
}

const TICK_MS = 30_000
const MAX_VISIBLE_TICK_MS = 45_000

export default function WellbeingGuard({ enabled }: Props) {
  const [notice, setNotice] = useState<NoticeKind | null>(null)
  const activeMsRef = useRef(0)
  const lastTickRef = useRef(Date.now())
  const repliesRef = useRef<number[]>([])
  const continuousShownRef = useRef(false)
  const realityShownRef = useRef(false)

  useEffect(() => {
    if (!enabled) {
      setNotice(null)
      activeMsRef.current = 0
      repliesRef.current = []
      lastTickRef.current = Date.now()
      continuousShownRef.current = false
      realityShownRef.current = false
      return
    }

    const maybeShow = (now: number) => {
      repliesRef.current = pruneCommittedReplyTimes(repliesRef.current, now)

      // 对话过密提醒优先于普通时长提醒，但两个都只在本次页面生命周期出现一次。
      if (
        !notice
        && shouldShowRealityBoundaryReminder(repliesRef.current, now, realityShownRef.current)
      ) {
        realityShownRef.current = true
        setNotice('reality')
        return
      }

      if (
        !notice
        && shouldShowContinuousUseReminder(activeMsRef.current, continuousShownRef.current)
      ) {
        continuousShownRef.current = true
        setNotice('continuous')
      }
    }

    const tickVisibleTime = () => {
      const now = Date.now()
      if (document.visibilityState === 'visible') {
        const delta = Math.max(0, Math.min(MAX_VISIBLE_TICK_MS, now - lastTickRef.current))
        activeMsRef.current += delta
        maybeShow(now)
      }
      lastTickRef.current = now
    }

    const onVisibility = () => {
      tickVisibleTime()
      lastTickRef.current = Date.now()
    }

    const onReplyCommitted = () => {
      const now = Date.now()
      repliesRef.current = [...repliesRef.current, now]
      maybeShow(now)
    }

    lastTickRef.current = Date.now()
    const timer = window.setInterval(tickVisibleTime, TICK_MS)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('yiwem:ai-reply-committed', onReplyCommitted)

    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('yiwem:ai-reply-committed', onReplyCommitted)
    }
  }, [enabled, notice])

  if (!enabled || !notice) return null

  const continuous = notice === 'continuous'
  return (
    <aside className="wellbeing-notice" role="status" aria-live="polite">
      <div>
        <strong>{continuous ? '已经连续使用约 2 小时' : '这段时间聊得很密'}</strong>
        <p>
          {continuous
            ? '活动一下、看看远处，也记得给现实生活留一点时间。忆文随时都在。'
            : 'TA 是 AI 陪伴，不替代现实中的家人、朋友或专业支持。也记得把一些时间留给现实生活。'}
        </p>
      </div>
      <button type="button" onClick={() => setNotice(null)}>知道了</button>
    </aside>
  )
}
