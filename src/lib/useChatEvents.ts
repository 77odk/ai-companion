// 第二轮拆分 第 6 组：里程碑（Milestone）状态与挂载逻辑从 Chat.tsx 原样下沉。
// 只搬不改：milestone / showMilestone 两个 useState、挂载时跑一次的 effect、
// closeMilestone。Event 候选识别不在本文件（chatContextBuild.ts 调 processEventCandidate）。
import { useEffect, useState } from 'react'
import { getActiveSessionId } from './sessionStore'
import { ensureMilestoneEvent, getMilestoneStatus, latestReachedMilestoneDay, markMilestoneShown } from './milestone'

export interface MilestoneState {
  day: number
  hit: boolean
  shown: boolean
}

/**
 * 里程碑（共同记忆进度）：挂载时计算一次，命中且未展示过才显示 MilestoneCard。
 * 依赖数组保持空（与原 Chat.tsx 行为一致），不允许因依赖变化重跑。
 */
export function useChatEvents(): {
  milestone: MilestoneState | null
  showMilestone: boolean
  closeMilestone: () => void
} {
  const [milestone, setMilestone] = useState<MilestoneState | null>(null)
  const [showMilestone, setShowMilestone] = useState(false)

  useEffect(() => {
    const now = Date.now()
    const sid = getActiveSessionId() || undefined
    const st = getMilestoneStatus(now, sid)
    const reached = latestReachedMilestoneDay(st.day)
    if (reached) ensureMilestoneEvent(reached, now, sid)
    if (st.hit && !st.shown) {
      setMilestone(st)
      setShowMilestone(true)
    }
  }, [])

  const closeMilestone = () => {
    if (milestone) markMilestoneShown(milestone.day)
    setShowMilestone(false)
  }

  return { milestone, showMilestone, closeMilestone }
}
