import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HomeWeather } from '../../lib/homeWeather'
import type { StoredMessage } from '../../lib/storage'
import type { ListenTogetherSnapshot } from '../../lib/listenTogetherState'
import { calculateEnvironment } from '../../lib/environment'
import { QualityMonitor, qualitySettings } from '../../lib/space3d/quality'
import { bindGestures, type Hit } from '../../lib/space3d/interaction'
import { drawBookPage, paginateMessages, pageForPosition } from '../../lib/space3d/bookPages'
import { readEnvironmentPreferences, saveEnvironmentPreferences, type ReadingPosition } from '../../lib/environmentPreferences'
import { createSpaceScene } from '../../lib/space3d/scene.js'
import ReadingOverlay from './ReadingOverlay'

export interface Space3DData {
  sessionId: string; messages: StoredMessage[]; memoryCount: number; weeklyCount: number;
  listen: ListenTogetherSnapshot; photoUrls: string[]; weather: HomeWeather | null
}
export default function Space3DCanvas({ data, onOpen, onReady, onFailure }: {
  data: Space3DData; onOpen: (hit: Hit) => void; onReady: () => void; onFailure: (reason: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<ReturnType<typeof createSpaceScene> | null>(null)
  const callbacks = useRef({ onOpen, onFailure, onReady, data })
  useEffect(() => { callbacks.current = { onOpen, onFailure, onReady, data } }, [onOpen, onFailure, onReady, data])
  const [mode, setMode] = useState('overview')
  const [arranging, setArranging] = useState(false), arrangingRef = useRef(false)
  const [selected, setSelected] = useState<Hit>(null)
  const [reader, setReader] = useState(false)
  const [revision, setRevision] = useState(0)
  const pages = useMemo(() => paginateMessages(data.messages), [data.messages])
  const position = readEnvironmentPreferences().reading?.[data.sessionId]
  const [page, setPage] = useState(() => pageForPosition(pages, position))
  const [metrics, setMetrics] = useState<{ fps?: number | null; calls?: number; triangles?: number }>({})
  const monitor = useRef(new QualityMonitor())
  const savePosition = (next: ReadingPosition) => saveEnvironmentPreferences({
    reading: { ...readEnvironmentPreferences().reading, [data.sessionId]: next },
  })
  const chooseMode = (next: string) => { setMode(next); sceneRef.current?.mode(next) }
  const forwardOpen = (hit: Hit) => {
    if (hit === 'drawer') chooseMode('drawer')
    if (hit) callbacks.current.onOpen(hit)
  }
  const arrange = useCallback((hit: Hit) => {
    arrangingRef.current = hit != null; setArranging(hit != null); setSelected(hit)
    setMode('overview'); sceneRef.current?.arrange(hit)
  }, [])
  useEffect(() => {
    const canvas = canvasRef.current!
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let scene: ReturnType<typeof createSpaceScene>
    let frameInjection = false
    const lowEnd = navigator.hardwareConcurrency <= 4
    const highEnd = navigator.hardwareConcurrency >= 8
    const sampleFrame = (ms: number) => {
      const before = monitor.current.step, next = monitor.current.sample(ms)
      if (next !== before) {
        if (next === 4) callbacks.current.onFailure('low-fps')
        else scene.quality(qualitySettings(next, lowEnd, highEnd))
      }
    }
    try {
      scene = createSpaceScene(canvas, {
        reducedMotion: motion.matches, quality: qualitySettings(0, lowEnd, highEnd),
        onFailure: (reason: string) => callbacks.current.onFailure(reason),
        onPause: () => monitor.current.resetWindow(),
        onFrame: (ms: number) => { if (!frameInjection) sampleFrame(ms) },
        onMetrics: (value: typeof metrics) => setMetrics(value),
      })
    } catch { callbacks.current.onFailure('initialization-failed'); return }
    sceneRef.current = scene
    if (import.meta.env.DEV && new URLSearchParams(location.search).get('space3dTest') === '1') {
      Object.assign(window, { __space3dTest: { sampleFrame, stats: () => scene.stats(),
        maximumDensity: () => scene.snapshot({ ...callbacks.current.data, memoryCount: 48, weeklyCount: 5 }),
        beginMetrics: () => { scene.resetMetrics(); monitor.current.resetWindow() },
        environment: (value: Parameters<typeof calculateEnvironment>[0]) => scene.setEnvironment(calculateEnvironment(value)),
        quality: (step: Parameters<typeof qualitySettings>[0]) => scene.quality(qualitySettings(step, lowEnd, highEnd)),
        beginFrameInjection: () => { frameInjection = true; monitor.current = new QualityMonitor(); scene.quality(qualitySettings(0, lowEnd, highEnd)) },
        step: () => monitor.current.step, mode: (next: string) => { setMode(next); scene.mode(next) } } })
    }
    const open = (hit: Hit) => {
      if (hit === 'drawer') { setMode('drawer'); scene.mode('drawer') }
      if (hit) callbacks.current.onOpen(hit)
    }
    const unbind = bindGestures(canvas, { hit: scene.hit, open, arrange,
      orbit: scene.orbit, zoom: scene.zoom, isArranging: () => arrangingRef.current })
    const changed = () => scene.reduced(motion.matches)
    motion.addEventListener('change', changed)
    const readyFrame = requestAnimationFrame(() => { setRevision(v => v + 1); callbacks.current.onReady() })
    return () => { cancelAnimationFrame(readyFrame); arrangingRef.current = false; unbind(); motion.removeEventListener('change', changed); scene.dispose(); sceneRef.current = null }
  }, [arrange])
  useEffect(() => {
    const apply = () => {
      const weather = callbacks.current.data.weather
      if (weather?.timezone && weather.latitude != null && weather.longitude != null) {
        try { sceneRef.current?.setEnvironment(calculateEnvironment({ ...weather,
          latitude: weather.latitude, longitude: weather.longitude, timezone: weather.timezone, utcTimestamp: Date.now() })) }
        catch { /* No device-zone substitution. Keep neutral illumination. */ }
      }
    }
    apply()
    const tick = () => { if (!document.hidden) apply() }
    const timer = window.setInterval(tick, 60000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick) }
  }, [data.weather, revision])
  const { listen, memoryCount, weeklyCount } = data
  useEffect(() => {
    const refresh = () => { if (!document.hidden) sceneRef.current?.snapshot({ listen, memoryCount, weeklyCount }) }
    refresh(); document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [listen, memoryCount, weeklyCount, revision])
  useEffect(() => { sceneRef.current?.photos(data.photoUrls) }, [data.photoUrls, revision])
  useEffect(() => {
    let alive = true
    Promise.all(mode === 'reading'
      ? [drawBookPage(pages[page - 1]), drawBookPage(pages[page])]
      : [drawBookPage(pages[page]), drawBookPage(pages[page + 1])]).then(canvases => {
      if (alive) void sceneRef.current?.pages(canvases)
    })
    return () => { alive = false }
  }, [pages, page, revision, mode])
  const turn = (direction: number) => {
    const next = Math.max(0, Math.min(Math.max(0, pages.length - 1), page + direction))
    sceneRef.current?.flip(() => {
      setPage(next)
      const fragment = pages[next]?.fragments[0]
      if (fragment) savePosition({ messageId: fragment.messageId, offset: fragment.offset })
    })
  }
  return <section className="space3d-stage" aria-label="TA 的空间" data-camera={mode}>
    <canvas ref={canvasRef} aria-label="书桌、左窗与背景墙" />
    <nav className="space3d-cameras" aria-label="查看机位">
      <button type="button" aria-pressed={mode === 'overview'} onClick={() => chooseMode('overview')}>总览</button>
      <button type="button" aria-pressed={mode === 'reading'} onClick={() => { arrange(null); chooseMode('reading') }}>阅读</button>
      <button type="button" aria-pressed={mode === 'drawer'} onClick={() => { arrange(null); chooseMode('drawer') }}>抽屉</button>
      <button type="button" aria-pressed={arranging} onClick={() => arranging ? arrange(null) : arrange('book')}>{arranging ? '完成' : '布置'}</button>
    </nav>
    {arranging && <p className="space3d-selection" aria-live="polite">{selected === 'book' ? '书' : selected === 'jar' ? '记忆罐' : selected === 'player' ? '播放器' : selected === 'photos' ? '照片板' : '抽屉'}已选中</p>}
    {mode === 'reading' && <div className="space3d-page-tools">
      <button type="button" disabled={page === 0} onClick={() => turn(-1)}>上一页</button>
      <span>{pages.length ? page + 1 : 0} / {pages.length}</span>
      <button type="button" disabled={page >= pages.length - 1} onClick={() => turn(1)}>下一页</button>
      <button type="button" onClick={() => setReader(true)}>聊天记录</button>
    </div>}
    <nav className="space3d-entrances" aria-label="空间入口">
      <button type="button" onClick={() => forwardOpen('photos')}>照片墙</button>
      <button type="button" onClick={() => forwardOpen('jar')}>记忆星星罐</button>
      <button type="button" onClick={() => forwardOpen('book')}>TA 的思绪</button>
      <button type="button" onClick={() => forwardOpen('player')}>一起听歌</button>
      <button type="button" onClick={() => forwardOpen('drawer')}>一周情书</button>
    </nav>
    {new URLSearchParams(location.search).get('space3dMetrics') === '1' && <output className="space3d-metrics">
      {JSON.stringify(metrics)}
    </output>}
    {reader && <ReadingOverlay messages={data.messages} onClose={() => setReader(false)} onPosition={savePosition} position={position} />}
  </section>
}
