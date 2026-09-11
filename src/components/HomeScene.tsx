import type { CSSProperties, ReactNode } from 'react'

export type HomeSceneId = 'morning' | 'day' | 'night'

export interface HomeSceneState {
  id: HomeSceneId
  greeting: string
}

export function getHomeScene(now: Date): HomeSceneState {
  const hour = now.getHours()
  if (hour >= 5 && hour < 12) return { id: 'morning', greeting: '早安。' }
  if (hour >= 12 && hour < 18) return { id: 'day', greeting: '今天也辛苦了。' }
  return { id: 'night', greeting: '夜深了。' }
}

export default function HomeScene({ scene, children }: { scene: HomeSceneState; children: ReactNode }) {
  const backgroundImage = `url("/home-scenes/${scene.id}.webp")`
  return (
    <div className={`home-page home-scene-${scene.id}`} style={{ '--home-scene-image': backgroundImage } as CSSProperties}>
      <div className="home-scene-overlay" aria-hidden="true" />
      {children}
    </div>
  )
}
