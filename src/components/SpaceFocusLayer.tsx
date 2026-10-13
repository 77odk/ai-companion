import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'

interface RoomFocus { register: (exit: () => void) => () => void }
const FocusContext = createContext<RoomFocus | null>(null)

/** Each object supplies the exit for its current depth (paper -> jar -> room).
 * The backdrop never shares an event target with an object or its controls. */
export function useSpaceDismiss(exit: () => void): boolean {
  const room = useContext(FocusContext)
  const latest = useRef(exit)
  useLayoutEffect(() => { latest.current = exit }, [exit])
  useEffect(() => room?.register(() => latest.current()), [room])
  return room !== null
}

export default function SpaceFocusLayer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const action = useRef(onClose)
  const close = useRef(onClose)
  useLayoutEffect(() => { close.current = onClose }, [onClose])
  const context = useMemo<RoomFocus>(() => ({ register(exit) {
    action.current = exit
    return () => { if (action.current === exit) action.current = () => close.current() }
  } }), [])
  useEffect(() => {
    const previous = document.activeElement
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); action.current() } }
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('keydown', escape); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  return <FocusContext.Provider value={context}>
    <div className="space-focus-layer" role="dialog" aria-modal="true" aria-label="房间物件近景">
      <button type="button" className="space-focus-dismiss" aria-label="返回上一层" onClick={() => action.current()} />
      {children}
      <span className="space-focus-instruction" aria-hidden="true">轻点物件外，退回上一层</span>
    </div>
  </FocusContext.Provider>
}
