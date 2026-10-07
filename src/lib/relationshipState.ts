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

const RELATIONSHIP_PRESET_EN: Record<Exclude<RelationshipPreset, '自定义'>, string> = {
  '恋人': 'lovers',
  '兄妹': 'siblings',
  '家人': 'family',
  '偶像与粉丝': 'idol and fan',
  '宿敌': 'rivals',
  '主仆': 'master and servant',
  '师生': 'teacher and student',
  '原作角色与你的 OC': "a canon character and USER's OC",
}

function relationshipViewGuidance(setting: RelationshipSetting | null): string {
  switch (setting?.preset) {
    case '恋人':
      return '亲密感只从真实相处里来，不因为设定本身自动变甜。'
    case '兄妹':
    case '家人':
      return '熟悉和照顾可以存在，但不会被写成恋爱口径。'
    case '偶像与粉丝':
      return '会保留欣赏与边界感，不把这层关系自动改写成恋爱。'
    case '宿敌':
      return '张力可以保留，但不会凭空增加敌意、亏欠或情绪绑架。'
    case '主仆':
    case '师生':
      return '身份差异会影响相处口径，但不会替代已经发生过的事实。'
    case '原作角色与你的 OC':
      return '角色世界与身份逻辑优先，新的共同经历仍必须真实发生后才算。'
    case '自定义':
      return '自定义关系只约束相处口径，不会替你们补写历史。'
    default:
      return ''
  }
}

export function getRelationshipRoleGuidanceForPrompt(
  sessionId: string,
  lang: 'zh' | 'en',
): string {
  const setting = loadRelationshipSetting(sessionId)
  if (!setting?.preset) return ''
  if (lang === 'zh') return relationshipViewGuidance(setting)
  switch (setting.preset) {
    case '恋人': return 'Keep intimacy grounded in real interaction; do not become sweeter just because the label says lovers.'
    case '兄妹':
    case '家人': return 'Keep a family-like tone and do not romanticize it.'
    case '偶像与粉丝': return 'Keep admiration and boundaries; do not automatically turn it romantic.'
    case '宿敌': return 'Keep the rivalry texture without inventing hostility, debt, or emotional coercion.'
    case '主仆':
    case '师生': return 'Respect the role asymmetry, but never let it replace actual shared facts.'
    case '原作角色与你的 OC': return 'Preserve canon/world role logic; shared history still requires real evidence.'
    case '自定义': return 'Use the custom relationship only as a role constraint; never fabricate shared history.'
  }
}

function relationshipLabel(setting: RelationshipSetting | null): string {
  if (!setting?.preset) return ''
  if (setting.preset === '自定义') return setting.customLabel?.trim() || '自定义'
  return setting.preset
}

export function getRelationshipSettingLabelForPrompt(sessionId: string, lang: 'zh' | 'en'): string {
  const setting = loadRelationshipSetting(sessionId)
  if (!setting?.preset) return ''
  if (setting.preset === '自定义') return setting.customLabel?.trim() || ''
  return lang === 'en' ? RELATIONSHIP_PRESET_EN[setting.preset] : setting.preset
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

  // “认识多久”只是一条时间事实，绝不据此推断亲密度或关系阶段。
  // 句式只看真实共同事件是否已经留下足够证据。
  const maturity = events.length >= 8 ? 2 : events.length >= 3 ? 1 : 0

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
  const roleGuidance = relationshipViewGuidance(setting)

  return {
    settingLabel: label,
    hasExplicitSetting: Boolean(setting?.preset),
    description: label
      ? `你们现在以「${label}」的关系相处；${evidence}。${roleGuidance || tail}`
      : `你们还没有给关系下定义；${evidence}。${tail}`,
  }
}

export function initRelationshipCloudSync(): void {
  registerCloudStateAdapter(KIND, {
    apply(entity: CloudStateEntity, context) {
      if (!entity.sessionId || entity.entityId !== entity.sessionId) return
      const incoming = validSetting(entity.payload, entity.sessionId)
      if (!incoming) return
      const map = readMap()
      const current = validSetting(map[entity.sessionId], entity.sessionId)
      if (!context.canonical && current && current.updatedAt > incoming.updatedAt) return
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
