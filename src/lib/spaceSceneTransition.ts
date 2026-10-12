import { flushSync } from 'react-dom'

/** The same native room image moves between the world camera and object camera.
 * Navigation still uses the existing callbacks; no content or state is copied. */
export function transitionSpaceScene(open: () => void): void {
  if (!document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    open()
    return
  }
  const transition = document.startViewTransition(() => flushSync(open))
  // Snapshot support varies by browser/GPU. Navigation has already completed;
  // a skipped compositor animation must not become a page-level rejection.
  void transition.ready.catch(() => {})
  void transition.finished.catch(() => {})
}
