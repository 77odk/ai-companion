import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

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
  const [loadedScene, setLoadedScene] = useState<HomeSceneId | null>(null)

  useEffect(() => {
    let active = true
    const image = new Image()

    setLoadedScene(null)
    image.onload = () => {
      if (active) setLoadedScene(scene.id)
    }
    image.onerror = () => {
      if (active) setLoadedScene(null)
    }
    image.src = `/home-scenes/${scene.id}.webp`

    return () => {
      active = false
      image.onload = null
      image.onerror = null
    }
  }, [scene.id])

  const style = loadedScene === scene.id
    ? { '--home-scene-image': `url("/home-scenes/${scene.id}.webp")` } as CSSProperties
    : undefined

  return (
    <div className={`home-page home-scene-${scene.id}`} style={style}>
      <div className="home-scene-overlay" aria-hidden="true" />
      {children}
    </div>
  )
}
