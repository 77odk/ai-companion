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
  togglePinMemory,
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
import { loadAIProfile, loadPersona, loadSettings, loadUserProfile } from '../lib/storage'

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

/** 双源信任来源小标记：用户明说的「你说的」（暖橘）/ TA 推断的「TA 记得的」（暖灰），低调小字 */
function SourceTag({ explicit }: { explicit?: boolean }) {
  return explicit === true ? (
    <span className="memory-source-tag memory-source-user">你说的</span>
  ) : (
    <span className="memory-source-tag memory-source-ta">TA 记得的</span>
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

interface MemoryProps {
  /** 点纪念日小卡片 → 进纪念日管理页 */
  onOpenAnniversary?: () => void
}

export default function Memory({ onOpenAnniversary }: MemoryProps) {
  const [items, setItems] = useState<MemoryItem[]>(() => loadMemory())
  const [text, setText] = useState('')
  const [topic, setTopic] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

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

  // 数据变更自动刷新：聊天里 TA 刚记住的，切回记忆页（或别的页签）立刻能看到
  // 纪念日增删改也会广播同一个事件，这里一并刷新
  useEffect(() => {
    const refresh = () => setItems(loadMemory())
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
    // 手动输入框添加 = 用户亲口说的 → explicit=true（双源信任：用户明说优先）
    setItems(addMemoryItem(t, topic, true))
    setText('')
    setTopic('')
  }

  const handleRemove = (id: string) => {
    setItems(removeMemoryItem(id))
  }

  const handleTogglePin = (id: string) => {
    setItems(togglePinMemory(id))
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
      <p className="page-desc">
        TA 会把你放在心上的一句话记下来，下次见面还记得。
        <br />
        这些记忆只留在你的浏览器里，不会传到任何地方。
      </p>

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
        <span className="anniversary-strip-title">纪念日</span>
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
                        <p className="memory-item-text">{g.items[0].text}</p>
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
                            <p className="memory-item-text">{m.text}</p>
                            <div className="memory-item-foot">
                              <SourceTag explicit={m.explicit} />
                              <span className="memory-item-date">{formatFirstRememberedDate(m.createdAt)}</span>
                              {m.source && <span className="memory-item-source">来自「{m.source}」</span>}
                              {isStaleMemory(m, now) && <span className="memory-item-stale">很久没提起</span>}
                            </div>
                            <div className="memory-item-actions">
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
