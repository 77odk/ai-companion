import { useEffect, useRef } from 'react'

const PARTICLE_COUNT = 18
const TARGET_FPS = 24
const FRAME_INTERVAL = 1000 / TARGET_FPS

type Particle = {
  x: number
  y: number
  r: number
  phase: number
  speed: number
  warmth: number
  sparkle: boolean
}

function seeded(index: number, salt: number) {
  const value = Math.sin(index * 9283.17 + salt * 97.31) * 43758.5453
  return value - Math.floor(value)
}

export default function ProductIntroAtmosphere() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const host = canvas?.parentElement
    if (!canvas || !host) return

    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let particles: Particle[] = []
    let width = 0
    let height = 0
    let dpr = 1
    let raf = 0
    let lastFrame = 0
    let visible = true
    let pageVisible = !document.hidden

    const buildParticles = () => {
      particles = Array.from({ length: PARTICLE_COUNT }, (_, index) => ({
        x: seeded(index, 1) * width,
        y: seeded(index, 2) * height,
        r: 0.65 + seeded(index, 3) * 1.15,
        phase: seeded(index, 4) * Math.PI * 2,
        speed: 0.00022 + seeded(index, 5) * 0.00026,
        warmth: seeded(index, 6),
        sparkle: index % 4 === 0,
      }))
    }

    const resize = () => {
      const rect = host.getBoundingClientRect()
      width = Math.max(1, Math.round(rect.width))
      height = Math.max(1, Math.round(rect.height))
      dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      buildParticles()
      draw(performance.now())
    }

    const draw = (time: number) => {
      ctx.clearRect(0, 0, width, height)

      for (const particle of particles) {
        const wave = reducedMotion.matches
          ? 0.42
          : 0.5 + Math.sin(time * particle.speed + particle.phase) * 0.5
        const pulse = Math.pow(Math.max(0, wave), 2.2)
        const alpha = 0.08 + pulse * 0.34
        const cream = particle.warmth > 0.48

        ctx.save()
        ctx.translate(particle.x, particle.y)

        ctx.beginPath()
        ctx.arc(0, 0, particle.r + pulse * 0.5, 0, Math.PI * 2)
        ctx.fillStyle = cream
          ? `rgba(255, 248, 240, ${alpha})`
          : `rgba(255, 218, 207, ${alpha * 0.88})`
        ctx.fill()

        if (particle.sparkle && pulse > 0.56) {
          const arm = 2.8 + pulse * 2.4
          ctx.beginPath()
          ctx.moveTo(-arm, 0)
          ctx.lineTo(arm, 0)
          ctx.moveTo(0, -arm)
          ctx.lineTo(0, arm)
          ctx.strokeStyle = `rgba(255, 248, 240, ${(pulse - 0.42) * 0.42})`
          ctx.lineWidth = 0.55
          ctx.stroke()
        }

        ctx.restore()
      }
    }

    const loop = (time: number) => {
      raf = 0
      if (!visible || !pageVisible || reducedMotion.matches) return
      if (time - lastFrame >= FRAME_INTERVAL) {
        lastFrame = time
        draw(time)
      }
      raf = window.requestAnimationFrame(loop)
    }

    const start = () => {
      if (raf || !visible || !pageVisible || reducedMotion.matches) return
      raf = window.requestAnimationFrame(loop)
    }

    const stop = () => {
      if (raf) window.cancelAnimationFrame(raf)
      raf = 0
    }

    const handleVisibility = () => {
      pageVisible = !document.hidden
      if (pageVisible) start()
      else stop()
    }

    const handleMotion = () => {
      if (reducedMotion.matches) {
        stop()
        draw(performance.now())
      } else {
        start()
      }
    }

    const observer = new IntersectionObserver(
      entries => {
        visible = entries[0]?.isIntersecting ?? true
        if (visible) start()
        else stop()
      },
      { threshold: 0.01 },
    )

    const resizeObserver = new ResizeObserver(resize)

    observer.observe(host)
    resizeObserver.observe(host)
    document.addEventListener('visibilitychange', handleVisibility)
    reducedMotion.addEventListener('change', handleMotion)

    resize()
    if (reducedMotion.matches) draw(performance.now())
    else start()

    return () => {
      stop()
      observer.disconnect()
      resizeObserver.disconnect()
      document.removeEventListener('visibilitychange', handleVisibility)
      reducedMotion.removeEventListener('change', handleMotion)
    }
  }, [])

  return <canvas ref={canvasRef} className="intro-atmosphere" aria-hidden="true" />
}
