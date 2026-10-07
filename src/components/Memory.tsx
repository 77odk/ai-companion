import { useEffect, useMemo, useRef, useState } from 'react'
import { deriveMemoryTriggerWords, isSimilarMemory, loadMemory, saveMemory, type MemoryItem } from '../lib/memory'
import { getActiveSessionId, getBusyState, getMemoriesCache, getSessionLang, mergeSessionMemories, saveMemoriesCache, sessionMemoryToItem } from '../lib/sessionStore'
import { listMemories, postMemory } from '../lib/sessionApi'
import { buildBookPages, type BookPage, type DatedMemory } from '../lib/memoryBook'
import { getToken } from '../lib/auth'
import { getAccount } from '../lib/sync'
import { correctMemoryText, removeMemory, type MemoryCorrectionTarget } from '../lib/memoryCorrection'
import { findChatRecordJumpTargetHydrated, type ChatJumpTarget, type MemoryReturnTarget } from '../lib/chatJump'
import { alignPendingMemoriesForRefresh } from '../lib/memoryRefreshReconcile'
import { recordMemoryIdAlias, resolveMemoryIdAlias, subscribeMemoryIdAliases } from '../lib/memoryIdAliases'
import EventArchive from './EventArchive'
import { getOrAdvanceTaRuntime, getSessionPersona, runtimeDisplayLabel } from '../lib/taRuntime'
import { appendMemoryAudit, loadMemoryAudit, type MemoryAuditEntry } from '../lib/memoryAudit'
import { getTaStateView } from '../lib/taState'
import { deleteMemoryPapersForMemory, refreshMemoryPaperAfterCorrection } from '../lib/memoryPaper'

// UI2-03 Memory Correction —— 「时间是目录，记忆是正文。」
// 数据链 100% 原样：global explicit memories + active session memories，按 createdAt 排序。
// 本文件为展示层：River（找得到）/ Detail（看明白）/ Book（重新经历）。
// 新增数据字段 taReply 只在 memory.ts / sessionStore.ts / Chat.tsx 写入链最小扩展（可选、向后兼容）。

interface MemoryMonth {
  key: string
  label: string
  items: DatedSourcedMemory[]
}

interface MemoryYear {
  key: string
  label: string
  months: MemoryMonth[]
}

type MemoryKind = 'global' | 'session'

interface SourcedMemory {
  item: MemoryItem
  kind: MemoryKind
}

interface DatedSourcedMemory extends DatedMemory {
  kind: MemoryKind
}

interface MemorySelection {
  kind: MemoryKind
  memoryId: MemoryItem['id']
  sessionId?: string
}

function matchesMemorySelection(
  memory: DatedSourcedMemory,
  selection: MemorySelection,
  activeSessionId: string | null,
): boolean {
  if (memory.kind !== selection.kind || memory.item.id !== selection.memoryId) return false
  if (selection.kind !== 'session') return true
  const expectedSessionId = selection.sessionId ?? activeSessionId
  return Boolean(expectedSessionId && activeSessionId === expectedSessionId)
}

const MONTHS_EN = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
]
const MONTHS_ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']

function validTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && !Number.isNaN(new Date(value).getTime())
    ? value
    : null
}

function groupMemories(items: DatedSourcedMemory[]): MemoryYear[] {
  const years = new Map<string, { label: string; months: Map<string, MemoryMonth> }>()

  for (const memory of items) {
    const date = memory.timestamp == null ? null : new Date(memory.timestamp)
    const yearKey = date ? String(date.getFullYear()) : 'unknown'
    const monthKey = date ? `${yearKey}-${date.getMonth()}` : 'unknown'
    const yearLabel = date ? yearKey : '较早的记忆'
    const monthLabel = date ? `${date.getMonth() + 1}月` : '日期未知'
    let year = years.get(yearKey)
    if (!year) {
      year = { label: yearLabel, months: new Map() }
      years.set(yearKey, year)
    }
    let month = year.months.get(monthKey)
    if (!month) {
      month = { key: monthKey, label: monthLabel, items: [] }
      year.months.set(monthKey, month)
    }
    month.items.push(memory)
  }

  return [...years.entries()].map(([key, year]) => ({
    key,
    label: year.label,
    months: [...year.months.values()],
  }))
}

function shortDate(timestamp: number | null): string {
  if (timestamp == null) return '日期未知'
  const d = new Date(timestamp)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 年份导航点击：滚动到对应年份章节（不筛选、不跳转） */
function scrollToYear(yearKey: string): void {
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  document.getElementById(`memory-year-${yearKey}`)?.scrollIntoView({
    behavior: reduce ? 'auto' : 'smooth',
    block: 'start',
  })
}

// ---- Memory Book 阅读序列（纯函数在 src/lib/memoryBook.ts，可单测） ----

// ---- 渐进渲染阈值：条目总数超过该值启用分批渲染（章节完整，条目渐进出现） ----
const RIVER_FULL_LIMIT = 200
/** 渐进渲染每批条数 */
const RIVER_BATCH = 120

interface MemoryProps {
  /** UI2-03B-1「看原对话」：把一次性 jump target 交给 App（附上返回目标），由 App 打开完整聊天记录 */
  onJumpToChatLog?: (target: ChatJumpTarget, returnTarget?: MemoryReturnTarget) => void
  /** 从聊天记录返回时要恢复的详情目标（transient，只从 App 内存传入，绝不持久化） */
  initialDetail?: MemoryReturnTarget | null
  /** 恢复动作完成（找到或没找到都要）后通知 App 清掉 target，恢复普通返回行为 */
  onInitialDetailConsumed?: () => void
}

export default function Memory({ onJumpToChatLog, initialDetail, onInitialDetailConsumed }: MemoryProps = {}) {
  const sessionId = getActiveSessionId()
  const readMemories = (sessionOverride?: MemoryItem[]): SourcedMemory[] => {
    const globalExplicit = loadMemory().filter((memory) => memory.explicit === true)
    const sessionMemories = sessionOverride ?? (sessionId ? getMemoriesCache(sessionId) : [])
    return [
      ...globalExplicit.map((item) => ({ item, kind: 'global' as const })),
      ...sessionMemories.map((item) => ({ item, kind: 'session' as const })),
    ]
  }
  const [memories, setMemories] = useState(readMemories)
  const [query, setQuery] = useState('')
  const [auditOpen, setAuditOpen] = useState(false)
  const [auditVersion, setAuditVersion] = useState(0)
  const [rollbackBusyId, setRollbackBusyId] = useState<string | null>(null)
  const [rollbackNotice, setRollbackNotice] = useState('')
  const [statusNow, setStatusNow] = useState(() => Date.now())
  const audits = useMemo(() => loadMemoryAudit(sessionId), [sessionId, auditVersion])

  useEffect(() => {
    if (!sessionId) return
    const refresh = () => setStatusNow(Date.now())
    const timer = window.setInterval(refresh, 30_000)
    const onReply = (event: Event) => {
      const sid = (event as CustomEvent<{ sid?: string }>).detail?.sid
      if (!sid || String(sid) === sessionId) refresh()
    }
    window.addEventListener('yiwem:ai-reply-committed', onReply)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('yiwem:ai-reply-committed', onReply)
    }
  }, [sessionId])

  const statusLabel = useMemo(() => {
    if (!sessionId) return ''
    const busy = getBusyState(sessionId)
    if (busy.status === 'busy' && busy.busyUntil > statusNow && busy.busyReason) return busy.busyReason
    return runtimeDisplayLabel(
      getOrAdvanceTaRuntime(sessionId, getSessionPersona(sessionId), statusNow),
      getSessionLang(sessionId),
    )
  }, [sessionId, statusNow])

  const stateView = useMemo(
    () => sessionId ? getTaStateView(sessionId, statusNow) : null,
    [sessionId, statusNow],
  )

  const refreshAudit = () => setAuditVersion((value) => value + 1)

  // #19：进入记忆页主动拉当前会话云端记忆。页内一旦发生改/删，本次旧 GET 结果作废，避免回写过期状态。
  const memoryMutationVersionRef = useRef(0)
  useEffect(() => {
    let cancelled = false
    setMemories(readMemories())
    if (!sessionId) return () => { cancelled = true }

    const token = getToken()
    if (!token) return () => { cancelled = true }

    const startedAtMutationVersion = memoryMutationVersionRef.current
    void listMemories(token, sessionId).then((res) => {
      if (cancelled || !res.ok || memoryMutationVersionRef.current !== startedAtMutationVersion) return

      const cloudMemories = res.data.memories.map(sessionMemoryToItem)
      const alignment = alignPendingMemoriesForRefresh(getMemoriesCache(sessionId), cloudMemories)
      const merged = mergeSessionMemories(alignment.cache, cloudMemories, {
        purgeMissing: true,
        sessionId,
      })
      if (alignment.reconciledIds.size > 0) {
        for (const [localId, serverId] of alignment.reconciledIds) {
          recordMemoryIdAlias(sessionId, localId, serverId)
        }
      }
      // Chat 的 POST 回调可能在本页读取缓存之后、GET 返回之前先完成；
      // 即使 alignment 没产生映射，也要从统一别名源承接那次 local → server 对账。
      setSelectedIdentity((current) => {
        if (!current || current.kind !== 'session') return current
        const resolved = resolveMemoryIdAlias(sessionId, String(current.memoryId))
        return resolved !== current.memoryId ? { ...current, memoryId: resolved } : current
      })
      if (cancelled || memoryMutationVersionRef.current !== startedAtMutationVersion) return

      // localStorage 写失败不伪装成成功；但本次页面仍可展示刚从权威云端拉回的真实结果。
      saveMemoriesCache(sessionId, merged)
      setMemories(readMemories(merged))
    })

    return () => {
      cancelled = true
    }
  }, [sessionId])

  const chronological = useMemo<DatedSourcedMemory[]>(() => {
    return memories
      .map(({ item, kind }) => ({ item, kind, timestamp: validTimestamp(item.createdAt) }))
      .sort((a, b) => {
        if (a.timestamp == null && b.timestamp == null) return 0
        if (a.timestamp == null) return -1
        if (b.timestamp == null) return 1
        return a.timestamp - b.timestamp
      })
  }, [memories])

  const filteredChronological = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return chronological
    return chronological.filter(({ item }) => {
      const haystack = [
        item.text,
        item.source ?? '',
        item.topic ?? '',
        ...deriveMemoryTriggerWords(item.text, item.topic),
      ].join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [chronological, query])

  const riverItems = useMemo(() => [...filteredChronological].reverse(), [filteredChronological])
  const years = useMemo(() => groupMemories(riverItems), [riverItems])
  const earliest = chronological.find((memory) => memory.timestamp != null)?.timestamp ?? null

  // ---- 渐进渲染：少量全量；海量时章节完整、条目分批（lightweight，无依赖） ----
  const needsWindowing = riverItems.length > RIVER_FULL_LIMIT
  const [visibleCount, setVisibleCount] = useState(needsWindowing ? RIVER_BATCH : riverItems.length)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const itemOrder = useMemo(() => {
    const map = new Map<DatedSourcedMemory, number>()
    riverItems.forEach((memory, index) => map.set(memory, index))
    return map
  }, [riverItems])

  useEffect(() => {
    if (!needsWindowing) setVisibleCount(riverItems.length)
  }, [needsWindowing, riverItems.length])

  useEffect(() => {
    if (!needsWindowing || visibleCount >= riverItems.length) return
    const el = sentinelRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((v) => Math.min(riverItems.length, v + RIVER_BATCH))
        }
      },
      { rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [needsWindowing, visibleCount, riverItems.length])

  const [view, setView] = useState<'river' | 'detail' | 'book'>('river')
  const [bookStage, setBookStage] = useState<'cover' | 'body'>('cover')
  const [bookFrom, setBookFrom] = useState<'cover' | 'detail'>('cover')
  const [selectedIdentity, setSelectedIdentity] = useState<MemorySelection | null>(null)

  useEffect(() => {
    if (!sessionId) return
    return subscribeMemoryIdAliases((alias) => {
      if (alias.sessionId !== sessionId) return
      // 对账源已经成功写入缓存；列表与 selection 必须同一轮迁移，
      // 否则只把 selection 换成 server id 会在旧列表上短暂“找不到”，误退回 River。
      setMemories((current) => {
        const alreadyHasServerId = current.some((entry) => (
          entry.kind === 'session' && String(entry.item.id) === alias.newId
        ))
        if (alreadyHasServerId) {
          return current.filter((entry) => !(
            entry.kind === 'session' && String(entry.item.id) === alias.oldId
          ))
        }
        return current.map((entry) => {
          if (entry.kind !== 'session' || String(entry.item.id) !== alias.oldId) return entry
          const item = { ...entry.item, id: alias.newId }
          delete item.pendingSync
          return { ...entry, item }
        })
      })
      setSelectedIdentity((current) => {
        if (!current || current.kind !== 'session') return current
        const resolved = resolveMemoryIdAlias(sessionId, String(current.memoryId))
        return resolved !== current.memoryId ? { ...current, memoryId: resolved } : current
      })
    })
  }, [sessionId])

  const selectedIndex = useMemo(() => {
    if (!selectedIdentity) return -1
    return chronological.findIndex((memory) => matchesMemorySelection(memory, selectedIdentity, sessionId))
  }, [chronological, selectedIdentity, sessionId])
  const selected = selectedIndex >= 0 ? chronological[selectedIndex] : null

  // 从 Chat 返回：按稳定 identity 在当前数据里重新定位并打开详情；找不到就安全留在 River，绝不猜别的条目
  useEffect(() => {
    if (!initialDetail) return
    // 数据尚未就绪（首帧 session 未恢复 / 记忆还没读入）→ 先等，不能在这时消费 target，否则会被误判成「不存在」
    if (initialDetail.kind === 'session' && !sessionId) return
    if (chronological.length === 0) return
    const identity: MemorySelection = {
      kind: initialDetail.kind,
      memoryId: initialDetail.kind === 'session'
        ? resolveMemoryIdAlias(initialDetail.sessionId ?? sessionId, String(initialDetail.memoryId))
        : initialDetail.memoryId,
      ...(initialDetail.kind === 'session'
        ? { sessionId: initialDetail.sessionId ?? sessionId ?? undefined }
        : {}),
    }
    const index = chronological.findIndex((entry) => matchesMemorySelection(entry, identity, sessionId))
    if (index >= 0) {
      setSelectedIdentity(identity)
      setView('detail')
    }
    onInitialDetailConsumed?.()
  }, [initialDetail, chronological, sessionId, onInitialDetailConsumed])
  const bookPages = useMemo(() => buildBookPages(chronological), [chronological])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  // 2026-09-18：删除入口（二次确认 + 失败就地提示，成功回 River）
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  // UI2-03B-1「看原对话」：失败提示（不撑坏 Detail），短暂显示后自动消失
  const [jumpNotice, setJumpNotice] = useState<string | null>(null)
  const [jumpLoading, setJumpLoading] = useState(false)
  const jumpNoticeTimer = useRef<number | null>(null)

  // 详情身份必须跟随稳定 memory identity，而不是数组位置。
  // 云端刷新若删除当前条目，就安全退回 River；绝不能悄悄落到相邻条目。
  useEffect(() => {
    if (view !== 'detail' || !selectedIdentity || selected) return
    setEditing(false)
    setConfirmingDelete(false)
    setSaveError('')
    setDeleteError('')
    setJumpNotice(null)
    setSelectedIdentity(null)
    setView('river')
  }, [view, selectedIdentity, selected])

  const showJumpNotice = (text: string) => {
    setJumpNotice(text)
    if (jumpNoticeTimer.current !== null) window.clearTimeout(jumpNoticeTimer.current)
    jumpNoticeTimer.current = window.setTimeout(() => setJumpNotice(null), 2600)
  }

  // UI2-03B-1：只允许「session Memory + source 非空」跳原对话。
  // 点击时用当前 session 的完整云端记录确认唯一性；云端不可用再安全回落本地缓存。
  const handleJumpToChatLog = async () => {
    if (!selected || !onJumpToChatLog || jumpLoading) return
    const jumpIdentity: MemorySelection = {
      kind: selected.kind,
      memoryId: selected.item.id,
      ...(selected.kind === 'session' && sessionId ? { sessionId } : {}),
    }
    setJumpLoading(true)
    const result = await findChatRecordJumpTargetHydrated(sessionId, selected.item.source ?? '', getToken())
    setJumpLoading(false)
    if (result.status === 'unique' && result.target) {
      setJumpNotice(null)
      // await 期间 mount refresh 可能把 pending local id 对账成 server id；
      // return target 必须承接最新 id，不能把旧 local id 带进聊天返回链。
      const returnMemoryId = jumpIdentity.kind === 'session'
        ? resolveMemoryIdAlias(jumpIdentity.sessionId ?? sessionId, String(jumpIdentity.memoryId))
        : jumpIdentity.memoryId
      onJumpToChatLog(result.target, {
        memoryId: returnMemoryId,
        kind: jumpIdentity.kind,
        ...(jumpIdentity.kind === 'session' && jumpIdentity.sessionId ? { sessionId: jumpIdentity.sessionId } : {}),
      })
      return
    }
    if (result.status === 'ambiguous') {
      showJumpNotice('这句话你们说过好几次，暂时无法确定是哪一次')
      return
    }
    // source / taReply 仍是已持久化的真实证据；定位失败不等于“对话被删除”。
    showJumpNotice('暂时无法定位原位置；当时保留的对话片段仍在这一页')
  }

  // ---- Detail → back 保持 River 位置 ----
  const pageRef = useRef<HTMLDivElement>(null)
  const riverScrollRef = useRef(0)
  const openDetail = (memory: DatedSourcedMemory) => {
    riverScrollRef.current = pageRef.current?.scrollTop ?? 0
    setSelectedIdentity({
      kind: memory.kind,
      memoryId: memory.item.id,
      ...(memory.kind === 'session' && sessionId ? { sessionId } : {}),
    })
    setEditing(false)
    setSaveError('')
    setView('detail')
  }

  const beginCorrection = () => {
    if (!selected) return
    setDraft(selected.item.text)
    setSaveError('')
    setConfirmingDelete(false)
    setDeleteError('')
    setEditing(true)
  }

  const beginDelete = () => {
    setEditing(false)
    setSaveError('')
    setDeleteError('')
    setConfirmingDelete(true)
  }

  const cancelDelete = () => {
    setConfirmingDelete(false)
    setDeleteError('')
  }

  const confirmDelete = async () => {
    if (!selected || deleting) return
    const paperAccountId = getAccount()?.account ?? null
    const target: MemoryCorrectionTarget = selected.kind === 'global'
      ? { kind: 'global', item: selected.item }
      : { kind: 'session', sessionId, item: selected.item, token: getToken() }
    setDeleting(true)
    setDeleteError('')
    if (selected.kind === 'session') memoryMutationVersionRef.current += 1
    const result = await removeMemory(target)
    setDeleting(false)
    if (!result.ok) {
      setDeleteError(result.message)
      return
    }
    // Memory 删除是权威动作：先让对应纸条失效，星星罐不允许残留已删除的记忆。
    deleteMemoryPapersForMemory(
      selected.kind,
      selected.item.id,
      selected.kind === 'session' ? sessionId : undefined,
      paperAccountId ?? undefined,
    )
    appendMemoryAudit({
      sessionId: selected.kind === 'session' ? sessionId : '',
      memoryKind: selected.kind,
      memoryId: selected.item.id,
      action: 'delete',
      before: selected.item,
      source: 'detail',
    })
    refreshAudit()
    setMemories((items) => items.filter((memory) => (
      !(memory.kind === selected.kind && memory.item.id === selected.item.id)
    )))
    setConfirmingDelete(false)
    setSelectedIdentity(null)
    setView('river')
  }

  const saveCorrection = async () => {
    if (!selected || saving) return
    const paperAccountId = getAccount()?.account ?? null
    const text = draft.trim()
    if (!text) {
      setSaveError('记住的内容不能为空')
      return
    }
    const target: MemoryCorrectionTarget = selected.kind === 'global'
      ? { kind: 'global', item: selected.item }
      : { kind: 'session', sessionId, item: selected.item, token: getToken() }
    setSaving(true)
    setSaveError('')
    if (selected.kind === 'session') memoryMutationVersionRef.current += 1
    const result = await correctMemoryText(target, text)
    setSaving(false)
    if (!result.ok) {
      setSaveError(result.message)
      return
    }
    if (result.changed) {
      appendMemoryAudit({
        sessionId: selected.kind === 'session' ? sessionId : '',
        memoryKind: selected.kind,
        memoryId: selected.item.id,
        action: 'edit',
        before: selected.item,
        after: result.item,
        source: 'detail',
      })
      refreshAudit()
      setMemories((items) => items.map((memory) => (
        memory.kind === selected.kind && memory.item.id === selected.item.id
          ? { ...memory, item: result.item }
          : memory
      )))
      if (sessionId) {
        // 纠正后纸条正文随 Memory 变更；已有“当时心情”保持原样，不能用当前心情覆盖。
        void refreshMemoryPaperAfterCorrection(
          sessionId,
          { kind: selected.kind, item: result.item },
          paperAccountId,
        ).catch(() => {})
      }
    }
    setEditing(false)
  }
  const rollbackAuditEntry = async (entry: MemoryAuditEntry) => {
    if (
      rollbackBusyId ||
      !entry.before ||
      (entry.action !== 'edit' && entry.action !== 'delete') ||
      audits.some((item) => item.parentAuditId === entry.id)
    ) return
    const paperAccountId = getAccount()?.account ?? null
    setRollbackBusyId(entry.id)
    setRollbackNotice('')
    try {
      if (entry.memoryKind === 'global') {
        if (entry.action === 'delete') {
          const current = loadMemory()
          if (!current.some((item) => item.id === entry.before?.id)) {
            const restored = { ...entry.before }
            if (!saveMemory([restored, ...current])) {
              setRollbackNotice('这次回退没有保存成功。')
              return
            }
            appendMemoryAudit({
              sessionId: '',
              memoryKind: 'global',
              memoryId: restored.id,
              action: 'rollback',
              after: restored,
              source: 'rollback',
              parentAuditId: entry.id,
            })
          }
        } else {
          const current = loadMemory().find((item) => item.id === entry.memoryId)
          if (!current) {
            setRollbackNotice('这段记忆已经不存在，不能按这一版回退。')
            return
          }
          const result = await correctMemoryText({ kind: 'global', item: current }, entry.before.text)
          if (!result.ok) {
            setRollbackNotice(result.message)
            return
          }
          appendMemoryAudit({
            sessionId: '',
            memoryKind: 'global',
            memoryId: result.item.id,
            action: 'rollback',
            before: current,
            after: result.item,
            source: 'rollback',
            parentAuditId: entry.id,
          })
          if (sessionId) {
            void refreshMemoryPaperAfterCorrection(
              sessionId,
              { kind: 'global', item: result.item },
              paperAccountId,
            ).catch(() => {})
          }
        }
        setMemories(readMemories())
        refreshAudit()
        setRollbackNotice('已经回退到这次变更之前。')
        return
      }

      if (!sessionId || entry.sessionId !== sessionId) {
        setRollbackNotice('这条记录不属于当前 TA。')
        return
      }
      const token = getToken()
      if (!token) {
        setRollbackNotice('登录状态已失效，请重新登录后再试。')
        return
      }

      if (entry.action === 'delete') {
        const cache = getMemoriesCache(sessionId)
        const alreadyRestored = cache.find((item) => item.id === entry.memoryId)
          ?? cache.find((item) => isSimilarMemory([item], entry.before?.text ?? ''))
        if (alreadyRestored) {
          appendMemoryAudit({
            sessionId,
            memoryKind: 'session',
            memoryId: alreadyRestored.id,
            action: 'rollback',
            after: alreadyRestored,
            source: 'rollback',
            parentAuditId: entry.id,
          })
        } else {
          const res = await postMemory(token, sessionId, {
            content: entry.before.text,
            ...(entry.before.source?.trim() ? { source: entry.before.source } : {}),
            ...(entry.before.taReply?.trim() ? { taReply: entry.before.taReply } : {}),
          })
          if (!res.ok) {
            setRollbackNotice(res.message || '恢复失败，请稍后再试。')
            return
          }
          const restored: MemoryItem = {
            ...sessionMemoryToItem(res.data),
            topic: entry.before.topic,
            explicit: entry.before.explicit,
            pinned: entry.before.pinned,
            lastMentionedAt: entry.before.lastMentionedAt,
          }
          const saved = saveMemoriesCache(sessionId, [restored, ...cache.filter((item) => item.id !== restored.id)])
          appendMemoryAudit({
            sessionId,
            memoryKind: 'session',
            memoryId: restored.id,
            action: 'rollback',
            after: restored,
            source: 'rollback',
            parentAuditId: entry.id,
          })
          if (!saved) {
            setMemories((current) => [
              { item: restored, kind: 'session' as const },
              ...current.filter((memory) => !(memory.kind === 'session' && memory.item.id === restored.id)),
            ])
            refreshAudit()
            setRollbackNotice('已经恢复到云端；本机缓存暂时没写进去，刷新后会重新拉回。')
            return
          }
        }
      } else {
        const current = getMemoriesCache(sessionId).find((item) => item.id === entry.memoryId)
        if (!current) {
          setRollbackNotice('这段记忆已经不存在，不能按这一版回退。')
          return
        }
        const result = await correctMemoryText(
          { kind: 'session', sessionId, item: current, token },
          entry.before.text,
        )
        if (!result.ok) {
          setRollbackNotice(result.message)
          return
        }
        appendMemoryAudit({
          sessionId,
          memoryKind: 'session',
          memoryId: result.item.id,
          action: 'rollback',
          before: current,
          after: result.item,
          source: 'rollback',
          parentAuditId: entry.id,
        })
        void refreshMemoryPaperAfterCorrection(
          sessionId,
          { kind: 'session', item: result.item },
          paperAccountId,
        ).catch(() => {})
      }

      setMemories(readMemories())
      refreshAudit()
      setRollbackNotice('已经回退到这次变更之前。')
    } finally {
      setRollbackBusyId(null)
    }
  }

  useEffect(() => {
    if (view !== 'river') return
    const target = riverScrollRef.current
    if (target <= 0) return
    const frame = requestAnimationFrame(() => {
      const el = pageRef.current
      if (el) el.scrollTop = target
    })
    return () => cancelAnimationFrame(frame)
  }, [view])

  // ---- Book：page sequence + 3D 翻页 ----
  const [bookPageIdx, setBookPageIdx] = useState(0)
  const [flip, setFlip] = useState<{ dir: 'next' | 'prev'; target: number } | null>(null)
  const touchX = useRef<number | null>(null)
  const prefersReduced =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  const turnBook = (dir: 'next' | 'prev') => {
    if (flip) return
    const target = dir === 'next' ? bookPageIdx + 1 : bookPageIdx - 1
    if (target < 0 || target >= bookPages.length) return
    if (prefersReduced) {
      setBookPageIdx(target)
      return
    }
    setFlip({ dir, target })
  }

  const commitFlip = () => {
    if (!flip) return
    setBookPageIdx(flip.target)
    setFlip(null)
  }

  // cover 年份范围：由真实 createdAt 派生；单年只显示单年；无法可靠确定 → 不显示
  const yearRange = (() => {
    const dates = chronological.filter((m) => m.timestamp != null).map((m) => new Date(m.timestamp as number))
    if (dates.length === 0) return null
    const ys = dates.map((d) => d.getFullYear())
    const min = Math.min(...ys)
    const max = Math.max(...ys)
    return min === max ? `${min}` : `${min} — ${max}`
  })()

  // hero meta：37 段记忆，从 2025 年 11 月开始。（安静小字）
  const heroMeta = useMemo(() => {
    if (memories.length === 0) return null
    const base = `${memories.length} 段记忆`
    if (earliest == null) return `${base}。`
    const d = new Date(earliest)
    return `${base}，从 ${d.getFullYear()} 年 ${d.getMonth() + 1} 月开始。`
  }, [memories, earliest])

  // ---- Book Body ----
  if (view === 'book') {
    if (bookStage === 'cover') {
      return (
        <div className="memory-book-overlay" role="dialog" aria-modal="true" aria-label="记忆书">
          <div className="memory-book-cover-art" aria-hidden="true" />
          <div className="memory-book-cover-veil" aria-hidden="true" />
          <div className="memory-book-cover-content">
            <p className="memory-book-cover-en">E L U V I N</p>
            <h2 className="memory-book-cover-title">记忆书</h2>
            <p className="memory-book-cover-name">MEMORY BOOK</p>
            {yearRange ? <p className="memory-book-cover-years">{yearRange}</p> : null}
            <p className="memory-book-cover-line">那些被记住的小事，</p>
            <p className="memory-book-cover-line">后来都有了自己的位置。</p>
            <button
              type="button"
              className="memory-book-open"
              onClick={() => {
                setBookPageIdx(0)
                setFlip(null)
                setBookStage('body')
              }}
            >
              开始翻阅
              <span aria-hidden="true">→</span>
            </button>
            <button type="button" className="memory-book-close" onClick={() => setView('river')}>
              ‹ 返回长河
            </button>
          </div>
        </div>
      )
    }

    const currentPage = bookPages[bookPageIdx] ?? null
    const flipPage = flip ? bookPages[flip.target] ?? null : null
    const atStart = bookPageIdx <= 0
    const atEnd = bookPageIdx >= bookPages.length - 1

    const renderBookPage = (page: BookPage) => {
      if (page.type === 'year') {
        return (
          <div className="memory-book-page memory-book-year-page" key={`y-${page.year}`}>
            <p className="memory-book-year-num">{page.year}</p>
            <p className="memory-book-year-zh">我们的记忆从这里</p>
            <p className="memory-book-year-zh">慢慢留下来</p>
          </div>
        )
      }
      if (page.type === 'month') {
        return (
          <div className="memory-book-page memory-book-month-page" key={`m-${page.year}-${page.month}`}>
            <p className="memory-book-month-roman">{MONTHS_ROMAN[page.month]}</p>
            <p className="memory-book-month-zh">{page.month + 1} 月</p>
            <p className="memory-book-month-note">{page.count} 段被记住的事</p>
          </div>
        )
      }
      const mem = chronological[page.index]
      const d = mem?.timestamp == null ? null : new Date(mem.timestamp)
      return (
        <div className="memory-book-page memory-book-memory-page" key={`mem-${page.index}`}>
          {d ? (
            <p className="memory-book-meta">
              {MONTHS_EN[d.getMonth()]} · {d.getDate()} · {d.getFullYear()}
            </p>
          ) : (
            <p className="memory-book-meta">日期未知</p>
          )}
          <p className="memory-book-page-text">{mem?.item.text}</p>
          {mem?.item.source?.trim() ? (
            <>
              <span className="memory-book-page-sep" aria-hidden="true">·</span>
              <p className="memory-book-page-quote">「{mem.item.source.trim()}」</p>
            </>
          ) : null}
          {mem?.item.taReply?.trim() ? (
            <div className="memory-book-page-reply">
              <span className="memory-book-page-reply-label">TA 当时回应</span>
              <p className="memory-book-page-reply-text">{mem.item.taReply}</p>
            </div>
          ) : null}
        </div>
      )
    }

    return (
      <div className="memory-book-overlay" role="dialog" aria-modal="true" aria-label="记忆书正文">
        <div className="memory-book-body-page">
          <div
            className="memory-book-stage"
            onTouchStart={(e) => {
              touchX.current = e.touches[0]?.clientX ?? null
            }}
            onTouchEnd={(e) => {
              if (touchX.current == null) return
              const dx = (e.changedTouches[0]?.clientX ?? 0) - touchX.current
              touchX.current = null
              if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(e.changedTouches[0]?.clientY ?? 0)) {
                turnBook(dx < 0 ? 'next' : 'prev')
              }
            }}
          >
            {flipPage ? (
              <div className="memory-book-face is-back" aria-hidden="true">
                {renderBookPage(flipPage)}
              </div>
            ) : null}
            <div
              className={`memory-book-face is-front${flip ? ` is-flipping-${flip.dir}` : ''}`}
              onAnimationEnd={flip ? commitFlip : undefined}
            >
              {currentPage ? renderBookPage(currentPage) : null}
            </div>
          </div>

          <div className="memory-book-foot">
            <button
              type="button"
              className="memory-book-turn"
              onClick={() => turnBook('prev')}
              disabled={atStart || !!flip}
              aria-label="上一页"
            >
              ‹
            </button>
            <span className="memory-book-count">
              {bookPageIdx + 1} / {bookPages.length}
            </span>
            <button
              type="button"
              className="memory-book-turn"
              onClick={() => turnBook('next')}
              disabled={atEnd || !!flip}
              aria-label="下一页"
            >
              ›
            </button>
          </div>

          <button
            type="button"
            className="memory-book-exit"
            onClick={() => (bookFrom === 'detail' ? setView('detail') : setBookStage('cover'))}
          >
            {bookFrom === 'detail' ? '‹ 返回详情' : '‹ 返回封面'}
          </button>
        </div>
      </div>
    )
  }

  // ---- Detail ----
  if (view === 'detail' && selected) {
    const pinned = selected.item.pinned === true
    const d = selected.timestamp == null ? null : new Date(selected.timestamp)
    return (
      <div className="page memory-page memory-detail-page" ref={pageRef}>
        <div className="memory-local-bar">
          <button type="button" className="memory-back" onClick={() => setView('river')}>
            ‹ 记忆长河
          </button>
          <span className="memory-local-kicker">一段记忆</span>
        </div>
        <article className="memory-detail-layout">
          {d ? (
            <p className="memory-detail-meta">
              {MONTHS_EN[d.getMonth()]} · {d.getDate()} · {d.getFullYear()}
            </p>
          ) : (
            <p className="memory-detail-meta">日期未知</p>
          )}
          <span className="memory-detail-rule" aria-hidden="true" />
          <div className="memory-detail-source">
            <p className="memory-detail-source-label">当时你说</p>
            {selected.item.source?.trim() ? (
              <p className="memory-detail-source-text">「{selected.item.source.trim()}」</p>
            ) : (
              <p className="memory-detail-source-empty">没有保留当时原文</p>
            )}
          </div>
          {selected.kind === 'session' && selected.item.source?.trim() ? (
            <div className="memory-jump-row">
              <button
                type="button"
                className="memory-jump-trigger"
                onClick={() => void handleJumpToChatLog()}
                disabled={!onJumpToChatLog || jumpLoading}
              >
                {jumpLoading ? '正在定位…' : '看原对话'}
                <span aria-hidden="true">→</span>
              </button>
              {jumpNotice ? (
                <p className="memory-jump-notice" role="status">{jumpNotice}</p>
              ) : null}
            </div>
          ) : null}
          {selected.item.taReply?.trim() ? (
            <div className="memory-detail-reply">
              <p className="memory-detail-reply-label">TA 当时回应</p>
              <p className="memory-detail-reply-note">当时回应的记录</p>
              <p className="memory-detail-reply-text">「{selected.item.taReply.trim()}」</p>
            </div>
          ) : null}
          <div className="memory-detail-remembered">
            <div className="memory-detail-remembered-head">
              <p className="memory-detail-remembered-label">TA 最后记住</p>
              {!editing && !confirmingDelete ? (
                <>
                  <button type="button" className="memory-correction-trigger" onClick={beginCorrection}>纠正</button>
                  <button type="button" className="memory-delete-trigger" onClick={beginDelete}>删除</button>
                </>
              ) : null}
            </div>
            {confirmingDelete ? (
              <div className="memory-delete-confirm">
                <p className="memory-delete-ask">删掉这段记忆？删了 TA 就不会再记得它。</p>
                {deleteError ? <p className="memory-correction-error" role="alert">{deleteError}</p> : null}
                <div className="memory-correction-actions">
                  <button
                    type="button"
                    className="memory-correction-cancel"
                    onClick={cancelDelete}
                    disabled={deleting}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="memory-delete-confirm-btn"
                    onClick={() => void confirmDelete()}
                    disabled={deleting}
                  >
                    {deleting ? '删除中…' : '确认删除'}
                  </button>
                </div>
              </div>
            ) : null}
            {editing ? (
              <div className="memory-correction-editor">
                <textarea
                  className="memory-correction-input"
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value)
                    setSaveError('')
                  }}
                  rows={4}
                  autoFocus
                  aria-label="纠正 TA 最后记住的内容"
                />
                {saveError ? <p className="memory-correction-error" role="alert">{saveError}</p> : null}
                <div className="memory-correction-actions">
                  <button
                    type="button"
                    className="memory-correction-cancel"
                    onClick={() => {
                      setEditing(false)
                      setSaveError('')
                    }}
                    disabled={saving}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="memory-correction-save"
                    onClick={() => void saveCorrection()}
                    disabled={saving || !draft.trim()}
                  >
                    {saving ? '保存中…' : '保存'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="memory-detail-text">{selected.item.text}</p>
                {deriveMemoryTriggerWords(selected.item.text, selected.item.topic).length > 0 ? (
                  <div className="memory-trigger-row" aria-label="记忆触发词">
                    <span>触发词</span>
                    <div>
                      {deriveMemoryTriggerWords(selected.item.text, selected.item.topic).slice(0, 8).map((word) => (
                        <span key={word} className="memory-trigger-chip">{word}</span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
          {pinned ? (
            <p className="memory-detail-pin">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z" />
                <path d="M12 14v7" />
              </svg>
              TA 收下的
            </p>
          ) : null}
        </article>
      </div>
    )
  }

  // ---- 朝暮 · Status / Memory River / Events ----
  return (
    <div className="page memory-page chaomu-page" ref={pageRef}>
      <header className="memory-head chaomu-head">
        <span>
          <span className="memory-title">朝暮</span>
          <span className="chaomu-subtitle">状态 · 记忆长河 · 一起经历过</span>
        </span>
        <span className="memory-head-actions">
          <button
            type="button"
            className="home-web-refresh"
            onClick={() => void import('../lib/forceRefresh').then((m) => m.forceRefresh())}
            aria-label="检查页面更新"
            title="检查页面更新"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 12a8 8 0 1 1-2.34-5.66" />
              <path d="M20 4v4h-4" />
            </svg>
          </button>
        </span>
      </header>

      <section className="chaomu-status" aria-labelledby="chaomu-status-title">
        <div className="chaomu-section-head">
          <div>
            <span className="chaomu-section-kicker">STATUS</span>
            <h2 id="chaomu-status-title">状态</h2>
          </div>
        </div>
        <div className="chaomu-status-now">
          {stateView ? (
            <>
              <strong>{stateView.mood}</strong>
              <p>{stateView.description}</p>
              {statusLabel ? <span>{statusLabel}</span> : null}
            </>
          ) : (
            <p className="is-empty">现在还没有状态记录。</p>
          )}
        </div>
      </section>

      <section className="memory-river chaomu-memory-river" aria-label="记忆长河">
        <div className="chaomu-section-head">
          <div>
            <span className="chaomu-section-kicker">MEMORY RIVER</span>
            <h2>记忆长河</h2>
            {heroMeta ? <p className="memory-head-meta">{heroMeta}</p> : null}
          </div>
          <button
            type="button"
            className={`memory-audit-toggle${auditOpen ? ' is-open' : ''}`}
            onClick={() => {
              setAuditOpen((value) => !value)
              setRollbackNotice('')
            }}
            aria-expanded={auditOpen}
          >
            变更记录
          </button>
        </div>

        <label className="memory-search">
          <span className="sr-only">搜索记忆长河</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4 4" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索记忆"
            autoComplete="off"
          />
          {query ? (
            <button type="button" onClick={() => setQuery('')} aria-label="清空搜索">×</button>
          ) : null}
        </label>

        {auditOpen ? (
          <div className="memory-audit-panel">
            {rollbackNotice ? <p className="memory-audit-notice" role="status">{rollbackNotice}</p> : null}
            {audits.length === 0 ? (
              <p className="memory-audit-empty">还没有修改或删除记录。</p>
            ) : (
              <div className="memory-audit-list">
                {audits.slice(0, 24).map((entry) => {
                  const actionLabel = entry.action === 'edit'
                    ? '修改'
                    : entry.action === 'delete'
                      ? '删除'
                      : entry.action === 'rollback'
                        ? '回退'
                        : '存入'
                  const preview = entry.after?.text || entry.before?.text || ''
                  const rolledBack = audits.some((item) => item.parentAuditId === entry.id)
                  const canRollback = (entry.action === 'edit' || entry.action === 'delete') && Boolean(entry.before) && !rolledBack
                  return (
                    <article key={entry.id} className="memory-audit-item">
                      <div>
                        <span>{actionLabel}</span>
                        <time>{new Date(entry.at).toLocaleString()}</time>
                      </div>
                      <p>{preview}</p>
                      {canRollback ? (
                        <button
                          type="button"
                          disabled={rollbackBusyId !== null}
                          onClick={() => void rollbackAuditEntry(entry)}
                        >
                          {rollbackBusyId === entry.id ? '回退中…' : '回退到之前'}
                        </button>
                      ) : rolledBack ? <span className="memory-audit-done">已回退</span> : null}
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        ) : null}

        {memories.length === 0 ? (
          <div className="memory-empty">
            <span className="memory-empty-trace" aria-hidden="true">
              <span className="memory-empty-node" />
              <span className="memory-empty-line" />
              <span className="memory-empty-node" />
            </span>
            <h3 className="memory-empty-title">TA 还在慢慢认识你。</h3>
            <p className="memory-empty-copy">以后被记住的那些小事，会慢慢留在这里。</p>
          </div>
        ) : years.length === 0 ? (
          <p className="memory-search-empty">没有找到和「{query.trim()}」有关的记忆。</p>
        ) : (
          <>
            {years.length >= 2 ? (
              <nav className="memory-year-nav" aria-label="年份导航">
                {years
                  .filter((year) => year.key !== 'unknown')
                  .map((year) => (
                    <button
                      key={year.key}
                      type="button"
                      className={`memory-year-nav-btn${year === years[0] ? ' is-current' : ''}`}
                      onClick={() => scrollToYear(year.key)}
                    >
                      {year.label}
                    </button>
                  ))}
              </nav>
            ) : null}

            <div className="memory-river-flow">
              {years.map((year) => (
                <section key={year.key} className="memory-year-chapter" aria-labelledby={`memory-year-${year.key}`}>
                  <h4 id={`memory-year-${year.key}`} className="memory-year-chapter-label">
                    <span className="memory-year-chapter-num">{year.label}</span>
                  </h4>
                  {year.months.map((month) => (
                    <div key={month.key} className="memory-month-chapter">
                      <h5 className="memory-month-chapter-label">
                        <span className="memory-month-name">{month.label}</span>
                        <span className="memory-month-count">{month.items.length} 段记忆</span>
                      </h5>
                      <div className="memory-month-entries">
                        {month.items
                          .filter((memory) => (itemOrder.get(memory) ?? Infinity) < visibleCount)
                          .map((memory, index) => {
                            const { item, timestamp } = memory
                            const explicit = item.explicit === true
                            const pinned = item.pinned === true
                            const entryClass = [
                              'memory-entry',
                              pinned ? 'is-pinned' : '',
                              explicit ? 'is-explicit' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')
                            return (
                              <button
                                key={`${item.id}-${index}`}
                                type="button"
                                className={entryClass}
                                onClick={() => openDetail(memory)}
                              >
                                <span className="memory-entry-dot" aria-hidden="true">
                                  {pinned ? (
                                    <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true">
                                      <path d="M12 0l2.6 7.4L22 10l-7.4 2.6L12 20l-2.6-7.4L2 10l7.4-2.6Z" />
                                    </svg>
                                  ) : null}
                                </span>
                                <span className="memory-entry-body">
                                  <span className="memory-entry-content">
                                    <span className="memory-entry-text">{item.text}</span>
                                  </span>
                                  <span className="memory-entry-date">{shortDate(timestamp)}</span>
                                </span>
                              </button>
                            )
                          })}
                      </div>
                    </div>
                  ))}
                </section>
              ))}
            </div>
            {needsWindowing && visibleCount < riverItems.length ? (
              <div className="memory-river-sentinel" ref={sentinelRef} aria-hidden="true" />
            ) : null}
            <div className="memory-river-end" aria-hidden="true">
              <span className="memory-river-end-dot" />
            </div>
          </>
        )}
      </section>

      <section className="chaomu-events" aria-label="一起经历过">
        <EventArchive sessionId={sessionId || undefined} />
      </section>
    </div>
  )
}
