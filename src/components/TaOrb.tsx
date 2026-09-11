import type { HomeSceneId } from './HomeScene'

export default function TaOrb({ label, scene, onActivate }: { label: string; scene: HomeSceneId; onActivate: () => void }) {
  const initial = Array.from(label.trim())[0] || 'TA'
  return (
    <button type="button" className={`ta-orb ta-orb-${scene}`} onClick={onActivate} aria-label={`和 ${label} 说说话`}>
      <svg viewBox="0 0 180 180" aria-hidden="true">
        <circle className="ta-orb-track" cx="90" cy="90" r="71" />
        <circle className="ta-orb-dot" cx="90" cy="19" r="3" />
        <circle className="ta-orb-core" cx="90" cy="90" r="53" />
      </svg>
      <span>{initial}</span>
    </button>
  )
}
