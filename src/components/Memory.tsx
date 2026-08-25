import { useEffect, useMemo, useRef, useState } from 'react'
import {
  anniversaryColorIndex,
  formatCountdown,
  getDefaultAnniversary,
  loadAnniversaries,
  resolveMainAnniversary,
  type Anniversary,
} from '../lib/anniversary'
import {
  addMemoryItem,
  getMemoryRecencyRank,
  inferTopic,
  loadMemory,
  removeMemoryItem,
  stripMemoryMarkers,
  togglePinMemory,
  updateMemoryItemContent,
  MEMORY_UPDATED_EVENT,
  type MemoryItem,
} from '../lib/memory'
import {
  buildKnownSince,
  buildSummaryMessages,
  buildTopTopicLine,
  cleanSummaryText,
  formatFirstRememberedDate,
  summarizeStats,
} from '../lib/memorySummary'
import { chatCompletion } from '../lib/api'
import { getToken } from '../lib/auth'
import { deleteMemory, listMemories, patchMemory, postMemory, type Session } from '../lib/sessionApi'
import {
  addMemoryCacheItem,
  getActiveSessionId,
  getMemoriesCache,
  getMessagesCache,
  getSessionsCache,
  mergeSessionMemories,
  reconcileMemoryCacheId,
  saveMemoriesCache,
  sessionMemoryToItem,
} from '../lib/sessionStore'
import { getFirstSeen, loadAIProfile, loadPersona, loadSettings, loadUserProfile, type StoredMessage } from '../lib/storage'
import { displaySessionName } from '../lib/sessionFlow'
import { roleInitial } from '../lib/sessionProfile'
import { computeDaysKnown, truncatePreview } from '../lib/aiSpaceDetail'

/** 主题色块：一组柔和配色，按主题名稳定取一个 */
const TOPIC_SOFT = [
  'topic-soft-0',
  'topic-soft-1',
  'topic-soft-2',
  'topic-soft-3',
  'topic-soft-4',
  'topic-soft-5',
]

function topicColorClass(topic: string): string {
  let h = 0
  for (const ch of topic) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TOPIC_SOFT[h % TOPIC_SOFT.length]
}

interface TopicGroup {
  topic: string
  items: MemoryItem[]
}

/** 条目上的轻量删除图标：细描边暖灰，hover 才明显 */
function DeleteIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
    </svg>
  )
}

/** 编辑按钮的铅笔图标：细描边暖灰，hover 才明显（与删除图标同一档位） */
function EditIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
    </svg>
  )
}

/** 「重要」标记按钮的星星图标：未标记空心、已标记实心（暖橘由 CSS currentColor 控制） */
function PinIcon({ pinned }: { pinned: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={pinned ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />
    </svg>
  )
}

/** 纪念日卡片标题的日历图标：细描边线条（暖橘由 CSS currentColor 控制） */
function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  )
}

/** 「相与书」卡片的本子图标：细描边线条，暖橘由 CSS currentColor 控制 */
function NotebookIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4h16v16H4z" />
      <path d="M8 2v20" />
      <path d="M11 8h5M11 12h5M11 16h5" />
    </svg>
  )
}

/** 双源信任来源小标记：用户明说的「你说的」（暖橘）/ TA 推断的「TA所忆」（暖灰），低调小字 */
function SourceTag({ explicit }: { explicit?: boolean }) {
  return explicit === true ? (
    <span className="memory-source-tag memory-source-user">你说的</span>
  ) : (
    <span className="memory-source-tag memory-source-ta">TA所忆</span>
  )
}

/** 超过这么多天没被提起就算「很久没提起」（展示小字，低调提示） */
const STALE_DAYS = 30
const STALE_MS = STALE_DAYS * 86400000

/** 很久没被提起：非重要 + 最近一次提起距今超过 30 天（没有 lastMentionedAt 的不算——可能是刚记的新鲜事） */
function isStaleMemory(m: MemoryItem, now: number): boolean {
  if (m.pinned === true) return false
  return typeof m.lastMentionedAt === 'number' && Number.isFinite(m.lastMentionedAt) && now - m.lastMentionedAt > STALE_MS
}

/** 组内最新一条的首次记录时间（组间排序用，保持「最近添加的组在前」的旧行为） */
function newestCreatedAt(items: MemoryItem[]): number {
  let max = 0
  for (const m of items) {
    if (typeof m.createdAt === 'number' && m.createdAt > max) max = m.createdAt
  }
  return max
}

/** 某会话最近一条消息摘要（画廊卡片小字；无消息返回空串） */
function lastMessageSummary(sessionId: string): string {
  const msgs = getMessagesCache(sessionId)
  if (msgs.length === 0) return ''
  const last = msgs.reduce<StoredMessage | null>((best, m) => (!best || m.ts > best.ts ? m : best), null)
  return last ? truncatePreview(stripMemoryMarkers(last.content), 18) : ''
}

/** 某会话相处天数小字：有认识起点就显示，否则空串 */
function daysKnownText(sessionId: string): string {
  const first = getFirstSeen(sessionId)
  if (!first) return ''
  return `认识第 ${computeDaysKnown(first)} 天`
}

/** 条目正文：编辑中显示内联输入框 + 保存/取消，平时显示原文 */
function MemoryItemTextEdit({
  m,
  editingId,
  editText,
  onEditChange,
  onEditSave,
  onEditCancel,
}: {
  m: MemoryItem
  editingId: string | null
  editText: string
  onEditChange: (v: string) => void
  onEditSave: () => void
  onEditCancel: () => void
}) {
  if (editingId !== m.id) return <p className="memory-item-text">{m.text}</p>
  return (
    <div className="memory-item-edit">
      <input
        className="input"
        value={editText}
        onChange={(e) => onEditChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onEditSave()
          else if (e.key === 'Escape') onEditCancel()
        }}
        autoFocus
      />
      <div className="memory-item-edit-actions">
        <button type="button" className="btn btn-ghost memory-edit-save" onClick={onEditSave}>
          保存
        </button>
        <button type="button" className="btn btn-ghost" onClick={onEditCancel}>
          取消
        </button>
      </div>
    </div>
  )
}

interface MemoryProps {
  /** 点纪念日小卡片 → 进纪念日管理页 */
  onOpenAnniversary?: () => void
  /** 点「相与书」卡片 → 进周记页 */
  onOpenWeekly?: () => void
  /** 忆览页「全部角色」画廊：点卡片 → 切会话并进该角色的 TA 空间 */
  onOpenSpaceForSession?: (sessionId: string) => void
}

export default function Memory({ onOpenAnniversary, onOpenWeekly, onOpenSpaceForSession }: MemoryProps) {
  // B2c-3 会话模式：有 activeSessionId → 记忆读当前会话缓存（后台拉后端填充，后端权威）；
  // 无会话（过渡态）→ 读本地 ai_companion_memory（原逻辑）
  const activeSessionId = getActiveSessionId()
  // 忆览页「全部角色」画廊：从会话缓存读全部角色（数据先接现状，精修是 P2）
  const [roleSessions] = useState<Session[]>(() => getSessionsCache())
  const [items, setItems] = useState<MemoryItem[]>(() =>
    activeSessionId ? getMemoriesCache(activeSessionId) : loadMemory(),
  )
  const [text, setText] = useState('')
  const [topic, setTopic] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // 内容编辑：editingId = 正在编辑的条目 id；editText = 编辑框草稿
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  // 会话模式上传/删除失败提示（成功后清除；本地模式不涉及，本地不会丢）
  const [memError, setMemError] = useState<string | null>(null)

  // 会话模式挂载：后台拉该会话记忆列表 → 与本地缓存合并（后端权威、缓存保留增强字段）→ 写缓存 + 上屏
  useEffect(() => {
    const sid = getActiveSessionId()
    if (!sid) return
    const token = getToken()
    if (!token) return
    let cancelled = false
    listMemories(token, sid).then((res) => {
      if (cancelled || !res.ok) return
      const cloud = res.data.memories.map(sessionMemoryToItem)
      const merged = mergeSessionMemories(getMemoriesCache(sid), cloud)
      saveMemoriesCache(sid, merged)
      setItems(merged)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 纪念日：用户亲手填的「重要的日子」，主展示计时显示在小卡片上，聊天时注入让 TA 记得。
  // 首次进入一条都没有时，用 getFirstSeen() 生成默认「认识纪念日」（只在没发过默认时给一次，删光了不复活）。
  const [anniversaries, setAnniversaries] = useState<Anniversary[]>(() => {
    const list = loadAnniversaries()
    if (list.length === 0) {
      const def = getDefaultAnniversary()
      if (def) return [def]
    }
    return list
  })

  // 主展示纪念日：记忆页小卡片上显示的那个（管理页可切换，null 默认取列表第一条）
  const mainAnniversary = useMemo(() => resolveMainAnniversary(anniversaries), [anniversaries])

  // 「TA 眼中的你」LLM 心里话：有配置才调，失败静默，同一批记忆只生成一次
  const [summary, setSummary] = useState<string | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const generatedKeyRef = useRef('')
  const summarySeqRef = useRef(0)

  // 数据变更自动刷新：聊天里 TA 刚记住的，切回记忆页（或别的页签）立刻能看到。
  // 会话模式读当前会话缓存，本地模式读本地记忆库；纪念日增删改也广播同一事件，这里一并刷新。
  useEffect(() => {
    const refresh = () => {
      const sid = getActiveSessionId()
      setItems(sid ? getMemoriesCache(sid) : loadMemory())
    }
    const refreshAnniversaries = () => setAnniversaries(loadAnniversaries())
    window.addEventListener(MEMORY_UPDATED_EVENT, refresh)
    window.addEventListener(MEMORY_UPDATED_EVENT, refreshAnniversaries)
    // storage 事件跨页签才触发，同页签不触发，所以上面还得靠自定义事件
    window.addEventListener('storage', refresh)
    window.addEventListener('storage', refreshAnniversaries)
    return () => {
      window.removeEventListener(MEMORY_UPDATED_EVENT, refresh)
      window.removeEventListener(MEMORY_UPDATED_EVENT, refreshAnniversaries)
      window.removeEventListener('storage', refresh)
      window.removeEventListener('storage', refreshAnniversaries)
    }
  }, [])

  // 汇总卡 LLM 区：记忆非空 + 有 key/base_url/模型 才调；失败静默，同一批记忆只生成一次。
  // 用 seq 序号作废在飞的旧请求（换了一批记忆 / 清空时），StrictMode 双跑靠 generatedKeyRef 去重。
  useEffect(() => {
    if (items.length === 0) {
      summarySeqRef.current++ // 作废在飞的请求
      setSummary(null)
      setSummaryLoading(false)
      return
    }
    const settings = loadSettings()
    if (!settings.apiKey?.trim() || !settings.baseUrl?.trim() || !settings.model?.trim()) {
      summarySeqRef.current++
      setSummaryLoading(false)
      return
    }

    const key = items.map((m) => m.id).join('|')
    if (key === generatedKeyRef.current) return
    generatedKeyRef.current = key

    const seq = ++summarySeqRef.current
    setSummaryLoading(true)
    const persona = loadPersona()
    const ai = loadAIProfile()
    const yourName = loadUserProfile().nickname || '你'
    chatCompletion(settings, buildSummaryMessages(ai.nickname, yourName, persona, items), {
      maxTokens: 200,
      timeoutMs: 30000,
    })
      .then((raw) => {
        if (seq !== summarySeqRef.current) return
        setSummary(cleanSummaryText(raw))
      })
      .catch(() => {
        // 失败静默：只留统计区
      })
      .finally(() => {
        if (seq === summarySeqRef.current) setSummaryLoading(false)
      })
  }, [items])

  // 按主题动态分组：旧数据没主题就按关键词推断；组按最近添加时间排序，组内按「活跃度」排序
  const groups = useMemo<TopicGroup[]>(() => {
    const now = Date.now()
    const map = new Map<string, MemoryItem[]>()
    for (const m of items) {
      const t = m.topic?.trim() || inferTopic(m.text)
      const list = map.get(t) ?? []
      list.push(m)
      map.set(t, list)
    }
    return Array.from(map.entries())
      .map(([t, list]) => ({
        topic: t,
        // 组内按「活跃度」排序：重要记忆恒排最前，其余按最近提起/想起的靠前，没有的按首次记录时间兜底（与对话注入一致）
        items: getMemoryRecencyRank(list, now),
      }))
      .sort((a, b) => newestCreatedAt(b.items) - newestCreatedAt(a.items))
  }, [items])

  // 顶部汇总：统计 / 一句话点评 / 最早一条
  const stats = useMemo(() => summarizeStats(items), [items])
  const topTopicLine = useMemo(() => buildTopTopicLine(stats.topTopic), [stats.topTopic])
  const knownSinceLine = stats.earliestTs != null ? buildKnownSince(stats.earliestTs) : ''

  // 「很久没提起」小字标签的判断基准：当前时刻（30 天窗口，渲染时取一次即可）
  const now = Date.now()

  const handleAdd = () => {
    const t = text.trim()
    if (!t) return
    const sid = getActiveSessionId()
    if (sid) {
      // 会话模式：乐观写当前会话缓存（手动添加 = 用户明说 explicit=true），再异步 postMemory 上传
      const item = addMemoryCacheItem(sid, t, topic, true)
      setItems(getMemoriesCache(sid))
      const token = getToken()
      if (item && token) {
        postMemory(token, sid, { content: t }).then((res) => {
          if (res.ok) {
            reconcileMemoryCacheId(sid, item.id, res.data.id)
            setItems(getMemoriesCache(sid))
            setMemError(null)
          } else {
            // 失败提示 + 保留本地缓存（不丢），稍后编辑该条会重新上传
            setMemError('这条记忆没能上传，已留在本地，稍后可再试')
          }
        })
      }
    } else {
      setItems(addMemoryItem(t, topic, true))
    }
    setText('')
    setTopic('')
  }

  const handleRemove = (id: string) => {
    const sid = getActiveSessionId()
    if (sid) {
      const list = getMemoriesCache(sid)
      const item = list.find((m) => m.id === id)
      // 乐观先删缓存；有后端 id 的条目（纯数字 id）再异步 deleteMemory，失败回滚保留本地
      saveMemoriesCache(sid, list.filter((m) => m.id !== id))
      setItems(getMemoriesCache(sid))
      const token = getToken()
      if (item && token && /^\d+$/.test(item.id)) {
        deleteMemory(token, item.id).then((res) => {
          if (res.ok) {
            setMemError(null)
            return
          }
          const cur = getMemoriesCache(sid)
          if (!cur.some((m) => m.id === item.id)) {
            saveMemoriesCache(sid, [item, ...cur])
            setItems(getMemoriesCache(sid))
          }
          setMemError('删除没成功，这条记忆留在了本地')
        })
      }
    } else {
      setItems(removeMemoryItem(id))
    }
  }

  const handleTogglePin = (id: string) => {
    const sid = getActiveSessionId()
    if (sid) {
      // pinned 是本地增强字段，后端不存：会话模式只更新缓存
      const next = getMemoriesCache(sid).map((m) => (m.id === id ? { ...m, pinned: !m.pinned } : m))
      saveMemoriesCache(sid, next)
      setItems(next)
    } else {
      setItems(togglePinMemory(id))
    }
  }

  const handleEditStart = (m: MemoryItem) => {
    setEditingId(m.id)
    setEditText(m.text)
  }

  const handleEditCancel = () => {
    setEditingId(null)
    setEditText('')
  }

  const handleEditSave = () => {
    const t = editText.trim()
    if (!t || !editingId) return
    const sid = getActiveSessionId()
    if (sid) {
      const list = getMemoriesCache(sid)
      const item = list.find((m) => m.id === editingId)
      // 乐观更新缓存文本；后端已有该条（纯数字 id）→ patchMemory，失败回滚原文；
      // 还没上传成功的条目 → 编辑等同重新上传（失败提示，本地不丢）
      const next = list.map((m) => (m.id === editingId ? { ...m, text: t } : m))
      saveMemoriesCache(sid, next)
      setItems(next)
      const token = getToken()
      if (item && token) {
        if (/^\d+$/.test(item.id)) {
          patchMemory(token, item.id, { content: t }).then((res) => {
            if (res.ok) {
              setMemError(null)
              return
            }
            const rollback = getMemoriesCache(sid).map((m) => (m.id === editingId ? { ...m, text: item.text } : m))
            saveMemoriesCache(sid, rollback)
            setItems(rollback)
            setMemError('修改没保存成功，已恢复原文')
          })
        } else {
          postMemory(token, sid, { content: t }).then((res) => {
            if (res.ok) {
              reconcileMemoryCacheId(sid, editingId, res.data.id)
              setMemError(null)
            } else {
              setMemError('这条记忆没能上传，已留在本地，稍后可再试')
            }
          })
        }
      }
    } else {
      setItems(updateMemoryItemContent(editingId, t))
    }
    setEditingId(null)
    setEditText('')
  }

  const toggleTopic = (t: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  return (
    <div className="page memory-page">
      <h2 className="memory-page-title">我的忆录</h2>
      <p className="page-desc">
        TA 会把你放在心上的一句话记下来，下次见面还记得。
        <br />
        {activeSessionId
          ? '记忆会跟着你的账号走，每个 TA 分开记。'
          : '这些记忆只留在你的浏览器里，不会传到任何地方。'}
      </p>

      {!activeSessionId && (
        <div className="memory-session-guide">
          <p>当前还没在会话里，记忆只存在这台设备上。</p>
          <p>选好 TA 开始聊之后，记忆会跟着账号走，每个 TA 分开记。</p>
        </div>
      )}

      {/* 全部角色的卡片画廊：点卡片进该角色的 TA 空间（数据先接现状，精修是 P2） */}
      {roleSessions.length > 0 && (
        <section className="memory-roles" aria-label="全部角色">
          <h3 className="memory-roles-title">全部角色</h3>
          <div className="memory-roles-grid">
            {roleSessions.map((s) => {
              const id = String(s.id)
              const name = displaySessionName(s)
              const sub = lastMessageSummary(id) || daysKnownText(id) || '还没有消息'
              return (
                <button
                  key={id}
                  type="button"
                  className="memory-role-card"
                  onClick={() => onOpenSpaceForSession?.(id)}
                  aria-label={`进入 ${name} 的空间`}
                >
                  <span className="memory-role-avatar" aria-hidden="true">
                    {roleInitial(name)}
                  </span>
                  <span className="memory-role-name">{name}</span>
                  <span className="memory-role-sub">{sub}</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* 「相与书」入口卡片：跟纪念日小卡片同一档样式，点进周记页 */}
      {onOpenWeekly && (
        <button type="button" className="anniversary-strip" onClick={onOpenWeekly}>
          <span className="anniversary-strip-icon" aria-hidden="true">
            <NotebookIcon />
          </span>
          <span className="anniversary-strip-title">相与书</span>
          <span className="anniversary-strip-main">
            <span className="anniversary-strip-label">TA每周最多写下一篇周记，记录自己的生活与心绪，你可以阅读并留下感想</span>
          </span>
          <span className="anniversary-strip-arrow" aria-hidden="true">
            ›
          </span>
        </button>
      )}

      {memError && <p className="memory-error">{memError}</p>}

      {stats.count > 0 && (
        <section className="memory-summary-card">
          <div className="memory-summary-head">
            <h3 className="memory-summary-title">TA 眼中的你</h3>
            {summaryLoading && <span className="memory-summary-hint">TA 正在回忆你…</span>}
          </div>
          <p className="memory-summary-stats">
            TA 记得你 <strong>{stats.count}</strong> 件事 · 分布在 <strong>{stats.topicCount}</strong> 个主题
            {stats.pinnedCount > 0 && (
              <span> · 其中 <strong>{stats.pinnedCount}</strong> 件是重要的</span>
            )}
            {knownSinceLine && <span> · {knownSinceLine}</span>}
          </p>
          {topTopicLine && <p className="memory-summary-top">{topTopicLine}</p>}
          {summary && <p className="memory-summary-llm">{summary}</p>}
        </section>
      )}

      {/* 纪念日小卡片：一行高度（像笺的大小），显示主纪念日计时；点任意处进管理页添加/编辑/切换 */}
      <button type="button" className="anniversary-strip" onClick={onOpenAnniversary}>
        <span className="anniversary-strip-icon" aria-hidden="true">
          <CalendarIcon />
        </span>
        <span className="anniversary-strip-title">相逢纪</span>
        <span className="anniversary-strip-main">
          {mainAnniversary ? (
            <>
              <span className={`anniversary-strip-count ann-color-${anniversaryColorIndex(mainAnniversary.color)}`}>
                {formatCountdown(mainAnniversary)}
              </span>
              <span className="anniversary-strip-label">{mainAnniversary.label}</span>
            </>
          ) : (
            <span className="anniversary-strip-empty">记下你们重要的日子</span>
          )}
        </span>
        <span className="anniversary-strip-arrow" aria-hidden="true">
          ›
        </span>
      </button>

      <div className="memory-input-row">
        <input
          className="input"
          type="text"
          placeholder="想让 TA 记住什么？比如：我叫小七"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd()
          }}
        />
        <input
          className="input memory-topic-input"
          type="text"
          placeholder="主题"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd()
          }}
        />
      </div>
      <button className="btn btn-primary memory-add-btn" onClick={handleAdd}>
        记住
      </button>

      {groups.length === 0 ? (
        <div className="memory-empty">
          <svg
            className="memory-empty-mark"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
          <p className="memory-empty-title">TA 会慢慢记住你说的话</p>
          <p className="memory-empty-sub">
            聊天时随口说说你的喜欢、你的日子，
            <br />
            或者在上面亲手写下一句，都好。
          </p>
        </div>
      ) : (
        <div className="memory-topics">
          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.topic)
            return (
              <section key={g.topic} className="memory-topic-card">
                <button
                  type="button"
                  className="memory-topic-head"
                  onClick={() => toggleTopic(g.topic)}
                  aria-expanded={!isCollapsed}
                >
                  <span className={`memory-topic-name ${topicColorClass(g.topic)}`}>{g.topic}</span>
                  <span className="memory-topic-count">{g.items.length} 条</span>
                  <svg
                    className={`memory-topic-chevron${isCollapsed ? ' collapsed' : ''}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {!isCollapsed && (
                  <div className="memory-topic-body">
                    {g.items[0] && (
                      <div className="memory-item memory-item-featured">
                        <MemoryItemTextEdit
                          m={g.items[0]}
                          editingId={editingId}
                          editText={editText}
                          onEditChange={setEditText}
                          onEditSave={handleEditSave}
                          onEditCancel={handleEditCancel}
                        />
                        <div className="memory-item-foot">
                          <SourceTag explicit={g.items[0].explicit} />
                          <span className="memory-item-date">{formatFirstRememberedDate(g.items[0].createdAt)}</span>
                          {g.items[0].source && (
                            <span className="memory-item-source">来自「{g.items[0].source}」</span>
                          )}
                          {isStaleMemory(g.items[0], now) && <span className="memory-item-stale">很久没提起</span>}
                        </div>
                        <div className="memory-item-actions">
                          <button
                            type="button"
                            className="memory-edit"
                            onClick={() => handleEditStart(g.items[0])}
                            aria-label="编辑这条记忆"
                          >
                            <EditIcon />
                          </button>
                          <button
                            type="button"
                            className={`memory-pin${g.items[0].pinned ? ' pinned' : ''}`}
                            onClick={() => handleTogglePin(g.items[0].id)}
                            aria-label={g.items[0].pinned ? '取消重要标记' : '标记为重要'}
                            aria-pressed={Boolean(g.items[0].pinned)}
                          >
                            <PinIcon pinned={Boolean(g.items[0].pinned)} />
                            {g.items[0].pinned && <span className="memory-pin-label">重要</span>}
                          </button>
                          <button
                            className="memory-delete"
                            onClick={() => handleRemove(g.items[0].id)}
                            aria-label="删除这条记忆"
                          >
                            <DeleteIcon />
                          </button>
                        </div>
                      </div>
                    )}
                    {g.items.length > 1 && (
                      <ul className="memory-topic-items">
                        {g.items.slice(1).map((m) => (
                          <li key={m.id} className="memory-item">
                            <MemoryItemTextEdit
                              m={m}
                              editingId={editingId}
                              editText={editText}
                              onEditChange={setEditText}
                              onEditSave={handleEditSave}
                              onEditCancel={handleEditCancel}
                            />
                            <div className="memory-item-foot">
                              <SourceTag explicit={m.explicit} />
                              <span className="memory-item-date">{formatFirstRememberedDate(m.createdAt)}</span>
                              {m.source && <span className="memory-item-source">来自「{m.source}」</span>}
                              {isStaleMemory(m, now) && <span className="memory-item-stale">很久没提起</span>}
                            </div>
                            <div className="memory-item-actions">
                              <button
                                type="button"
                                className="memory-edit"
                                onClick={() => handleEditStart(m)}
                                aria-label="编辑这条记忆"
                              >
                                <EditIcon />
                              </button>
                              <button
                                type="button"
                                className={`memory-pin${m.pinned ? ' pinned' : ''}`}
                                onClick={() => handleTogglePin(m.id)}
                                aria-label={m.pinned ? '取消重要标记' : '标记为重要'}
                                aria-pressed={Boolean(m.pinned)}
                              >
                                <PinIcon pinned={Boolean(m.pinned)} />
                                {m.pinned && <span className="memory-pin-label">重要</span>}
                              </button>
                              <button
                                className="memory-delete"
                                onClick={() => handleRemove(m.id)}
                                aria-label="删除这条记忆"
                              >
                                <DeleteIcon />
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
