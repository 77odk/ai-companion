import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { SPACE_LAYER_BASE } from '../lib/spaceSceneAssets'
import { spaceObjectScreenMatrix, type SpaceObjectFrame } from '../lib/spaceObjectFocus'

/** Native room pixels continue past the object, so transparent glass, contact
 * shadows and wires keep their original surrounding light and occlusion. */
export default function SpaceObjectScene({ frame, onError }: { frame: SpaceObjectFrame; onError: () => void }) {
  return <img className="space-object-native-room" alt="" aria-hidden="true" draggable={false}
    src={`${SPACE_LAYER_BASE}room-content-clean-v2.webp`} onError={onError}
    style={{ width: `${941 / frame.width * 100}%`, left: `${-frame.x / frame.width * 100}%`, top: `${-frame.y / frame.height * 100}%` }} />
}

export function SpacePlayerScreen({ children, className = 'listen-tablet' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [transform, setTransform] = useState<CSSProperties>({ visibility: 'hidden' })
  useEffect(() => {
    const node = ref.current
    const frame = node?.parentElement
    if (!frame) return
    const resize = () => {
      const { width, height } = frame.getBoundingClientRect()
      if (width > 0 && height > 0) setTransform({ transform: `matrix3d(${spaceObjectScreenMatrix(width, height).join(',')})` })
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    observer?.observe(frame)
    window.addEventListener('resize', resize)
    resize()
    return () => { observer?.disconnect(); window.removeEventListener('resize', resize) }
  }, [])
  return <div ref={ref} className={`${className} is-native-plane`} style={transform}>{children}</div>
}
