import { useEffect, useMemo, useState } from 'react'
import { getActiveSessionId, getSessionsCache } from '../lib/sessionStore'
import { getFirstSeen } from '../lib/storage'
import { computeDaysKnown } from '../lib/aiSpaceDetail'
import {
  ANNIVERSARY_COLORS,
  addAnniversary,
  anniversaryColorIndex,
  formatAnniversaryDate,
  formatCountdown,
  getMainAnniversaryId,
  isMilestoneAnniversary,
  isValidAnniversaryDate,
  mergeDuplicateAnniversaries,
  readRoleAnniversaries,
  removeAnniversary,
  resolveMainAnniversary,
  setMainAnniversaryId,
  sortAnniversariesByNext,
  updateAnniversary,
  type Anniversary,
  type CountMode,
} from '../lib/anniversary'
import { MEMORY_UPDATED_EVENT } from '../lib/memory'
import { loadCurrentPosts } from '../lib/aiSpace'
import { timeAgo } from '../lib/time'
import { displaySessionName } from '../lib/sessionFlow'

interface Props {
  /** 「和 TA 说说话」→ 聊天页 */
  onGoChat: () => void
  /** 「TA 的生活 · 全部」→ TA 的生活页（修正批：不再跳空间） */
  onGoLife: () => void
}

/** 按时段问候（凌晨/早上/上午/中午/下午/晚上/夜深） */
function greeting(now: Date): string {
  const h = now.getHours()
  if (h < 5) return '夜深了'
  if (h < 9) return '早上好'
  if (h < 12) return '上午好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  if (h < 22) return '晚上好'
  return '夜深了'
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 时间戳 → 2026.08.15 */
function fmtFull(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`
}

/* ---- 线条图标（与全站同一种描边风格） ---- */

const PlusIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
)

const EditIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
)

const DeleteIcon = () => (
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

export default function Home({ onGoChat, onGoLife }: Props) {
  const sid = getActiveSessionId() || undefined
  const firstSeen = useMemo(() => getFirstSeen(sid), [sid])
  // 顶部大字「和 TA 的第 N 天」：唯一数据源 firstSeen 现算，不读任何纪念日数据（批 2-1）
  const days = useMemo(() => computeDaysKnown(firstSeen), [firstSeen])
  const posts = useMemo(() => loadCurrentPosts(sid), [sid])
  // TA 此刻：优先取事件动态（AI Space v3 生成的生活快照），没有则取最近一条
  const momentPost = useMemo(
    () => posts.find((p) => p.source === 'event') ?? posts[0],
    [posts],
  )
  // TA 的生活：最近一条动态；避免和「此刻」重复，优先取另一条
  const lifePost = useMemo(
    () => posts.find((p) => p.id !== momentPost?.id) ?? posts[0],
    [posts, momentPost],
  )

  // ---- 纪念日区（批 2-1：独立纪念日页取消，内容全在首页）----
  // 当前角色数据：默认纪念日 + 用户自建（双人）+ 里程碑都在角色 key；个人节日不混进来
  const [anniversaries, setAnniversaries] = useState<Anniversary[]>(() =>
    readRoleAnniversaries(sid).filter((a) => a.kind !== 'personal'),
  )
  // 候选（可设为主展示）= 非里程碑、合并重复；主展示只能从「用户自建 + 认识 TA 的日子」里选
  const mainCandidates = useMemo(
    () => mergeDuplicateAnniversaries(anniversaries.filter((a) => !isMilestoneAnniversary(a))),
    [anniversaries],
  )
  // 主展示大卡：有主展示 id 且还在候选里 → 用那条；否则回落候选第一条（resolveMainAnniversary 语义）
  const mainAnniv = useMemo(() => resolveMainAnniversary(mainCandidates, sid), [mainCandidates, sid])
  // 其他纪念日列表：候选去掉主展示，按「下一次最近」升序（重复已合并）
  const otherList = useMemo(
    () => sortAnniversariesByNext(mainCandidates.filter((a) => a.id !== mainAnniv?.id)),
    [mainCandidates, mainAnniv],
  )
  // 里程碑折叠：系统自动生成的「在一起 X 天」，只读、不能设为主展示
  const milestones = useMemo(() => anniversaries.filter((a) => isMilestoneAnniversary(a)), [anniversaries])
  // 其他角色的纪念日：折叠分组放下面（数据不删，只是不混进当前 TA）
  const otherRoles = useMemo(() => {
    if (!sid) return []
    return getSessionsCache()
      .filter((s) => String(s.id) !== sid)
      .map((s) => {
        const id = String(s.id)
        const list = mergeDuplicateAnniversaries(readRoleAnniversaries(id).filter((a) => a.kind !== 'personal'))
        return { id, name: displaySessionName(s), list }
      })
      .filter((r) => r.list.length > 0)
  }, [sid, anniversaries])

  // 数据变更自动刷新：空间/别处改了纪念日，首页立刻同步
  useEffect(() => {
    const refresh = () => {
      setAnniversaries(readRoleAnniversaries(getActiveSessionId() || undefined).filter((a) => a.kind !== 'personal'))
    }
    window.addEventListener(MEMORY_UPDATED_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(MEMORY_UPDATED_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  // 添加 / 编辑表单
  const [formMode, setFormMode] = useState<'idle' | 'add' | 'edit'>('idle')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [date, setDate] = useState('')
  const [countMode, setCountMode] = useState<CountMode>('forward')
  const [color, setColor] = useState('warm-orange')
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)

  const resetForm = () => {
    setFormMode('idle')
    setEditingId(null)
    setLabel('')
    setDate('')
    setCountMode('forward')
    setColor('warm-orange')
    setConfirmingDelete(null)
  }

  // 点列表条目 → 设为主展示（主展示大卡跟着变；已经是主展示的点了没变化）
  const handleSetMain = (id: string) => {
    if (mainAnniv?.id === id) return
    setMainAnniversaryId(id, sid)
  }

  const startAdd = () => {
    resetForm()
    setFormMode('add')
  }

  const startEdit = (a: Anniversary) => {
    resetForm()
    setEditingId(a.id)
    setLabel(a.label)
    setDate(a.date)
    setCountMode(a.countMode ?? 'forward')
    setColor(a.color || 'warm-orange')
    setFormMode('edit')
  }

  const handleSubmit = () => {
    const l = label.trim()
    const d = date.trim()
    if (!l || !isValidAnniversaryDate(d)) return
    if (formMode === 'edit' && editingId != null) {
      setAnniversaries(updateAnniversary(editingId, l, d, { countMode, color }, sid))
    } else {
      const next = addAnniversary(l, d, { countMode, color }, sid)
      setAnniversaries(next.filter((a) => a.kind !== 'personal'))
      // 第一个纪念日：没设过主展示就自动设成主展示，大卡直接能看到
      if (getMainAnniversaryId(sid) == null && next.length === 1) {
        setMainAnniversaryId(next[0].id, sid)
      }
    }
    resetForm()
  }

  const handleDelete = (id: string) => {
    const wasMain = mainAnniv?.id === id
    setAnniversaries(removeAnniversary(id, sid).filter((a) => a.kind !== 'personal'))
    if (wasMain) {
      // 删的是主展示 → 清掉主展示 id，回落到默认取候选第一条
      setMainAnniversaryId(null, sid)
    }
    setConfirmingDelete(null)
  }

  return (
    <div className="home-page">
      <div className="home-inner">
        {/* 品牌区 */}
        <div className="home-brand">
          <span className="home-brand-logo" aria-hidden="true">
            忆
          </span>
          <div className="home-brand-text">
            <span className="home-brand-name">忆文</span>
            <span className="home-brand-en">ELUVIN</span>
          </div>
        </div>

        {/* 问候 + 认识天数（唯一数据源 firstSeen 现算） */}
        <p className="home-greeting">{greeting(new Date())}</p>
        <h2 className="home-days-title">和 TA 的第 {days} 天</h2>
        <p className="home-days-range">
          {fmtFull(firstSeen)} — 今天
        </p>

        {/* 重要倒计时：主展示纪念日大卡（主展示只能从用户自建 + 认识 TA 的日子 里选） */}
        <div className="home-section-head">
          <span className="home-section-title">重要倒计时</span>
          <span className="home-section-en">COUNTDOWNS</span>
        </div>
        <div className="home-countdowns">
          {mainAnniv ? (
            <div className="home-count-card home-count-card-main">
              <p className="home-count-label">{mainAnniv.label}</p>
              <p className="home-count-num">{formatCountdown(mainAnniv)}</p>
              <p className="home-count-sub">{formatAnniversaryDate(mainAnniv.date)}</p>
            </div>
          ) : (
            <div className="home-count-card">
              <p className="home-count-label">还没有纪念日</p>
              <p className="home-count-num">—</p>
              <p className="home-count-sub">在下面添加一个吧</p>
            </div>
          )}
        </div>

        {/* 其他纪念日：当前角色、按临近排序、重复已合并；点条目 = 设为主展示；右侧编辑/删除 */}
        {otherList.length > 0 && (
          <div className="home-ann-list">
            {otherList.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`home-ann-item${mainAnniv?.id === a.id ? ' is-main' : ''}`}
                onClick={() => handleSetMain(a.id)}
                aria-label={`设为主展示：${a.label}`}
              >
                <span
                  className={`anniversary-page-dot ann-color-${anniversaryColorIndex(a.color)}`}
                  aria-hidden="true"
                />
                <span className="home-ann-info">
                  <span className="home-ann-label">
                    {a.label}
                    {mainAnniv?.id === a.id && <span className="home-ann-main-tag">主展示</span>}
                  </span>
                  <span className="home-ann-meta">
                    {formatAnniversaryDate(a.date)} · {formatCountdown(a)}
                  </span>
                </span>
                <span className="home-ann-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="home-ann-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      startEdit(a)
                    }}
                    aria-label={`编辑「${a.label}」`}
                  >
                    <EditIcon />
                  </button>
                  {confirmingDelete === a.id ? (
                    <span className="anniversary-confirm">
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => handleDelete(a.id)}>
                        删除
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          setConfirmingDelete(null)
                        }}
                      >
                        取消
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="home-ann-btn danger"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmingDelete(a.id)
                      }}
                      aria-label={`删除「${a.label}」`}
                    >
                      <DeleteIcon />
                    </button>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* 里程碑折叠：系统自动生成的「在一起 X 天」，只读、不能设为主展示 */}
        {milestones.length > 0 && (
          <details className="anniversary-other-group anniversary-milestone-section">
            <summary className="anniversary-other-summary">
              <span className="anniversary-other-name">里程碑</span>
              <span className="anniversary-other-count">{milestones.length} 个 · 自动记录</span>
              <span className="anniversary-other-caret" aria-hidden="true">
                ›
              </span>
            </summary>
            <ul className="anniversary-page-list">
              {milestones.map((a) => (
                <li key={a.id} className="anniversary-page-item is-readonly">
                  <div className="anniversary-page-info">
                    <span className="anniversary-page-label">
                      <span
                        className={`anniversary-page-dot ann-color-${anniversaryColorIndex(a.color)}`}
                        aria-hidden="true"
                      />
                      {a.label}
                    </span>
                    <span className="anniversary-page-meta">
                      <span className="anniversary-page-date">{formatAnniversaryDate(a.date)}</span>
                      <span className="anniversary-count is-forward">{formatCountdown(a)}</span>
                      <span className="anniversary-milestone-tag">里程碑</span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}

        {/* 其他角色的纪念日：折叠分组（数据不删，只是不打扰当前 TA） */}
        {otherRoles.length > 0 && (
          <details className="anniversary-other-group anniversary-others-section">
            <summary className="anniversary-other-summary">
              <span className="anniversary-other-name">其他角色</span>
              <span className="anniversary-other-count">他们的日子也都在</span>
              <span className="anniversary-other-caret" aria-hidden="true">
                ›
              </span>
            </summary>
            {otherRoles.map((role) => (
              <details key={role.id} className="anniversary-other-group anniversary-other-group-nested">
                <summary className="anniversary-other-summary">
                  <span className="anniversary-other-name">{role.name}</span>
                  <span className="anniversary-other-count">{role.list.length} 个纪念日</span>
                  <span className="anniversary-other-caret" aria-hidden="true">
                    ›
                  </span>
                </summary>
                <ul className="anniversary-page-list">
                  {role.list.map((a) => (
                    <li key={a.id} className="anniversary-page-item is-readonly">
                      <div className="anniversary-page-info">
                        <span className="anniversary-page-label">
                          <span
                            className={`anniversary-page-dot ann-color-${anniversaryColorIndex(a.color)}`}
                            aria-hidden="true"
                          />
                          {a.label}
                        </span>
                        <span className="anniversary-page-meta">
                          <span className="anniversary-page-date">{formatAnniversaryDate(a.date)}</span>
                          <span className={`anniversary-count${a.countMode === 'countdown' ? '' : ' is-forward'}`}>
                            {formatCountdown(a)}
                          </span>
                          {isMilestoneAnniversary(a) && <span className="anniversary-milestone-tag">里程碑</span>}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </details>
        )}

        {/* 添加一个纪念日 */}
        {formMode === 'idle' && (
          <button type="button" className="home-ann-add" onClick={startAdd}>
            <PlusIcon />
            添加一个纪念日
          </button>
        )}

        {/* 添加 / 编辑表单 */}
        {(formMode === 'add' || formMode === 'edit') && (
          <form
            className="anniversary-form"
            onSubmit={(e) => {
              e.preventDefault()
              handleSubmit()
            }}
          >
            <h3 className="anniversary-form-title">{formMode === 'edit' ? '编辑纪念日' : '添加纪念日'}</h3>
            <input
              className="input"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="名称，如 在一起纪念日"
              autoFocus
            />
            <input
              className="input"
              type="text"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              placeholder="日期：08-22（每年）或 2026-08-22（一次）"
            />
            <div className="anniversary-form-mode">
              <span className="anniversary-form-label">计时</span>
              <div className="anniversary-mode-options">
                <label className={`anniversary-mode-option${countMode === 'forward' ? ' active' : ''}`}>
                  <input
                    type="radio"
                    name="ann-count-mode"
                    checked={countMode === 'forward'}
                    onChange={() => setCountMode('forward')}
                  />
                  正计时（已经 X 天）
                </label>
                <label className={`anniversary-mode-option${countMode === 'countdown' ? ' active' : ''}`}>
                  <input
                    type="radio"
                    name="ann-count-mode"
                    checked={countMode === 'countdown'}
                    onChange={() => setCountMode('countdown')}
                  />
                  倒计时（还剩 X 天）
                </label>
              </div>
            </div>
            <div className="anniversary-form-color">
              <span className="anniversary-form-label">主题色</span>
              <div className="anniversary-color-options">
                {ANNIVERSARY_COLORS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={`anniversary-color-swatch ann-color-${anniversaryColorIndex(c.key)}${
                      color === c.key ? ' selected' : ''
                    }`}
                    onClick={() => setColor(c.key)}
                    aria-label={`主题色 ${c.label}`}
                    title={c.label}
                  />
                ))}
              </div>
            </div>
            <div className="anniversary-form-actions">
              <button type="submit" className="btn btn-primary btn-sm">
                保存
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={resetForm}>
                取消
              </button>
            </div>
          </form>
        )}

        {/* TA 此刻 */}
        <div className="home-section-head">
          <span className="home-section-title">TA 此刻</span>
        </div>
        <p className="home-moment">
          {momentPost ? momentPost.text : 'TA 正过着寻常的一天。'}
        </p>

        {/* 主按钮 */}
        <button type="button" className="btn btn-primary home-chat-btn" onClick={onGoChat}>
          和 TA 说说话
        </button>

        {/* TA 的生活 */}
        <div className="home-life-head">
          <div className="home-section-head">
            <span className="home-section-title">TA 的生活</span>
          </div>
          <button type="button" className="home-more" onClick={onGoLife}>
            全部 ›
          </button>
        </div>
        {lifePost ? (
          <div className="home-life-card">
            <p className="home-life-text">{lifePost.text}</p>
            <p className="home-life-time">{timeAgo(lifePost.at)}</p>
          </div>
        ) : (
          <div className="home-life-card home-life-empty">
            <p className="home-life-text">TA 还没有分享生活。</p>
            <p className="home-life-time">去空间看看</p>
          </div>
        )}
      </div>
    </div>
  )
}
