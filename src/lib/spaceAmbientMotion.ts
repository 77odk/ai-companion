/**
 * Space V2 · small deterministic animation core, no runtime imports.
 *
 * Preparatory motion only. Do not mount independent plant/drawer images
 * until the baked background has been cleaned and visual QA passes.
 */
export type SpaceMotionQuality = 'off' | 'low' | 'full'

export interface SpaceMotionEnvironment {
  visible: boolean
  reducedMotion: boolean
  lowPower: boolean
  meanFrameMs?: number
}

export interface SpaceWindSample {
  /** Signed, dimensionless shared wind in [-1, 1]. */
  wind: number
  /** Short, non-repeating-seeming gust envelope in [0, 1]. */
  gust: number
  /** Root-to-tip joint rotation, degrees. */
  plantDegrees: readonly [number, number, number]
  /** Minimal three-control-point paper bend, in art-plane pixels. */
  paperOffsets: readonly [number, number, number]
}

const TAU = 2 * Math.PI
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const smooth = (n: number) => {
  const x = clamp01(n)
  return x * x * (3 - 2 * x)
}

/**
 * A single environment-wide wind; never create a physics engine per object.
 * It has two slow components and a short eased gust about once every 23 s.
 * Seed shifts phase only, so a scene stays deterministic in tests/replay.
 */
export function sampleSpaceWind(
  elapsedMs: number,
  seed = 0,
  quality: SpaceMotionQuality = 'full',
): SpaceWindSample {
  const empty: SpaceWindSample = {
    wind: 0, gust: 0, plantDegrees: [0, 0, 0], paperOffsets: [0, 0, 0],
  }
  if (quality === 'off' || !Number.isFinite(elapsedMs) || !Number.isFinite(seed)) return empty

  const time = Math.max(0, elapsedMs) / 1000
  const t = time + seed * 1.73
  // The floor is only applied to local gust time; no discontinuity in the envelope.
  const period = 23.4
  const local = ((t % period) + period) % period
  const rise = smooth((local - 11.4) / 0.45)
  const fade = 1 - smooth((local - 12.25) / 1.25)
  const gust = rise * fade
  const base = 0.62 * Math.sin(t * TAU / 11.7)
    + 0.23 * Math.sin(t * TAU / 19.1 + 0.8)
  const wind = Math.max(-1, Math.min(1, base + 0.31 * gust))
  const amplitude = quality === 'low' ? 0.4 : 1
  const w = wind * amplitude
  const degrees: [number, number, number] = [
    w * 1.2, w * 2.35, w * 3.55,
  ]
  const paper: [number, number, number] = [
    w * 0.18, w * 0.64, w * 1.9,
  ]
  return { wind: w, gust: gust * amplitude, plantDegrees: degrees, paperOffsets: paper }
}

/** No battery API dependency; the host may supply a coarse power hint. */
export function selectSpaceMotionQuality(env: SpaceMotionEnvironment): SpaceMotionQuality {
  if (!env.visible || env.reducedMotion) return 'off'
  if (env.lowPower || (env.meanFrameMs != null && (!Number.isFinite(env.meanFrameMs) || env.meanFrameMs >= 43))) return 'low'
  return 'full'
}

/** Physics-free, time-based drawer easing. 0=closed, 1=open. */
export function advanceSpaceDrawer(
  current: number, target: number, deltaMs: number, reducedMotion = false,
): number {
  if (![current, target, deltaMs].every(Number.isFinite)) return clamp01(Number.isFinite(current) ? current : 0)
  const goal = clamp01(target)
  if (reducedMotion) return goal
  if (deltaMs <= 0) return clamp01(current)
  // Time-step independent (no different speed at 12/30/60fps).
  const next = clamp01(current) + (goal - clamp01(current)) * (1 - Math.exp(-Math.min(deltaMs, 1000) / 145))
  return Math.abs(next - goal) < 0.001 ? goal : clamp01(next)
}

/** Shared frame pacing: 30fps max full, 12fps max low, no work when off. */
export function shouldPaintSpaceFrame(
  elapsedMs: number,
  lastPaintMs: number,
  quality: SpaceMotionQuality,
): boolean {
  if (quality === 'off' || !Number.isFinite(elapsedMs)) return false
  if (!Number.isFinite(lastPaintMs)) return true
  if (elapsedMs < lastPaintMs) return true
  return elapsedMs - lastPaintMs >= (quality === 'low' ? 1000 / 12 : 1000 / 30)
}
