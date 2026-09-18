/* Time Interaction Closure：移动端友好 Wheel Picker（纯展示交互组件）。
   原生 touch 滚动 + scroll-snap 自动吸附，无第三方依赖、无惯性引擎、无 timer。
   选中行 = 容器中线：滚动停止后由 scrollTop 反推索引，回传父组件；
   value 受外部控制（初始化回填 / 月份切换后 clamp 都会驱动本组件对齐滚动）。
   选中态不只靠颜色：加粗 + 字号 + aria-selected。 */
import { useCallback, useEffect, useRef } from 'react'

const ITEM_H = 44

interface TimeWheelProps {
  options: string[]
  value: string
  onChange: (v: string) => void
  ariaLabel: string
  visible?: number
  className?: string
}

export default function TimeWheel({ options, value, onChange, ariaLabel, visible = 5, className }: TimeWheelProps) {
  const ref = useRef<HTMLDivElement>(null)
  const lastIdx = useRef(-1)
  const drag = useRef<{ pointerId: number; startY: number; startTop: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const containerH = ITEM_H * visible
  const spacerH = (containerH - ITEM_H) / 2
  const idx = Math.max(0, options.indexOf(value))

  // 滚动 → rAF 节流 → 反推选中索引（scroll-snap 会把滚动停在最近 item 上）
  const handleScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    requestAnimationFrame(() => {
      const i = Math.max(0, Math.min(options.length - 1, Math.round(el.scrollTop / ITEM_H)))
      if (i !== lastIdx.current && options[i] !== undefined) {
        lastIdx.current = i
        onChange(options[i])
      }
    })
  }, [options, onChange])

  const selectIndex = useCallback((i: number, behavior: ScrollBehavior = 'smooth') => {
    const el = ref.current
    if (!el || options[i] === undefined) return
    lastIdx.current = i
    onChange(options[i])
    el.scrollTo({ top: i * ITEM_H, behavior })
  }, [options, onChange])

  // 桌面鼠标：按住上下拖动；触屏继续走原生滚动，不接管 pointer。
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    const el = ref.current
    if (!el) return
    drag.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startTop: el.scrollTop,
      moved: false,
    }
    el.setPointerCapture(e.pointerId)
    el.classList.add('is-dragging')
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current
    const state = drag.current
    if (!el || !state || state.pointerId !== e.pointerId) return
    const dy = e.clientY - state.startY
    if (Math.abs(dy) > 3) state.moved = true
    el.scrollTop = state.startTop - dy
    if (state.moved) e.preventDefault()
  }, [])

  const finishPointerDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current
    const state = drag.current
    if (!el || !state || state.pointerId !== e.pointerId) return
    suppressClick.current = e.type !== 'pointercancel' && state.moved
    drag.current = null
    el.classList.remove('is-dragging')
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    if (state.moved) {
      const i = Math.max(0, Math.min(options.length - 1, Math.round(el.scrollTop / ITEM_H)))
      selectIndex(i)
    }
  }, [options.length, selectIndex])

  const handleOptionClick = useCallback((i: number) => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    selectIndex(i)
  }, [selectIndex])

  // 外部 value 变化（回填 / 外部 clamp）→ 对齐滚动位置；相同索引不触发 onChange，无循环
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (Math.round(el.scrollTop / ITEM_H) !== idx) {
      el.scrollTo({ top: idx * ITEM_H, behavior: 'auto' })
    }
    lastIdx.current = idx
  }, [idx, options.length])

  return (
    <div
      className={`tw-col${className ? ` ${className}` : ''}`}
      ref={ref}
      role="listbox"
      aria-label={ariaLabel}
      onScroll={handleScroll}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerDrag}
      onPointerCancel={finishPointerDrag}
      style={{ height: containerH }}
    >
      <div className="tw-spacer" style={{ height: spacerH }} aria-hidden="true" />
      {options.map((o, i) => (
        <div
          key={o}
          role="option"
          aria-selected={o === value}
          className={`tw-item${o === value ? ' is-selected' : ''}`}
          onClick={() => handleOptionClick(i)}
        >
          {o}
        </div>
      ))}
      <div className="tw-spacer" style={{ height: spacerH }} aria-hidden="true" />
    </div>
  )
}
