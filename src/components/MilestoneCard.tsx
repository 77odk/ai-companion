import { milestoneText } from '../lib/milestone'

interface Props {
  /** 认识第 N 天（只会在里程碑日弹） */
  day: number
  /** 关闭纪念卡（调用方负责标记已展示，不再弹） */
  onClose: () => void
}

/** 相处里程碑纪念卡：全屏暖橘卡片，可截图（小红书素材）。纯模板，不调 LLM。 */
export default function MilestoneCard({ day, onClose }: Props) {
  return (
    <div className="milestone-overlay" role="dialog" aria-modal="true" aria-label="相处里程碑">
      <div className="milestone-card">
        <p className="milestone-day">{day}</p>
        <p className="milestone-caption">认识第 {day} 天</p>
        <p className="milestone-text">{milestoneText(day)}</p>
        <button type="button" className="milestone-close" onClick={onClose}>
          收下
        </button>
      </div>
    </div>
  )
}
