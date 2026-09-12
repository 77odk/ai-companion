interface MilestoneProps {
  /** 认识第 N 天 */
  day: number
  /** 下一里程碑；730 之后 null（轨迹完成态） */
  next: number | null
  /** 0–1 */
  progress: number
  /** 今天是否正好落在里程碑日 */
  reached: boolean
}

interface Props {
  label?: string
  count?: string
  date?: string
  dateValue?: string
  milestone?: MilestoneProps
  onView: () => void
}

export default function HomeAnniversary({ label, count, date, dateValue, milestone, onView }: Props) {
  return (
    <section className="home-anniversary" aria-label="重要日期">
      <span className="home-eyebrow">IMPORTANT DATE</span>
      {label ? (
        <>
          <h2>{label}</h2>
          <strong>{count}</strong>
          <time dateTime={dateValue?.length === 5 ? `--${dateValue}` : dateValue}>{date}</time>
        </>
      ) : (
        <>
          <h2>属于你们的重要日子</h2>
          <strong>慢慢写下</strong>
          <span className="home-anniversary-empty">每一天都算数</span>
        </>
      )}
      {milestone ? (
        <div className="home-anniv-milestone" aria-label={`认识 ${milestone.day} 天`}>
          <div className="home-anniv-milestone-line">
            <span className="home-anniv-day">第 <strong>{milestone.day}</strong> 天</span>
            {milestone.next != null ? (
              milestone.reached ? (
                <span className="home-anniv-next">今天正好 {milestone.next} 天</span>
              ) : (
                <span className="home-anniv-next">下一个 {milestone.next} 天 · 还差 {milestone.next - milestone.day} 天</span>
              )
            ) : (
              <span className="home-anniv-next">一路走到今天</span>
            )}
          </div>
          <div className="home-anniv-track" aria-hidden="true">
            <span
              className="home-anniv-track-fill"
              style={{ width: `${Math.round(Math.min(1, Math.max(0, milestone.progress)) * 100)}%` }}
            />
          </div>
        </div>
      ) : null}
      <button type="button" className="home-anniversary-view" onClick={onView}>查看</button>
    </section>
  )
}
