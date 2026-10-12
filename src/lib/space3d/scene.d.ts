import type { EnvironmentState } from '../environment'
import type { Hit } from './interaction'
import type { qualitySettings } from './quality'
type Quality = ReturnType<typeof qualitySettings>
export interface SceneMetrics {
  fps: number | null; calls: number; triangles: number; dpr: number; renderedFrames: number;
  mode: string; shadowType: string; quality: string; pageWidth: number; source: string
}
export interface SpaceScene {
  setEnvironment: (value: EnvironmentState) => void
  mode: (value: string) => void
  orbit: (dx: number, dy: number) => void
  zoom: (ratio: number) => void
  arrange: (hit: Hit) => void
  hit: (x: number, y: number) => Hit
  anchor: (hit: Hit) => { x: number; y: number } | null
  quality: (value: Quality) => void
  reduced: (value: boolean) => void
  pages: (canvases: HTMLCanvasElement[]) => Promise<void>
  flip: (done: () => void) => void
  snapshot: (data: unknown) => void
  photos: (urls: string[]) => void
  stats: () => Record<string, number | boolean | string>
  resetMetrics: () => void
  dispose: () => void
}
export function createSpaceScene(canvas: HTMLCanvasElement, options: {
  reducedMotion: boolean; quality: Quality; onFailure: (reason: string) => void;
  onPause: () => void; onFrame: (ms: number) => void; onMetrics: (value: SceneMetrics) => void
}): SpaceScene
