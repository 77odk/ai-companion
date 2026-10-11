import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { SPACE_LAYER_BASE } from '../lib/spaceSceneAssets'
import { SPACE_PLAYER_FRAME, SPACE_PLAYER_SCREEN, spaceObjectPlaneMatrix, type SpaceObjectFrame, type SpaceObjectQuad } from '../lib/spaceObjectFocus'

/** Native room pixels continue past the object, so transparent glass, contact
 * shadows and wires keep their original surrounding light and occlusion. */
export default function SpaceObjectScene({ frame, onError }: { frame: SpaceObjectFrame; onError: () => void }) {
  return <img className="space-object-native-room" alt="" aria-hidden="true" draggable={false}
    src={`${SPACE_LAYER_BASE}room-content-clean-v2.webp`} onError={onError}
    style={{ width: `${941 / frame.width * 100}%`, left: `${-frame.x / frame.width * 100}%`, top: `${-frame.y / frame.height * 100}%` }} />
}

export function SpacePlayerScreen({ children, className = 'listen-tablet' }: { children: ReactNode; className?: string }) {
  return <SpaceObjectPlane frame={SPACE_PLAYER_FRAME} corners={SPACE_PLAYER_SCREEN} className={className}>{children}</SpaceObjectPlane>
}

export function SpaceObjectPlane({ children, className, frame: objectFrame, corners }: {
  children: ReactNode; className: string; frame: SpaceObjectFrame; corners: SpaceObjectQuad
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [transform, setTransform] = useState<CSSProperties>({ visibility: 'hidden' })
  useEffect(() => {
    const node = ref.current
    const frame = node?.parentElement
    if (!frame) return
    const resize = () => {
      const { width, height } = frame.getBoundingClientRect()
      if (width > 0 && height > 0) setTransform({ transform: `matrix3d(${spaceObjectPlaneMatrix(width, height, objectFrame, corners).join(',')})` })
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    observer?.observe(frame)
    window.addEventListener('resize', resize)
    resize()
    return () => { observer?.disconnect(); window.removeEventListener('resize', resize) }
  }, [objectFrame, corners])
  return <div ref={ref} className={`${className} is-native-plane`} style={transform}>{children}</div>
}
