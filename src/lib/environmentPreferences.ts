/** View preferences share the existing settings record; never touch content storage. */
const SETTINGS_KEY = 'ai_companion_settings'
export interface ReadingPosition { messageId: string; offset: number }
interface Preferences {
  space3d?: boolean
  environmentFeedback?: boolean
  reading?: Record<string, ReadingPosition>
}
export function readEnvironmentPreferences(): Preferences {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}').spaceEnvironment ?? {} }
  catch { return {} }
}
export function saveEnvironmentPreferences(patch: Partial<Preferences>): void {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...raw,
      spaceEnvironment: { ...readEnvironmentPreferences(), ...patch },
    }))
    window.dispatchEvent(new Event('eluvin-environment-preferences'))
  } catch { /* An unavailable preference store must never block an entrance. */ }
}
