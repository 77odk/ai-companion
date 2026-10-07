import { useMemo, useState } from 'react'
import { getTaStateDetailView, type TaStateSnapshot } from '../lib/taState'

interface Props { sessionId: string }

const SERIES = [
  ['connection', '连接'],
  ['expression', '表达'],
  ['exploration', '探索'],
  ['involvement', '投入'],
  ['reminiscence', '回想'],
  ['space', '留白'],
  ['energy', '精力'],
] as const

function points(values: number[], width = 260, height = 48): string {
  if (values.length === 0) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(.08, max - min)
  return values.map((value, index) => {
    const x = values.length === 1 ? width : (index / (values.length - 1)) * width
    const y = height - ((value - min) / span) * (height - 10) - 5
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

function metricHistory(history: TaStateSnapshot[], read: (item: TaStateSnapshot) => number, current: number): number[] {
  const values = history.slice(-24).map(read)
  return values.length > 0 ? values : [current]
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function ChaomuStatePanel({ sessionId }: Props) {
  const [open, setOpen] = useState(false)
  const detail = useMemo(() => sessionId ? getTaStateDetailView(sessionId) : null, [sessionId])
  if (!detail) return null

  const score = detail.score
  const amplitude = Math.max(8, Math.min(26, 8 + Math.abs(score - 72) * .55 + Math.abs(detail.axes.quietActive) * 8))
  const beat = `0,28 22,28 30,${28-amplitude*.28} 38,${28+amplitude*.18} 48,28 68,28 76,${28-amplitude} 84,${28+amplitude*.72} 94,28 120,28 132,${28-amplitude*.36} 140,${28+amplitude*.2} 150,28 176,28 184,${28-amplitude*.78} 192,${28+amplitude*.5} 202,28 240,28`

  const logs = [...detail.history].reverse().slice(0, 40)

  return (
    <section className="chaomu-state-panel" aria-label="TA 此刻状态">
      <button type="button" className="chaomu-pulse-card" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <strong className="chaomu-pulse-score">{score}</strong>
        <svg className="chaomu-pulse-wave" viewBox="0 0 240 56" role="img" aria-label={`当前状态读数 ${score}`}>
          <polyline className="chaomu-pulse-track" points="0,28 240,28" />
          <polyline className="chaomu-pulse-line" points={beat} />
        </svg>
      </button>

      {open ? (
        <div className="chaomu-state-detail">
          <div className="chaomu-state-curves" aria-label="状态走势">
            <div className="chaomu-state-curve">
              <span>舒展 / 紧绷</span>
              <svg viewBox="0 0 260 48" aria-hidden="true"><polyline points={points(metricHistory(detail.history, (item) => item.axes.relaxedTense, detail.axes.relaxedTense))} /></svg>
            </div>
            <div className="chaomu-state-curve">
              <span>沉静 / 活跃</span>
              <svg viewBox="0 0 260 48" aria-hidden="true"><polyline points={points(metricHistory(detail.history, (item) => item.axes.quietActive, detail.axes.quietActive))} /></svg>
            </div>
            {SERIES.map(([key, label]) => (
              <div className="chaomu-state-curve" key={key}>
                <span>{label}</span>
                <svg viewBox="0 0 260 48" aria-hidden="true"><polyline points={points(metricHistory(detail.history, (item) => item.tendencies[key], detail.tendencies[key]))} /></svg>
              </div>
            ))}
          </div>

          <div className="chaomu-state-log" aria-label="状态记录">
            {logs.map((item, index) => (
              <article key={`${item.at}-${index}`}>
                <time>{fmtTime(item.at)}</time>
                <p>{item.reason.text}</p>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}
