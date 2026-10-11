import { useEffect, useState } from 'react'
import type { HomeWeather } from '../lib/homeWeather'
import { calculateEnvironment } from '../lib/environment'
import { readEnvironmentPreferences, saveEnvironmentPreferences } from '../lib/environmentPreferences'

export default function EnvironmentFeedback({ weather }: { weather: HomeWeather | null }) {
  const [enabled, setEnabled] = useState(() => readEnvironmentPreferences().environmentFeedback === true)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const tick = () => { if (!document.hidden) setNow(Date.now()) }
    const timer = window.setInterval(tick, 60000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick) }
  }, [])
  if (!weather?.timezone || weather.latitude == null || weather.longitude == null) return null
  const environment = calculateEnvironment({ ...weather, utcTimestamp: now,
    latitude: weather.latitude, longitude: weather.longitude, timezone: weather.timezone })
  return <>
    {enabled && <span aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none',
      background: environment.isDay ? '#575E63' : '#5A78A0',
      opacity: environment.isDay ? (weather.cloudcover ?? 0) / 100 * 0.025 : 0.025 }} />}
    <button type="button" style={{ position: 'absolute', right: 12, top: 12, zIndex: 2 }}
      aria-pressed={enabled} onClick={() => {
        saveEnvironmentPreferences({ environmentFeedback: !enabled }); setEnabled(!enabled)
      }}>{enabled ? '关闭光线反馈' : '开启光线反馈'}</button>
  </>
}
