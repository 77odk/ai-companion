import { useEffect, useState } from 'react'
import type { HomeSceneId } from './HomeScene'

export default function TaOrb({ label, scene, avatar }: { label: string; scene: HomeSceneId; avatar?: string }) {
  const initial = Array.from(label.trim())[0] || 'TA'
  const [imageFailed, setImageFailed] = useState(false)
  useEffect(() => setImageFailed(false), [avatar])
  return (
    <div className={`ta-orb ta-orb-${scene}`} aria-label={`${label} 的头像`} role="img">
      <svg viewBox="0 0 180 180" aria-hidden="true">
        <circle className="ta-orb-track" cx="90" cy="90" r="71" />
        <circle className="ta-orb-dot" cx="90" cy="19" r="3" />
        <circle className="ta-orb-core" cx="90" cy="90" r="53" />
      </svg>
      <span>{avatar && !imageFailed ? <img src={avatar} alt="" onError={() => setImageFailed(true)} /> : initial}</span>
    </div>
  )
}
