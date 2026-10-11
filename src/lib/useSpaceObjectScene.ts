import { useEffect, useState } from 'react'
import { preloadSpaceLayer, getPreloadedSpaceLayerReady, invalidateSpaceLayerReady } from './spaceSceneAssets'

/** Detail artwork follows the same approval/resource gate as the room. */
export function useSpaceObjectScene() {
  const [ready, setReady] = useState(getPreloadedSpaceLayerReady)
  useEffect(() => {
    let alive = true
    void preloadSpaceLayer().then(value => { if (alive) setReady(value) })
    return () => { alive = false }
  }, [])
  return { ready, fail: () => { invalidateSpaceLayerReady(); setReady(false) } }
}
