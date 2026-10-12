import { useState, type CSSProperties } from 'react'
import { SPACE_LAYER_BASE } from '../lib/spaceSceneAssets'

/** Anchors are in the same world as the desk, not independent viewport pixels.
 * Core objects already painted into E are not repeated as second silhouettes. */
export const SPACE_DECOR = [
  { file: 'stacked_books.png', x: 608, y: -129, width: 158, height: 175, plane: 'shelf' },
  { file: 'wood_picture_frame.png', x: 712, y: 182, width: 105, height: 115, plane: 'wall' },
  { file: 'leafy_vine.png', x: 762, y: 35, width: 67, height: 137, plane: 'wall' },
  { file: 'ceramic_mug.png', x: 125, y: 1026, width: 84, height: 78, plane: 'desk' },
  { file: 'cat_ornament.png', x: 95, y: 1100, width: 142, height: 89, plane: 'desk' },
  { file: 'ceramic_tray.png', x: 305, y: 1094, width: 101, height: 54, plane: 'desk' },
  { file: 'drinking_glass.png', x: 242, y: 1093, width: 52, height: 83, plane: 'desk' },
] as const
const anchor = (x: number, y: number, width: number, height: number): CSSProperties => ({
  left: `${x / 941 * 100}%`, top: `${y / 1672 * 100}%`, width: `${width / 941 * 100}%`, height: `${height / 1672 * 100}%`,
})

export default function SpaceSceneDecor() {
  const [lamp, setLamp] = useState(false)
  return <div className={`space-scene-decor${lamp ? ' is-lamp-lit' : ''}`}>
    <span className="space-lamp-light" aria-hidden="true" />
    {SPACE_DECOR.map(item => <span key={item.file} className={`space-decor-item is-${item.plane}`} style={anchor(item.x,item.y,item.width,item.height)}>
      <img src={SPACE_LAYER_BASE + item.file} alt="" draggable={false} onError={event => { event.currentTarget.style.visibility = 'hidden' }} />
      {item.file === 'wood_picture_frame.png' && <img className="space-frame-botanical" src={SPACE_LAYER_BASE+'amber_flowers.png'} alt="" draggable={false} />}
      {item.file === 'ceramic_tray.png' && <><img className="space-tray-fold is-coral" src={SPACE_LAYER_BASE+'origami_coral.png'} alt="" draggable={false} /><img className="space-tray-fold is-pattern" src={SPACE_LAYER_BASE+'origami_red_pattern.png'} alt="" draggable={false} /></>}
    </span>)}
    <button type="button" className="space-decor-item space-lamp" style={anchor(443,840,113,158)} aria-label={lamp ? '关闭台灯' : '点亮台灯'} aria-pressed={lamp} onClick={() => setLamp(!lamp)}>
      <img src={SPACE_LAYER_BASE + 'table_lamp.png'} alt="" draggable={false} />
    </button>
  </div>
}
