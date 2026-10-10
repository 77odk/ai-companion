import { useEffect, useRef, type MutableRefObject } from 'react'
import { SPACE_LAYER_BASE } from '../lib/spaceSceneAssets'
import { sampleSpaceWind, selectSpaceMotionQuality, shouldPaintSpaceFrame } from '../lib/spaceAmbientMotion'
import { isHomeWeatherEnabled, loadHomeWeather, type HomeWeather } from '../lib/homeWeather'
import { loadUserProfile } from '../lib/storage'

const BRANCHES = [
  { x: 0, y: 0, width: 400, height: 735, phase: 0, gain: 1 },
  { x: 780, y: 750, width: 161, height: 300, phase: .27, gain: .45 },
] as const

/** Native foliage pixels, bent along the branch rather than translating a
 * rectangular sprite. Only these two local regions are painted at 12/30fps.
 * The separately restored wall is mandatory; never animate over baked leaves. */
export default function SpaceFoliageCanvas({ scenePageRef }: {
  scenePageRef: MutableRefObject<HTMLDivElement | null>
}) {
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([])
  useEffect(() => {
    const host = scenePageRef.current
    if (!host) return
    let alive = true
    let frame = 0
    let weather: HomeWeather | null = null
    let lastPaint = -Infinity
    let frameMs = 16.7
    let lastFrame = 0
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    const load = (name: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = reject
      im.src = SPACE_LAYER_BASE + name
    })
    const refreshWeather = () => {
      if (document.hidden || !isHomeWeatherEnabled()) { weather = null; return }
      const city = loadUserProfile().city?.trim()
      if (!city) { weather = null; return }
      void loadHomeWeather(city).then(value => {
        if (alive) {
          weather = value && Date.now() - value.fetchedAt < 30 * 60_000 ? value : null
          if (reduce.matches && layers.length) draw(0, 'off')
        }
      })
    }
    let layers: Array<{ leaves: HTMLCanvasElement }> = []
    const draw = (elapsed: number, quality: 'off' | 'low' | 'full') => {
      const rainy = Boolean(weather && Date.now() - weather.fetchedAt < 30 * 60_000 && ['drizzle', 'rain', 'thunder'].includes(weather.visual))
      const strength = rainy ? 1 : .32
      host.dataset.spaceEnvironment = rainy ? 'rain' : 'neutral'
      const paper = sampleSpaceWind(elapsed, 0, quality)
      host.style.setProperty('--space-paper-wind', `${paper.paperOffsets[2] * strength * .3}deg`)
      layers.forEach(({ leaves }, index) => {
        const canvas = canvasRefs.current[index]
        const ctx = canvas?.getContext('2d')
        if (!ctx) return
        ctx.clearRect(0, 0, leaves.width, leaves.height)
        const branch = BRANCHES[index]
        const wind = sampleSpaceWind(Math.max(0, elapsed - branch.phase * 1000), 0, quality)
        const tip = wind.plantDegrees[2] * branch.gain * strength
        const offset = (y: number) => tip * (y / leaves.height) ** 1.65
        const rows = 36
        for (let row = 0; row < rows; row++) {
          const y = Math.round(row * leaves.height / rows)
          const height = Math.round((row + 1) * leaves.height / rows) - y
          const shear = (offset(y + height) - offset(y)) / height
          ctx.save()
          // Clip destination pixels before deforming the full bitmap. Cropping
          // fractional source strips filters their edges against transparency,
          // leaving horizontal seams that are especially visible at mobile DPR.
          ctx.beginPath()
          ctx.rect(0, y, leaves.width, height)
          ctx.clip()
          ctx.transform(1, 0, shear, 1, offset(y) - shear * y, 0)
          ctx.drawImage(leaves, 0, 0)
          ctx.restore()
        }
      })
    }
    const start = performance.now()
    const tick = (now: number) => {
      frame = 0
      if (!alive) return
      // Media-query change events can arrive after the next animation tick.
      // Stop all scene motion and restore the neutral foliage pose together,
      // even when the browser notices the preference before its event fires.
      if (document.hidden || reduce.matches) { resume(); return }
      if (lastFrame) frameMs = frameMs * .85 + (now - lastFrame) * .15
      lastFrame = now
      const quality = selectSpaceMotionQuality({ visible: true, reducedMotion: false, lowPower: false, meanFrameMs: frameMs })
      if (shouldPaintSpaceFrame(now, lastPaint, quality)) { draw(now - start, quality); lastPaint = now }
      frame = requestAnimationFrame(tick)
    }
    const resume = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      lastFrame = 0
      lastPaint = -Infinity
      host.dataset.spaceMotion = document.hidden || reduce.matches ? 'off' : 'on'
      if (!layers.length) return
      refreshWeather()
      if (document.hidden || reduce.matches) draw(0, 'off')
      else frame = requestAnimationFrame(tick)
    }
    void Promise.all([load('room-content-clean-v2.webp'), load('room-foliage-restored-v2.webp'), load('foliage-alpha-v2.webp')]).then(([original, , matte]) => {
      if (!alive) return
      layers = BRANCHES.map(branch => {
        const leaves = document.createElement('canvas')
        leaves.width = branch.width
        leaves.height = branch.height
        const leafCtx = leaves.getContext('2d')!
        leafCtx.drawImage(original, branch.x, branch.y, branch.width, branch.height, 0, 0, branch.width, branch.height)
        // Use the repaired alpha only. All visible leaf colors/material still
        // come from the reference-aligned plate, including pale sunlit leaves
        // and thin stems that color-key subtraction used to destroy.
        leafCtx.globalCompositeOperation = 'destination-in'
        leafCtx.drawImage(matte, branch.x, branch.y, branch.width, branch.height, 0, 0, branch.width, branch.height)
        leafCtx.globalCompositeOperation = 'source-over'
        return { leaves }
      })
      draw(0, 'off')
      // The restored wall must be one continuous room plate, never two local
      // rectangles whose repaired lighting differs from the original pixels.
      host.dataset.spaceFoliageReady = 'true'
      resume()
    }).catch(() => {
      // The original content-clean backplate stays visible on load failure.
      for (const canvas of canvasRefs.current) canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    })
    document.addEventListener('visibilitychange', resume)
    reduce.addEventListener('change', resume)
    const weatherTimer = window.setInterval(refreshWeather, 60_000)
    return () => {
      alive = false
      cancelAnimationFrame(frame)
      window.clearInterval(weatherTimer)
      document.removeEventListener('visibilitychange', resume)
      reduce.removeEventListener('change', resume)
      delete host.dataset.spaceMotion
      delete host.dataset.spaceEnvironment
      delete host.dataset.spaceFoliageReady
      host.style.removeProperty('--space-paper-wind')
    }
  }, [scenePageRef])
  return <><img className="space-scene-backplate is-foliage-restored"
    src={`${SPACE_LAYER_BASE}room-foliage-restored-v2.webp`} alt="" aria-hidden="true" draggable={false} />
    {BRANCHES.map((branch, index) => (
    <canvas key={index} ref={value => { canvasRefs.current[index] = value }}
      className="space-foliage-canvas" width={branch.width} height={branch.height}
      style={{ left: `${branch.x / 941 * 100}%`, top: `${branch.y / 1672 * 100}%`, width: `${branch.width / 941 * 100}%`, height: `${branch.height / 1672 * 100}%` }}
      aria-hidden="true" />
  ))}</>
}
