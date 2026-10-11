import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Space3DData } from './Space3DCanvas'
import type { Hit } from '../../lib/space3d/interaction'
import { readEnvironmentPreferences, saveEnvironmentPreferences } from '../../lib/environmentPreferences'
import { loadHomeWeather } from '../../lib/homeWeather'
import { loadUserProfile } from '../../lib/storage'
import '../../styles/space3d.css'

const Space3DCanvas = lazy(() => import('./Space3DCanvas'))
class SceneBoundary extends Component<{ children: ReactNode; onFailure: (reason: string) => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onFailure('initialization-failed') }
  render() { return this.state.failed ? null : this.props.children }
}
export default function Space3DGate({ data, onOpen }: { data: Omit<Space3DData, 'weather'>; onOpen: (hit: Hit) => void }) {
  const [enabled, setEnabled] = useState(() => new URLSearchParams(location.search).get('space3d') === '1'
    || readEnvironmentPreferences().space3d === true)
  const [ready, setReady] = useState(false), [failure, setFailure] = useState('')
  const [weather, setWeather] = useState<Space3DData['weather']>(null)
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = host.current?.closest('.ai-space-page')
    root?.classList.toggle('space3d-ready', enabled && ready && !failure)
    return () => { root?.classList.remove('space3d-ready') }
  }, [enabled, ready, failure])
  useEffect(() => {
    if (!enabled || failure) return
    let active = true
    const refresh = () => {
      if (document.hidden) return
      void loadHomeWeather(loadUserProfile().city ?? '').then(value => { if (active) setWeather(value) })
    }
    refresh(); const timer = window.setInterval(refresh, 60000)
    return () => { active = false; clearInterval(timer) }
  }, [enabled, failure])
  return <div ref={host} className="space3d-gate" data-fallback={failure || undefined}>
    <button type="button" className="space3d-switch" aria-pressed={enabled && !failure}
      onClick={() => {
        const next = !enabled || !!failure
        saveEnvironmentPreferences({ space3d: next }); setEnabled(next); setReady(false); setFailure('')
      }}>{enabled && !failure ? '关闭 3D' : '开启 3D'}</button>
    {failure && <span className="space3d-fallback" role="status">已切回原来的空间</span>}
    {enabled && !failure && <SceneBoundary onFailure={setFailure}>
      <Suspense fallback={null}><Space3DCanvas key={data.sessionId} data={{ ...data, weather }} onOpen={onOpen}
        onReady={() => setReady(true)} onFailure={setFailure} /></Suspense>
    </SceneBoundary>}
  </div>
}
