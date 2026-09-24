import { useEffect, useRef } from 'react'

const PARTICLE_COUNT = 22
const TARGET_FPS = 30
const FRAME_INTERVAL = 1000 / TARGET_FPS

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  phase: number
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
        vx: (seeded(index, 3) - 0.5) * 0.09,
        vy: (seeded(index, 4) - 0.5) * 0.055,
        r: 0.8 + seeded(index, 5) * 1.5,
        phase: seeded(index, 6) * Math.PI * 2,
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
      draw(performance.now(), false)
    }

    const draw = (time: number, animate = true) => {
      ctx.clearRect(0, 0, width, height)

      const reduce = reducedMotion.matches
      const drift = reduce || !animate ? 0 : 1

      for (const particle of particles) {
        if (drift) {
          particle.x += particle.vx
          particle.y += particle.vy
          if (particle.x < -12) particle.x = width + 12
          if (particle.x > width + 12) particle.x = -12
          if (particle.y < -12) particle.y = height + 12
          if (particle.y > height + 12) particle.y = -12
        }

        const pulse = reduce ? 0.55 : 0.46 + Math.sin(time * 0.0008 + particle.phase) * 0.13
        ctx.beginPath()
        ctx.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255, 243, 238, ${Math.max(0.08, pulse * 0.34)})`
        ctx.fill()
      }

      // Sparse "memory relation" lines: nearest neighbors only, deliberately faint.
      for (let i = 0; i < particles.length; i += 1) {
        const a = particles[i]
        let closest = -1
        let closestDistance = 116

        for (let j = i + 1; j < particles.length; j += 1) {
          const b = particles[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const distance = Math.hypot(dx, dy)
          if (distance < closestDistance) {
            closestDistance = distance
            closest = j
          }
        }

        if (closest >= 0 && i % 3 === 0) {
          const b = particles[closest]
          const alpha = (1 - closestDistance / 116) * 0.12
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.strokeStyle = `rgba(207, 138, 131, ${alpha})`
          ctx.lineWidth = 0.75
          ctx.stroke()
        }
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
        draw(performance.now(), false)
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
    if (reducedMotion.matches) draw(performance.now(), false)
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
