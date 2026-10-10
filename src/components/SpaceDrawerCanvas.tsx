import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { SPACE_LAYER_BASE } from '../lib/spaceSceneAssets'
import { drawerFrameProgress, paintSpaceDrawer, SPACE_DRAWER_ART_ROI, type SpaceDrawerArt } from '../lib/spaceDrawerComposite'

export interface SpaceDrawerController {
  /** Pointer preview in 0..1 scene-progress coordinates. No storage writes. */
  paint: (progress: number) => void
  reset: () => void
}

interface Props {
  opening: boolean
  returning: boolean
  controllerRef: MutableRefObject<SpaceDrawerController | null>
}

/** Motion is restricted to the drawer's 514×363 ROI, never the fixed desktop. */
export default function SpaceDrawerCanvas({ opening, returning, controllerRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const artRef = useRef<SpaceDrawerArt | null>(null)
  const paintedRef = useRef(0)
  const [ready, setReady] = useState(false)

  const paint = useCallback((progress: number) => {
    const canvas = canvasRef.current
    const art = artRef.current
    if (!canvas || !art) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const clamped = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0
    paintedRef.current = clamped
    paintSpaceDrawer(ctx, art, clamped)
  }, [])

  useEffect(() => {
    let alive = true
    const filenames = ['e_drawer_pixel_trial_v1.webp', 'c_drawer_inner_trial_v1.webp']
    void Promise.all(filenames.map((filename) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => image.naturalWidth > 0 ? resolve(image) : reject(new Error('Invalid sprite'))
      image.onerror = () => reject(new Error('Missing sprite'))
      image.src = SPACE_LAYER_BASE + filename
    }))).then(([face, interior]) => {
      if (!alive) return
      artRef.current = { face, interior }
      setReady(true)
    }).catch(() => {
      // Fail closed: the clickable weekly-letter entry stays available.
      if (alive) { artRef.current = null; setReady(false) }
    })
    return () => { alive = false; artRef.current = null }
  }, [])

  useEffect(() => {
    if (!ready) return
    controllerRef.current = { paint, reset: () => paint(0) }
    return () => { controllerRef.current = null }
  }, [ready, paint, controllerRef])

  useEffect(() => {
    if (!ready) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (!opening && !returning) {
      paint(0)
      return
    }
    const start = opening ? paintedRef.current : 1
    const finish = opening ? 1 : 0
    if (reduce || document.hidden) {
      paint(finish)
      return
    }
    const duration = opening ? 760 : 620
    let frame = 0
    let started = -1
    let lastPainted = -Infinity
    let lastFrame = -1
    let smoothedFrameMs = 16.7
    const update = (now: number) => {
      if (started < 0) started = now
      const elapsed = now - started
      if (lastFrame >= 0) smoothedFrameMs = smoothedFrameMs * .85 + (now - lastFrame) * .15
      lastFrame = now
      // 30fps normally, 12fps if the device is already struggling.
      // Never call the full scene renderer or spawn independent physics.
      const frameInterval = smoothedFrameMs > 43 ? 1000 / 12 : 1000 / 30
      if (now - lastPainted >= frameInterval || elapsed >= duration) {
        const eased = drawerFrameProgress(elapsed, duration)
        paint(start + (finish - start) * eased)
        lastPainted = now
      }
      if (elapsed < duration && !document.hidden) frame = window.requestAnimationFrame(update)
      else paint(finish)
    }
    frame = window.requestAnimationFrame(update)
    return () => { if (frame) window.cancelAnimationFrame(frame) }
  }, [ready, opening, returning, paint])

  return (
    <canvas
      ref={canvasRef}
      className="space-v2-drawer-canvas"
      width={SPACE_DRAWER_ART_ROI.width}
      height={SPACE_DRAWER_ART_ROI.height}
      aria-hidden="true"
    />
  )
}
