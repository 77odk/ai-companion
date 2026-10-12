export type Hit = 'photos' | 'jar' | 'book' | 'player' | 'drawer' | null
export interface GestureCallbacks {
  hit: (x: number, y: number) => Hit
  open: (hit: Hit) => void
  arrange: (hit: Hit) => void
  orbit: (dx: number, dy: number) => void
  zoom: (ratio: number) => void
  isArranging: () => boolean
}
/** Pointer capture fixes the operation and initial hit for this gesture. */
export function bindGestures(canvas: HTMLCanvasElement, callbacks: GestureCallbacks) {
  const pointers = new Map<number, { x: number; y: number }>()
  let active: { id: number; x: number; y: number; lastX: number; lastY: number; time: number;
    hit: Hit; operation: 'pending' | 'orbit' | 'selected' | 'cancelled'; maxDistance: number } | null = null
  let longPress: ReturnType<typeof setTimeout> | null = null
  let pinchDistance = 0
  const clearLong = () => { if (longPress) clearTimeout(longPress); longPress = null }
  const cancel = () => {
    clearLong()
    const ids = [...pointers.keys()]
    pointers.clear(); active = null; pinchDistance = 0
    for (const id of ids) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id)
  }
  const distance = () => { const p = [...pointers.values()]; return p.length === 2 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0 }
  const down = (event: PointerEvent) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    canvas.setPointerCapture(event.pointerId)
    if (pointers.size > 1) {
      clearLong(); if (active) active.operation = 'cancelled'; pinchDistance = distance(); return
    }
    const hit = callbacks.hit(event.clientX, event.clientY)
    active = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX,
      lastY: event.clientY, time: performance.now(), hit, operation: 'pending', maxDistance: 0 }
    if (hit) longPress = setTimeout(() => {
      if (!active || active.maxDistance > 8 || active.operation !== 'pending') return
      active.operation = 'selected'; callbacks.arrange(hit)
    }, 500)
  }
  const move = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.size === 2) {
      const next = distance()
      if (pinchDistance > 0) callbacks.zoom(next / pinchDistance)
      pinchDistance = next; return
    }
    if (!active || active.id !== event.pointerId) return
    active.maxDistance = Math.max(active.maxDistance, Math.hypot(event.clientX - active.x, event.clientY - active.y))
    if (active.maxDistance > 8) clearLong()
    if (active.operation === 'pending' && active.maxDistance > 10) {
      active.operation = callbacks.isArranging() || active.hit ? 'selected' : 'orbit'
      if (callbacks.isArranging() && active.hit) callbacks.arrange(active.hit)
    }
    if (active.operation === 'orbit') callbacks.orbit(event.clientX - active.lastX, event.clientY - active.lastY)
    // Selected objects stay fixed in phase 1. This branch owns the future drag gesture.
    active.lastX = event.clientX; active.lastY = event.clientY
  }
  const up = (event: PointerEvent) => {
    clearLong()
    if (active?.id === event.pointerId && active.operation === 'pending') {
      const elapsed = performance.now() - active.time
      const displaced = Math.max(active.maxDistance, Math.hypot(event.clientX - active.x, event.clientY - active.y))
      if (displaced <= 8 && elapsed <= 300) {
        if (callbacks.isArranging()) callbacks.arrange(active.hit)
        else callbacks.open(active.hit)
      }
    }
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    pointers.delete(event.pointerId); active = null; pinchDistance = 0
  }
  const hidden = () => { if (document.hidden) cancel() }
  const lostCapture = (event: PointerEvent) => { if (pointers.has(event.pointerId)) cancel() }
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', cancel)
  canvas.addEventListener('lostpointercapture', lostCapture)
  document.addEventListener('visibilitychange', hidden)
  window.addEventListener('blur', cancel)
  return () => {
    cancel(); canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move)
    canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', cancel)
    canvas.removeEventListener('lostpointercapture', lostCapture)
    document.removeEventListener('visibilitychange', hidden); window.removeEventListener('blur', cancel)
  }
}
