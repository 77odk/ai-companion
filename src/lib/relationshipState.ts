import {
  enqueueCloudStateOp,
  getCloudStateSidecar,
  getCloudStateVersion,
  registerCloudStateAdapter,
  requestCloudStateSync,
  setCloudStateSidecar,
  type CloudStateEntity,
} from './cloudState.ts'
import { notifyDataChanged } from './dataChange.ts'
import { getEvents } from './eventStore.ts'
import { getSessionsCache } from './sessionStore.ts'
import { getAccount } from './sync.ts'

export const RELATIONSHIP_PRESETS = [
  '恋人',
  '兄妹',
  '家人',
  '偶像与粉丝',
  '宿敌',
  '主仆',
  '师生',
  '原作角色与你的 OC',
  '自定义',
] as const

export type RelationshipPreset = (typeof RELATIONSHIP_PRESETS)[number]

export interface RelationshipSetting {
  sessionId: string
  preset?: RelationshipPreset
  customLabel?: string
  updatedAt: number
}

export interface RelationshipView {
  settingLabel: string
  description: string
  hasExplicitSetting: boolean
}

const KIND = 'relationship_setting'
const SIDECAR = 'relationship_setting_v1'

function readMap(): Record<string, RelationshipSetting> {
  const raw = getCloudStateSidecar<Record<string, RelationshipSetting>>(SIDECAR)
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {}
}

function validSetting(value: unknown, sessionId?: string): RelationshipSetting | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Partial<RelationshipSetting>
  if (typeof item.sessionId !== 'string' || (sessionId && item.sessionId !== sessionId)) return null
  if (item.preset != null && !RELATIONSHIP_PRESETS.includes(item.preset as RelationshipPreset)) return null
  if (item.customLabel != null && typeof item.customLabel !== 'string') return null
  if (typeof item.updatedAt !== 'number' || !Number.isFinite(item.updatedAt)) return null
  return item as RelationshipSetting
}

function opId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `relationship-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function queueCloud(item: RelationshipSetting): void {
  const account = getAccount()
  if (!account || !item.sessionId) return
  enqueueCloudStateOp({
    opId: opId(),
    kind: KIND,
    entityId: item.sessionId,
    sessionId: item.sessionId,
    baseVersion: getCloudStateVersion(KIND, item.sessionId, undefined, item.sessionId),
    payload: item,
  })
  requestCloudStateSync()
}

export function loadRelationshipSetting(sessionId?: string): RelationshipSetting | null {
  const sid = String(sessionId ?? '').trim()
  if (!sid) return null
  return validSetting(readMap()[sid], sid)
}

export function saveRelationshipSetting(
  sessionId: string,
  preset?: RelationshipPreset,
  customLabel?: string,
): RelationshipSetting | null {
  const sid = String(sessionId ?? '').trim()
  if (!sid) return null
  const cleanCustom = String(customLabel ?? '').trim().slice(0, 40)
  const next: RelationshipSetting = {
    sessionId: sid,
    ...(preset ? { preset } : {}),
    ...(preset === '自定义' && cleanCustom ? { customLabel: cleanCustom } : {}),
    updatedAt: Date.now(),
  }
  const map = readMap()
  map[sid] = next
  if (!setCloudStateSidecar(SIDECAR, map)) return null
  notifyDataChanged()
  queueCloud(next)
  return next
}

function daysKnown(sessionId: string, now: number): number {
  const session = getSessionsCache().find((item) => String(item.id) === sessionId)
  const raw = session && typeof (session as { created_at?: string }).created_at === 'string'
    ? Date.parse((session as { created_at: string }).created_at)
    : NaN
  if (!Number.isFinite(raw) || raw <= 0) return 1
  return Math.max(1, Math.floor((now - raw) / 86_400_000) + 1)
}

function relationshipLabel(setting: RelationshipSetting | null): string {
  if (!setting?.preset) return ''
  if (setting.preset === '自定义') return setting.customLabel?.trim() || '自定义'
  return setting.preset
}

export function getRelationshipView(sessionId: string, now = Date.now()): RelationshipView {
  const sid = String(sessionId ?? '').trim()
  if (!sid) {
    return {
      settingLabel: '',
      description: '还没有足够的真实相处记录。',
      hasExplicitSetting: false,
    }
  }

  const setting = loadRelationshipSetting(sid)
  const label = relationshipLabel(setting)
  const events = getEvents(sid)
  const dayCount = daysKnown(sid, now)
  const latest = events[0]

  // 内部只用粗粒度成熟度选择句式，不展示阶段、档位、数值或进度。
  const maturity = dayCount >= 120 || events.length >= 8 ? 2 : dayCount >= 30 || events.length >= 3 ? 1 : 0

  let evidence = ''
  if (latest) {
    evidence = `最近真实留下了「${latest.title}」这件共同经历`
  } else if (dayCount > 1) {
    evidence = `你们已经认识第 ${dayCount} 天`
  } else {
    evidence = '你们才刚开始留下真实的相处痕迹'
  }

  const tail = maturity === 2
    ? '过去发生过的事会保留，新的相处只会继续改变现在的样子。'
    : maturity === 1
      ? '关系正在真实相处里慢慢形成自己的样子，不靠等级推进。'
      : '先让真实聊天和共同经历慢慢决定它会变成什么样。'

  return {
    settingLabel: label,
    hasExplicitSetting: Boolean(setting?.preset),
    description: label
      ? `你们现在以「${label}」的关系相处；${evidence}。${tail}`
      : `你们还没有给关系下定义；${evidence}。${tail}`,
  }
}

export function initRelationshipCloudSync(): void {
  registerCloudStateAdapter(KIND, {
    apply(entity: CloudStateEntity) {
      if (!entity.sessionId || entity.entityId !== entity.sessionId) return
      const incoming = validSetting(entity.payload, entity.sessionId)
      if (!incoming) return
      const map = readMap()
      const current = validSetting(map[entity.sessionId], entity.sessionId)
      if (current && current.updatedAt > incoming.updatedAt) return
      map[entity.sessionId] = incoming
      setCloudStateSidecar(SIDECAR, map)
      notifyDataChanged()
    },
    delete(entity: CloudStateEntity) {
      const sid = entity.sessionId || entity.entityId
      if (!sid) return
      const map = readMap()
      if (!(sid in map)) return
      delete map[sid]
      setCloudStateSidecar(SIDECAR, map)
      notifyDataChanged()
    },
  })
}
