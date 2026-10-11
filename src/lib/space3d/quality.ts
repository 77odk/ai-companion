export type QualityStep = 0 | 1 | 2 | 3 | 4
/** Only sample consecutive rendered frames; idle/background time is not slow rendering. */
export class QualityMonitor {
  step: QualityStep = 0
  private elapsed = 0
  private frames = 0
  sample(frameMs: number): QualityStep {
    if (!Number.isFinite(frameMs) || frameMs <= 0) return this.step
    this.elapsed += frameMs
    this.frames++
    if (this.elapsed >= 3000) {
      if (this.frames * 1000 / this.elapsed < 25 && this.step < 4) this.step = (this.step + 1) as QualityStep
      this.resetWindow()
    }
    return this.step
  }
  resetWindow() { this.elapsed = 0; this.frames = 0 }
}

export function qualitySettings(step: QualityStep, lowEnd = false, highEnd = false) {
  return { shadows: step === 0, shadowSize: lowEnd ? 512 : 1024,
    dprLimit: step >= 2 || lowEnd ? 1 : 1.5,
    particles: step < 3, wind: step < 3,
    rainCount: lowEnd ? 60 : highEnd ? 200 : 120, snowCount: lowEnd ? 30 : highEnd ? 100 : 60,
    fallback: step >= 4 }
}
