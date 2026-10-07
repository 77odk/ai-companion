import { chatCompletion } from './api.ts'
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
import type { MemoryItem } from './memory.ts'
import { loadAIProfile, loadSettings } from './storage.ts'
import { getAccount } from './sync.ts'
import { getTaStateView, type TaMoodWord } from './taState.ts'

export type MemoryPaperKind = 'global' | 'session'

export interface MemoryPaperMoodSnapshot {
  mood: TaMoodWord
  description: string
  changedAt: number
}

export interface MemoryPaperRecord {
  sessionId: string
  memoryKind: MemoryPaperKind
  memoryId: string
  sourceText: string
  sentence: string
  memoryCreatedAt: number
  mood?: MemoryPaperMoodSnapshot
  generatedAt: number
  updatedAt: number
}

export interface MemoryPaperTarget {
  kind: MemoryPaperKind
  item: MemoryItem
}

const KIND = 'memory_paper'
const SIDECAR = 'memory_paper_v1'

function mapKey(sessionId: string, kind: MemoryPaperKind, memoryId: string): string {
  return `${sessionId}\u0000${kind}\u0000${memoryId}`
}

function entityId(kind: MemoryPaperKind, memoryId: string): string {
  return `${kind}:${memoryId}`
}

function readMap(): Record<string, MemoryPaperRecord> {
  const raw = getCloudStateSidecar<Record<string, MemoryPaperRecord>>(SIDECAR)
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {}
}

function validRecord(value: unknown, expectedSessionId?: string): MemoryPaperRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Partial<MemoryPaperRecord>
  if (!item.sessionId || (expectedSessionId && item.sessionId !== expectedSessionId)) return null
  if (item.memoryKind !== 'global' && item.memoryKind !== 'session') return null
  if (typeof item.memoryId !== 'string' || !item.memoryId) return null
  if (typeof item.sourceText !== 'string' || !item.sourceText.trim()) return null
  if (typeof item.sentence !== 'string' || !item.sentence.trim()) return null
  if (typeof item.memoryCreatedAt !== 'number' || typeof item.generatedAt !== 'number' || typeof item.updatedAt !== 'number') return null
  if (item.mood != null) {
    if (
      typeof item.mood !== 'object' ||
      typeof item.mood.mood !== 'string' ||
      typeof item.mood.description !== 'string' ||
      typeof item.mood.changedAt !== 'number'
    ) return null
  }
  return item as MemoryPaperRecord
}

function opId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `memory-paper-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function queueRecord(record: MemoryPaperRecord): void {
  if (!getAccount()) return
  enqueueCloudStateOp({
    opId: opId(),
    kind: KIND,
    entityId: entityId(record.memoryKind, record.memoryId),
    sessionId: record.sessionId,
    baseVersion: getCloudStateVersion(KIND, entityId(record.memoryKind, record.memoryId), undefined, record.sessionId),
    payload: record,
  })
  requestCloudStateSync()
}

function queueDelete(record: MemoryPaperRecord): void {
  if (!getAccount()) return
  enqueueCloudStateOp({
    opId: opId(),
    kind: KIND,
    entityId: entityId(record.memoryKind, record.memoryId),
    sessionId: record.sessionId,
    baseVersion: getCloudStateVersion(KIND, entityId(record.memoryKind, record.memoryId), undefined, record.sessionId),
    deleted: true,
  })
  requestCloudStateSync()
}

function writeRecord(record: MemoryPaperRecord, sync = true): boolean {
  const map = readMap()
  map[mapKey(record.sessionId, record.memoryKind, record.memoryId)] = record
  if (!setCloudStateSidecar(SIDECAR, map)) return false
  notifyDataChanged()
  if (sync) queueRecord(record)
  return true
}

export function getMemoryPaper(sessionId: string, kind: MemoryPaperKind, memoryId: string): MemoryPaperRecord | null {
  const sid = String(sessionId ?? '').trim()
  if (!sid || !memoryId) return null
  return validRecord(readMap()[mapKey(sid, kind, memoryId)], sid)
}

export function getMemoryPaperForItem(sessionId: string, kind: MemoryPaperKind, item: MemoryItem): MemoryPaperRecord | null {
  const record = getMemoryPaper(sessionId, kind, item.id)
  if (!record || record.sourceText.trim() !== item.text.trim()) return null
  return record
}

export function captureMemoryPaperMood(sessionId: string): MemoryPaperMoodSnapshot | undefined {
  const sid = String(sessionId ?? '').trim()
  if (!sid) return undefined
  const view = getTaStateView(sid)
  return { mood: view.mood, description: view.description, changedAt: view.changedAt }
}

export function canGenerateMemoryPaper(): boolean {
  const settings = loadSettings()
  return Boolean(settings.apiKey?.trim() && settings.baseUrl?.trim() && settings.model?.trim())
}

function cleanGeneratedSentence(value: string): string {
  return String(value ?? '')
    .replace(/^(?:纸条|记忆|改写)\s*[:：]\s*/i, '')
    .replace(/^["“”']+|["“”']+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

async function generateSentence(sessionId: string, memoryText: string): Promise<string> {
  const settings = loadSettings()
  if (!settings.apiKey?.trim() || !settings.baseUrl?.trim() || !settings.model?.trim()) {
    throw new Error('memory_paper_model_unconfigured')
  }
  const profile = loadAIProfile(sessionId)
  const taName = profile.nickname?.trim() || 'TA'
  const answer = await chatCompletion(
    settings,
    [
      {
        role: 'system',
        content:
          `你在为“忆文”里的记忆星星写一张纸条。把已确认的记忆改写成 ${taName} 自己记住的一句话。\n` +
          '要求：第一人称 TA 口吻；主谓宾完整；只改写已有事实，绝不补共同经历、原因、地点、时间或感受；不要评价用户；不要写日期；不要写“心情”；不要加标题；只输出一句中文，80字以内。',
      },
      { role: 'user', content: memoryText.trim() },
    ],
    { maxTokens: 120, temperature: 0.25, timeoutMs: 30_000 },
  )
  const clean = cleanGeneratedSentence(answer)
  if (!clean) throw new Error('memory_paper_empty')
  return clean
}

export async function generateMemoryPaper(
  sessionId: string,
  target: MemoryPaperTarget,
  options: {
    mood?: MemoryPaperMoodSnapshot
    preserveExistingMood?: boolean
  } = {},
): Promise<MemoryPaperRecord | null> {
  const sid = String(sessionId ?? '').trim()
  const memoryId = String(target.item?.id ?? '').trim()
  const text = String(target.item?.text ?? '').trim()
  if (!sid || !memoryId || !text) return null

  const existing = getMemoryPaper(sid, target.kind, memoryId)
  if (existing && existing.sourceText.trim() === text && existing.sentence.trim()) return existing

  const sentence = await generateSentence(sid, text)
  const now = Date.now()
  const record: MemoryPaperRecord = {
    sessionId: sid,
    memoryKind: target.kind,
    memoryId,
    sourceText: text,
    sentence,
    memoryCreatedAt: Number.isFinite(target.item.createdAt) ? target.item.createdAt : now,
    ...(options.preserveExistingMood && existing?.mood
      ? { mood: existing.mood }
      : options.mood
        ? { mood: options.mood }
        : {}),
    generatedAt: now,
    updatedAt: now,
  }
  return writeRecord(record, true) ? record : null
}

export async function refreshMemoryPaperAfterCorrection(
  sessionId: string,
  target: MemoryPaperTarget,
): Promise<MemoryPaperRecord | null> {
  return generateMemoryPaper(sessionId, target, { preserveExistingMood: true })
}

export function deleteMemoryPapersForMemory(
  kind: MemoryPaperKind,
  memoryId: string,
  sessionId?: string,
): void {
  const sid = String(sessionId ?? '').trim()
  const map = readMap()
  const removed: MemoryPaperRecord[] = []
  for (const [key, value] of Object.entries(map)) {
    const record = validRecord(value)
    if (!record || record.memoryKind !== kind || record.memoryId !== memoryId) continue
    if (sid && record.sessionId !== sid) continue
    removed.push(record)
    delete map[key]
  }
  if (removed.length === 0 || !setCloudStateSidecar(SIDECAR, map)) return
  notifyDataChanged()
  for (const record of removed) queueDelete(record)
}

export async function backfillMemoryPapers(
  sessionId: string,
  targets: MemoryPaperTarget[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ generated: number; failed: number }> {
  const sid = String(sessionId ?? '').trim()
  if (!sid) return { generated: 0, failed: 0 }
  const missing = targets.filter(({ kind, item }) => !getMemoryPaperForItem(sid, kind, item))
  let generated = 0
  let failed = 0
  for (let index = 0; index < missing.length; index += 1) {
    const target = missing[index]
    try {
      // 旧数据没有 mood 时仍为空；若只是 Memory 被纠正导致纸条失配，则保留原来的“当时心情”。
      const result = await generateMemoryPaper(sid, target, { preserveExistingMood: true })
      if (result) generated += 1
      else failed += 1
    } catch {
      failed += 1
    }
    onProgress?.(index + 1, missing.length)
  }
  return { generated, failed }
}

export function initMemoryPaperCloudSync(): void {
  registerCloudStateAdapter(KIND, {
    apply(entity: CloudStateEntity) {
      if (!entity.sessionId) return
      const incoming = validRecord(entity.payload, entity.sessionId)
      if (!incoming || entity.entityId !== entityId(incoming.memoryKind, incoming.memoryId)) return
      const map = readMap()
      map[mapKey(incoming.sessionId, incoming.memoryKind, incoming.memoryId)] = incoming
      setCloudStateSidecar(SIDECAR, map)
      notifyDataChanged()
    },
    delete(entity: CloudStateEntity) {
      if (!entity.sessionId) return
      const map = readMap()
      let changed = false
      for (const [key, value] of Object.entries(map)) {
        const record = validRecord(value)
        if (!record || record.sessionId !== entity.sessionId) continue
        if (entity.entityId !== entityId(record.memoryKind, record.memoryId)) continue
        delete map[key]
        changed = true
      }
      if (changed) {
        setCloudStateSidecar(SIDECAR, map)
        notifyDataChanged()
      }
    },
  })
}
