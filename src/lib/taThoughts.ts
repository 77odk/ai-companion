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
import { getAccount } from './sync.ts'
import { getTaThoughtSignal, type TaThoughtTheme } from './taState.ts'

export interface TaThoughtView {
  id: string
  text: string
  createdAt: number
  theme: TaThoughtTheme
}

interface PrivateThought extends TaThoughtView {
  strength: number
  /** 最近一次真正“冒出来/被加强”的时间；纯衰减写盘不能重置它。 */
  lastActivatedAt: number
  updatedAt: number
}

interface ThoughtBookState {
  sessionId: string
  items: PrivateThought[]
  updatedAt: number
}

const KIND = 'ta_thoughts'
const SIDECAR = 'ta_thoughts_v1'
const MAX_ITEMS = 36
const HALF_LIFE_MS = 18 * 60 * 60_000

const THOUGHT_POOL: Record<TaThoughtTheme, readonly string[]> = {
  connection: [
    '有些话不用一次说完，慢慢聊也会留下自己的分量。',
    '刚才那种来回说话的感觉还在，我想让它再停一会儿。',
    '比起急着给答案，我现在更想把下一句话说得真一点。',
  ],
  reflection: [
    '刚才那些话还在脑子里绕，我想再放一会儿。',
    '有些东西当下说完了，过一阵才会看见它真正落在哪里。',
    '我好像还没想完，不急着替它下结论。',
  ],
  exploration: [
    '今天有点想换个角度看看熟悉的东西。',
    '脑子里冒出了一条新路，我想顺着它走一点。',
    '有些问题不一定要马上解决，先看看它还能长出什么。',
  ],
  rest: [
    '现在更想把节奏放慢一点，不急着把每件事想明白。',
    '留一点空白也挺好，什么都不补的时候反而更安静。',
    '今天想少用一点力气，让注意力自己慢慢落下来。',
  ],
}

function readMap(): Record<string, ThoughtBookState> {
  const raw = getCloudStateSidecar<Record<string, ThoughtBookState>>(SIDECAR)
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {}
}

function validBook(value: unknown, sessionId?: string): ThoughtBookState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const book = value as Partial<ThoughtBookState>
  if (typeof book.sessionId !== 'string' || (sessionId && book.sessionId !== sessionId)) return null
  if (!Array.isArray(book.items) || typeof book.updatedAt !== 'number') return null
  const items = book.items.filter((item): item is PrivateThought => (
    item != null
    && typeof item.id === 'string'
    && typeof item.text === 'string'
    && typeof item.createdAt === 'number'
    && typeof item.updatedAt === 'number'
    && typeof item.strength === 'number'
    && (item.lastActivatedAt == null || typeof item.lastActivatedAt === 'number')
    && (item.theme === 'connection' || item.theme === 'reflection' || item.theme === 'exploration' || item.theme === 'rest')
  ))
  return { sessionId: book.sessionId, items, updatedAt: book.updatedAt }
}

function opId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `ta-thought-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function queueCloud(book: ThoughtBookState): void {
  const account = getAccount()
  if (!account || !book.sessionId) return
  enqueueCloudStateOp({
    opId: opId(),
    kind: KIND,
    entityId: book.sessionId,
    sessionId: book.sessionId,
    baseVersion: getCloudStateVersion(KIND, book.sessionId, undefined, book.sessionId),
    payload: book,
  })
  requestCloudStateSync()
}

function writeBook(book: ThoughtBookState, sync: boolean): void {
  const map = readMap()
  map[book.sessionId] = book
  if (!setCloudStateSidecar(SIDECAR, map)) return
  notifyDataChanged()
  if (sync) queueCloud(book)
}

function hashString(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function chooseText(sessionId: string, theme: TaThoughtTheme, now: number): string {
  const pool = THOUGHT_POOL[theme]
  const bucket = Math.floor(now / (6 * 60 * 60_000))
  return pool[(hashString(`${sessionId}:${theme}:${bucket}`) % pool.length)]
}

function decayedStrength(item: PrivateThought, now: number): number {
  const elapsed = Math.max(0, now - item.updatedAt)
  return Math.max(.05, item.strength * Math.pow(.5, elapsed / HALF_LIFE_MS))
}

export function loadTaThoughts(sessionId?: string): TaThoughtView[] {
  const sid = String(sessionId ?? '').trim()
  if (!sid) return []
  const book = validBook(readMap()[sid], sid)
  if (!book) return []
  return [...book.items]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(({ id, text, createdAt, theme }) => ({ id, text, createdAt, theme }))
}

export function settleTaThoughts(sessionId: string, now = Date.now()): TaThoughtView[] {
  const sid = String(sessionId ?? '').trim()
  if (!sid) return []

  const current = validBook(readMap()[sid], sid) ?? { sessionId: sid, items: [], updatedAt: now }
  const lastActivationAt = current.items.reduce(
    (latest, item) => Math.max(latest, item.lastActivatedAt ?? item.createdAt),
    0,
  )
  const decayed = current.items.map((item) => ({
    ...item,
    lastActivatedAt: item.lastActivatedAt ?? item.createdAt,
    strength: decayedStrength(item, now),
    updatedAt: now,
  }))
  const signal = getTaThoughtSignal(sid, lastActivationAt || null, now)

  if (!signal) {
    // 强弱在本地随时间衰减，但没有新念头时不触发云同步。
    if (current.items.length > 0 && now - current.updatedAt >= 6 * 60 * 60_000) {
      writeBook({ sessionId: sid, items: decayed, updatedAt: now }, false)
    }
    return loadTaThoughts(sid)
  }

  const recentSame = [...decayed]
    .sort((a, b) => b.createdAt - a.createdAt)
    .find((item) => item.theme === signal.theme && now - item.createdAt < 24 * 60 * 60_000)

  let items: PrivateThought[]
  if (recentSame) {
    items = decayed.map((item) => item.id === recentSame.id
      ? { ...item, strength: Math.min(1, item.strength + .22), lastActivatedAt: now, updatedAt: now }
      : item)
  } else {
    const thought: PrivateThought = {
      id: `thought-${sid}-${now}-${hashString(`${sid}:${signal.theme}:${now}`).toString(36)}`,
      text: chooseText(sid, signal.theme, now),
      theme: signal.theme,
      createdAt: now,
      lastActivatedAt: now,
      updatedAt: now,
      strength: .62,
    }
    items = [thought, ...decayed].slice(0, MAX_ITEMS)
  }

  writeBook({ sessionId: sid, items, updatedAt: now }, true)
  return loadTaThoughts(sid)
}

export function initTaThoughtCloudSync(): void {
  registerCloudStateAdapter(KIND, {
    apply(entity: CloudStateEntity) {
      if (!entity.sessionId || entity.entityId !== entity.sessionId) return
      const incoming = validBook(entity.payload, entity.sessionId)
      if (!incoming) return
      const map = readMap()
      const current = validBook(map[entity.sessionId], entity.sessionId)
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
