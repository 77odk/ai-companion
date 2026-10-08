import { useMemo, useState } from 'react'
import type {
  TaStateDashboard,
  TaStateHistoryPoint,
  TaStateTendenciesView,
} from '../lib/taState'

interface Props {
  dashboard: TaStateDashboard | null
}

type MetricKey = 'relaxedTense' | 'quietActive' | keyof TaStateTendenciesView

const METRICS: Array<{ key: MetricKey; label: string; axis?: true }> = [
  { key: 'relaxedTense', label: '舒展 / 紧绷', axis: true },
  { key: 'quietActive', label: '沉静 / 活跃', axis: true },
  { key: 'connection', label: '连接' },
  { key: 'expression', label: '表达' },
  { key: 'exploration', label: '探索' },
  { key: 'involvement', label: '投入' },
  { key: 'reminiscence', label: '回想' },
  { key: 'space', label: '独处' },
  { key: 'energy', label: '精力' },
]

function metricValue(
  source: Pick<TaStateDashboard, 'axes' | 'tendencies'> | TaStateHistoryPoint,
  key: MetricKey,
): number {
  if (key === 'relaxedTense' || key === 'quietActive') return source.axes[key]
  return source.tendencies[key]
}

function normalizedMetric(
  source: Pick<TaStateDashboard, 'axes' | 'tendencies'> | TaStateHistoryPoint,
  key: MetricKey,
): number {
  const value = metricValue(source, key)
  return key === 'relaxedTense' || key === 'quietActive'
    ? (value + 1) / 2
    : value
}

function svgPoints(values: number[], width = 260, height = 58): string {
  if (values.length === 0) return ''
  if (values.length === 1) {
    const y = height - Math.max(0, Math.min(1, values[0])) * height
    return `${width / 2},${y.toFixed(2)}`
  }
  return values.map((value, index) => {
    const x = index * (width / (values.length - 1))
    const y = height - Math.max(0, Math.min(1, value)) * height
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
}

function pulsePath(score: number): string {
  const level = Math.max(0, Math.min(1, Math.abs(score - 70) / 42))
  const amp = 7 + level * 19
  const mid = 38
  return [
    'M 0 38',
    'L 28 38',
    `L 38 ${(mid - amp * .24).toFixed(1)}`,
    `L 47 ${(mid + amp * .16).toFixed(1)}`,
    `L 58 ${(mid - amp).toFixed(1)}`,
    `L 69 ${(mid + amp * .58).toFixed(1)}`,
    `L 80 ${(mid - amp * .18).toFixed(1)}`,
    'L 104 38',
    'L 132 38',
    `L 142 ${(mid - amp * .22).toFixed(1)}`,
    `L 151 ${(mid + amp * .14).toFixed(1)}`,
    `L 162 ${(mid - amp * .92).toFixed(1)}`,
    `L 173 ${(mid + amp * .52).toFixed(1)}`,
    `L 184 ${(mid - amp * .16).toFixed(1)}`,
    'L 210 38',
    'L 260 38',
  ].join(' ')
}

function timeLabel(ts: number): string {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function changedLabels(prev: TaStateHistoryPoint | null, next: TaStateHistoryPoint): string[] {
  if (!prev) return []
  return METRICS.flatMap(({ key, label }) => {
    const delta = metricValue(next, key) - metricValue(prev, key)
    if (Math.abs(delta) < .015) return []
    return [`${label} ${delta > 0 ? '↑' : '↓'}`]
  })
}

export default function ChaomuState({ dashboard }: Props) {
  const [expanded, setExpanded] = useState(false)

  const history = useMemo(() => {
    if (!dashboard) return []
    const points = [...dashboard.history]
    const last = points[points.length - 1]
    const current: TaStateHistoryPoint = {
      at: Date.now(),
      score: dashboard.score,
      axes: dashboard.axes,
      tendencies: dashboard.tendencies,
      reason: '',
      kind: 'time',
    }
    const same = last
      && last.score === current.score
      && Math.abs(last.axes.relaxedTense - current.axes.relaxedTense) < .0005
      && Math.abs(last.axes.quietActive - current.axes.quietActive) < .0005
    if (!same) points.push(current)
    return points.slice(-48)
  }, [dashboard])

  if (!dashboard) {
    return (
      <section className="chaomu-state-v2 is-empty" aria-label="TA 此刻状态">
        <span className="chaomu-pulse-score">--</span>
        <svg className="chaomu-pulse" viewBox="0 0 260 76" aria-hidden="true">
          <path d="M0 38H260" />
        </svg>
      </section>
    )
  }

  return (
    <section className={`chaomu-state-v2${expanded ? ' is-expanded' : ''}`} aria-label="TA 此刻状态">
      <button
        type="button"
        className="chaomu-pulse-summary"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-label={expanded ? '收起状态详情' : '查看状态详情'}
      >
        <span className="chaomu-pulse-score">{dashboard.score}</span>
        <svg className="chaomu-pulse" viewBox="0 0 260 76" role="img" aria-label={`状态读数 ${dashboard.score}`}>
          <path className="chaomu-pulse-baseline" d="M0 38H260" />
          <path className="chaomu-pulse-trace" d={pulsePath(dashboard.score)} />
        </svg>
      </button>

      {expanded ? (
        <div className="chaomu-state-detail">
          <div className="chaomu-state-curves" aria-label="状态走势">
            {METRICS.map(({ key, label }) => {
              const values = history.map((point) => normalizedMetric(point, key))
              const points = svgPoints(values)
              return (
                <article key={key} className="chaomu-state-curve">
                  <span>{label}</span>
                  <svg viewBox="0 0 260 58" aria-label={`${label}走势`}>
                    <path d="M0 29H260" className="chaomu-state-midline" />
                    {values.length > 1 ? (
                      <polyline points={points} className="chaomu-state-line" />
                    ) : values.length === 1 ? (
                      <circle cx="130" cy={58 - values[0] * 58} r="2.7" className="chaomu-state-dot" />
                    ) : null}
                  </svg>
                </article>
              )
            })}
          </div>

          <div className="chaomu-state-log" aria-label="状态变化日志">
            {dashboard.history.length === 0 ? (
              <p className="chaomu-state-log-empty">还没有可回看的状态变化。</p>
            ) : (
              [...dashboard.history].reverse().map((point, reverseIndex) => {
                const chronologicalIndex = dashboard.history.length - 1 - reverseIndex
                const prev = chronologicalIndex > 0 ? dashboard.history[chronologicalIndex - 1] : null
                const scoreDelta = prev ? point.score - prev.score : 0
                const changed = changedLabels(prev, point)
                return (
                  <article key={`${point.at}-${reverseIndex}`} className="chaomu-state-log-item">
                    <div>
                      <time>{timeLabel(point.at)}</time>
                      <strong className={scoreDelta > 0 ? 'is-up' : scoreDelta < 0 ? 'is-down' : ''}>
                        {prev ? `${scoreDelta > 0 ? '+' : ''}${scoreDelta}` : point.score}
                      </strong>
                    </div>
                    {changed.length > 0 ? <span>{changed.join(' · ')}</span> : null}
                    <p>{point.reason}</p>
                  </article>
                )
              })
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}
