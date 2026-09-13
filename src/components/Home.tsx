import { useEffect, useMemo, useState } from 'react'
import { getActiveSessionId, getBusyState, getSessionsCache, getSessionLang } from '../lib/sessionStore'
import { getFirstSeen, loadAIProfile } from '../lib/storage'
import { computeDaysKnown } from '../lib/aiSpaceDetail'
import {
  addAnniversary,
  formatAnniversaryDate,
  formatCountdown,
  formatPeriodEstimate,
  getAnniversaries,
  isValidAnniversaryDate,
  updateAnniversary,
  type Anniversary,
} from '../lib/anniversary'
import { getMilestoneProgress } from '../lib/homeBigDay'
import { getKnownDays } from '../lib/milestone'
import { MEMORY_UPDATED_EVENT } from '../lib/memory'
import { loadCurrentPosts } from '../lib/aiSpace'
import { getOrAdvanceTaRuntime, getSessionPersona, runtimeDisplayLabel } from '../lib/taRuntime'
import { displaySessionName } from '../lib/sessionFlow'
import HomeScene, { getHomeScene } from './HomeScene'
import TaOrb from './TaOrb'

interface Props {
  onGoChat: () => void
  onGoLife: () => void
  onGoAnniversary: () => void
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function fmtFull(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`
}

/* TA 的生活 preview 时间：与 SpaceLife timeAgo 同一语义（今天显时刻/刚刚，昨天前天，N 天前，跨月显日期） */
function fmtLifeTime(ts: number): string {
  const now = new Date()
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.floor((startOfDay(now) - startOfDay(d)) / 86400000)
  if (days <= 0) {
    const m = Math.floor((now.getTime() - ts) / 60000)
    return m < 1 ? '刚刚' : hm
  }
  if (days === 1) return `昨天 ${hm}`
  if (days === 2) return `前天 ${hm}`
  if (days < 30) return `${days} 天前`
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/* 我的生日展示：日期（不带年，每年循环）+ 强制倒计时（还剩 N 天）。只改展示，不改存储。 */
function birthdayDisplay(a: Anniversary, now: number): string {
  const d = formatAnniversaryDate(a.date).replace(/^\d+年/, '')
  const c = formatCountdown({ ...a, countMode: 'countdown' }, now)
  return c ? `${d} · ${c}` : d
}

/* 我的生理期展示：复用现有周期估算（预计 X 月 X 日来 / 该更新啦） */
function periodDisplay(a: Anniversary, now: number): string {
  return formatPeriodEstimate(a, now)
}

type TimeKind = 'birthday' | 'period'
type TimeEditor =
  | { mode: 'add'; kind: TimeKind }
  | { mode: 'edit'; kind: TimeKind; id: string }
  | null

export default function Home({ onGoChat, onGoLife }: Props) {
  const sid = getActiveSessionId() || undefined
  const now = useMemo(() => new Date(), [])
  const scene = getHomeScene(now)
  const firstSeen = useMemo(() => getFirstSeen(sid), [sid])
  const days = useMemo(() => computeDaysKnown(firstSeen), [firstSeen])
  const taName = useMemo(() => {
    const session = getSessionsCache().find((item) => String(item.id) === sid)
    return session ? displaySessionName(session) : 'TA'
  }, [sid])
  const posts = useMemo(() => loadCurrentPosts(sid), [sid])
  const taAvatar = useMemo(() => loadAIProfile(sid).avatar, [sid])
  const momentPost = useMemo(() => posts.find((p) => p.source === 'event') ?? posts[0], [posts])
  // QA2：TA 的生活 preview = 最新一条真实 Space Post（posts 最新在前；无则 null，走空态，不编造）
  const lifePreview = useMemo(() => posts[0] ?? null, [posts])

  // TASK-TA-RUNTIME-V1：TA 此刻主数据源 = Persistent Runtime（与 Chat 同一份持久状态、同一 lazy getter）。
  // 刷新/切 Tab/重进未到 plannedUntil 不换活动；到期才在读取时惰性推进。零额外 LLM。
  const personaText = useMemo(() => getSessionPersona(sid), [sid])
  const runtime = useMemo(
    () => getOrAdvanceTaRuntime(sid, personaText, now.getTime()),
    [sid, personaText, now],
  )
  // PATCH-LANG：显示语言走项目现有语言来源 getSessionLang(sid)（Chat 存会话语言）；英文会话显示英文 label
  const homeLang = useMemo(() => getSessionLang(sid), [sid])
  // Busy（仅展示优先级最高；只读现有 getBusyState，不写、不影响 Busy 数据层）
  const busyNow = useMemo(() => {
    if (!sid) return null
    const b = getBusyState(sid)
    return b.status === 'busy' && b.busyUntil > Date.now() && b.busyReason ? b.busyReason : null
  }, [sid])
  // 表现优先级：active Busy → Runtime（按会话语言取展示文案）→ Space Post → 静态 fallback
  const momentText = busyNow ?? (runtime ? runtimeDisplayLabel(runtime, homeLang) : null) ?? momentPost?.text ?? '正过着安静而寻常的一天，也在等你来。'

  // FINAL-CLOSURE：我的时间 = 生日 + 生理期（personal 全局资料，所有角色共享）。
  // 废弃 Home 单一 bigDay 展示；数据源仍是 getAnniversaries（全局 personal + 当前角色 couple 并集），
  // 只读展示层筛选，不改 Anniversary 数据、不改存储、不改同步。
  const [anniversaries, setAnniversaries] = useState<Anniversary[]>(() => getAnniversaries(sid))
  const personal = useMemo(() => anniversaries.filter((a) => a.kind === 'personal'), [anniversaries])
  const birthday = useMemo(
    () => personal.find((a) => !a.periodDays && /生日/.test(a.label ?? '')),
    [personal],
  )
  const period = useMemo(
    () => personal.find((a) => a.periodDays != null && a.periodDays > 0),
    [personal],
  )
  const milestone = useMemo(() => getMilestoneProgress(getKnownDays(now.getTime(), sid)), [sid, now])

  useEffect(() => {
    const refresh = () => {
      setAnniversaries(getAnniversaries(getActiveSessionId() || undefined))
    }
    window.addEventListener(MEMORY_UPDATED_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(MEMORY_UPDATED_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  // ---- 我的时间：添加 / 编辑（轻量 sheet，复用 anniversary.ts 数据层与广播；不复制设置页） ----
  const [editor, setEditor] = useState<TimeEditor>(null)
  const [formKind, setFormKind] = useState<TimeKind>('birthday')
  const [formDate, setFormDate] = useState('')
  const [formPeriodDays, setFormPeriodDays] = useState('28')

  const openAdd = (kind: TimeKind) => {
    setFormKind(kind)
    setFormDate('')
    setFormPeriodDays('28')
    setEditor({ mode: 'add', kind })
  }
  const openEdit = (kind: TimeKind) => {
    const target = kind === 'period' ? period : birthday
    if (!target) return
    setFormKind(kind)
    // type="date" 只能回填 YYYY-MM-DD；老 MM-DD 数据留空（保存时用当前日期值）
    setFormDate(/^\d{4}-\d{2}-\d{2}$/.test(target.date) ? target.date : '')
    setFormPeriodDays(target.periodDays ? String(target.periodDays) : '28')
    setEditor({ mode: 'edit', kind, id: target.id })
  }
  const closeEditor = () => setEditor(null)

  const saveTime = () => {
    if (!editor) return
    const d = formDate.trim()
    if (!d || !isValidAnniversaryDate(d)) return
    // REVIEW-FIX-01：保存类型必须以「sheet 当前所选」为准，而非打开时的 editor.kind。
    // add 模式跟随 formKind（可切换）；edit 模式锁定 editor.kind（JSX 已隐藏类型切换，防记录类型迁移）。
    const kind = editor.mode === 'add' ? formKind : editor.kind
    if (editor.mode === 'add') {
      if (kind === 'period') {
        const n = Math.max(1, Math.min(90, Number(formPeriodDays) || 28))
        addAnniversary('生理期', d, { kind: 'personal', periodDays: n }, undefined)
      } else {
        addAnniversary('我的生日', d, { kind: 'personal', countMode: 'countdown' }, undefined)
      }
    } else {
      const target = kind === 'period' ? period : birthday
      if (!target) return
      if (kind === 'period') {
        const n = Math.max(1, Math.min(90, Number(formPeriodDays) || 28))
        updateAnniversary(
          target.id,
          target.label || '生理期',
          d,
          { kind: 'personal', periodDays: n, color: target.color },
          undefined,
        )
      } else {
        updateAnniversary(
          target.id,
          target.label || '我的生日',
          d,
          { kind: 'personal', countMode: 'countdown', color: target.color },
          undefined,
        )
      }
    }
    closeEditor()
  }

  const birthdayText = birthday ? birthdayDisplay(birthday, now.getTime()) : '还没记过，点一下写下'
  const periodText = period ? periodDisplay(period, now.getTime()) : '还没记过，点一下写下'

  return (
    <HomeScene scene={scene}>
      {/* UI2-02：Web 更新 ↻（页头级小入口，复用现有 forceRefresh；区别于 ChatProfile「刷新对话」） */}
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
      <div className="home-inner">
        <header className="home-brand">
          <span className="home-brand-mark" aria-hidden="true">忆</span>
          <span><strong>忆文</strong><small>ELUVIN</small></span>
        </header>

        <section className="home-time" aria-label="相伴时间">
          <p className="home-greeting">{scene.greeting}</p>
          <h1>和 {taName} 的第 <strong>{days}</strong> 天</h1>
          <p>{fmtFull(firstSeen)} → 今天</p>
        </section>

        {/* FINAL-CLOSURE 最终顺序：品牌/第 N 天 → 【我的时间：生日 + 生理期 + milestone】→ TA Presence → CTA → TA 的生活。
            废弃单一 bigDay 展示形态（homeBigDay 模块保留给其他调用者，Home 不再使用）。 */}
        <section className="home-my-time" aria-label="我的时间">
          <div className="home-my-time-head">
            <span className="home-eyebrow">MY TIME</span>
            <button type="button" className="home-my-time-add" onClick={() => openAdd('birthday')} aria-label="添加我的时间">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>

          <button type="button" className="home-my-time-row" onClick={() => openEdit('birthday')}>
            <span className="home-my-time-k">生日</span>
            <span className="home-my-time-v">{birthdayText}</span>
          </button>

          <button type="button" className="home-my-time-row" onClick={() => openEdit('period')}>
            <span className="home-my-time-k">生理期</span>
            <span className="home-my-time-v">{periodText}</span>
          </button>

          {/* milestone 关系轨迹：真横排（flex row + inline-flex day；不竖字、不逐字换行） */}
          <div className="home-anniv-milestone" aria-label={`认识 ${milestone.day} 天`}>
            <div className="home-anniv-milestone-line">
              <span className="home-anniv-day">第 <strong>{milestone.day}</strong> 天</span>
              {milestone.next != null ? (
                milestone.reached ? (
                  <span className="home-anniv-next">今天正好 {milestone.next} 天</span>
                ) : (
                  <span className="home-anniv-next">下一个 {milestone.next} 天 · 还差 {milestone.next - milestone.day} 天</span>
                )
              ) : (
                <span className="home-anniv-next">一路走到今天</span>
              )}
            </div>
            <div className="home-anniv-track" aria-hidden="true">
              <span
                className="home-anniv-track-fill"
                style={{ width: `${Math.round(Math.min(1, Math.max(0, milestone.progress)) * 100)}%` }}
              />
            </div>
          </div>
        </section>

        {/* UI2-02：TA Presence —— TaOrb 视觉中心，Accent 最明显处 */}
        <section className="home-companion" aria-labelledby="home-moment-title">
          <TaOrb label={taName} scene={scene.id} avatar={taAvatar} />
          <div className="home-moment-copy">
            <h2 id="home-moment-title">{taName} 此刻</h2>
            <p>{momentText}</p>
          </div>
        </section>

        {/* QA2：CTA 紧跟 TA Presence，成为 Presence 后第一主交互（390px 首屏完整可见） */}
        <button type="button" className="home-talk" onClick={onGoChat}>
          和 {taName} 说说话 <span>→</span>
        </button>

        {/* QA2：TA 的生活 → 正式生活预览区（非小圆钮/快捷入口）。
            只读真实 Space Post（posts[0]），无则空态；点击整区进 onGoLife。 */}
        <section className="home-life" aria-label={`${taName} 的生活`}>
          <button type="button" className="home-life-head" onClick={onGoLife}>
            <span className="home-life-title">{taName} 的生活</span>
            <span className="home-life-more">看看 ›</span>
          </button>
          {lifePreview ? (
            <div className="home-life-preview">
              <p className="home-life-text">{lifePreview.text}</p>
              <time className="home-life-time">{fmtLifeTime(lifePreview.at)}</time>
            </div>
          ) : (
            <p className="home-life-empty">{taName} 还没有留下生活痕迹。</p>
          )}
        </section>
      </div>

      {/* 我的时间：添加/编辑轻量 sheet（复用 anniversary.ts 持久化与广播；Home 内联，不复制设置页） */}
      {editor && (
        <div className="home-time-mask" onClick={closeEditor}>
          <div className="home-time-sheet" onClick={(e) => e.stopPropagation()}>
            <h3 className="home-time-sheet-title">
              {editor.mode === 'edit' ? (editor.kind === 'period' ? '编辑生理期' : '编辑生日') : '写下我的时间'}
            </h3>

            {/* REVIEW-FIX-01：edit 模式锁定当前 kind（不显示类型切换，防把 birthday 迁成 period 或反之）；add 模式允许切换 */}
            {editor.mode === 'add' && (
              <div className="home-time-types">
                <button
                  type="button"
                  className={`home-time-type${formKind === 'birthday' ? ' is-active' : ''}`}
                  onClick={() => setFormKind('birthday')}
                >
                  生日
                </button>
                <button
                  type="button"
                  className={`home-time-type${formKind === 'period' ? ' is-active' : ''}`}
                  onClick={() => setFormKind('period')}
                >
                  生理期
                </button>
              </div>
            )}

            {formKind === 'birthday' ? (
              <>
                <p className="home-time-hint">选你的生日，每年到了 TA 都会记得</p>
                <input
                  className="home-time-input"
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                />
              </>
            ) : (
              <>
                <p className="home-time-hint">上次来潮是哪天？周期大概多少天？TA 会帮你估算下次</p>
                <input
                  className="home-time-input"
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                />
                <div className="home-time-period-row">
                  <span className="home-time-period-label">周期</span>
                  <input
                    className="home-time-input home-time-period-input"
                    type="number"
                    min={1}
                    max={90}
                    value={formPeriodDays}
                    onChange={(e) => setFormPeriodDays(e.target.value)}
                  />
                  <span className="home-time-period-label">天</span>
                </div>
              </>
            )}

            <button type="button" className="home-time-save" onClick={saveTime}>
              保存
            </button>
          </div>
        </div>
      )}
    </HomeScene>
  )
}
