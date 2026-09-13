import { useEffect, useMemo, useState } from 'react'
import { getActiveSessionId, getBusyState, getSessionsCache, getSessionLang } from '../lib/sessionStore'
import { getFirstSeen, loadAIProfile } from '../lib/storage'
import { computeDaysKnown } from '../lib/aiSpaceDetail'
import {
  addAnniversary,
  daysUntilPeriod,
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
import {
  clampCycleDays,
  dayOptions,
  isFutureOnset,
  monthDayCount,
  monthOptions,
  parseDateForPicker,
  periodDayOptions,
  periodMonthOptions,
  periodYearOptions,
  toFullDate,
  toMonthDay,
} from '../lib/timeInteraction'
import HomeScene, { getHomeScene } from './HomeScene'
import TaOrb from './TaOrb'
import TimeWheel from './TimeWheel'

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

/* UI2-VISUAL-CLOSURE：大数字时间窗的展示拆解（纯展示，不造新算法）。
   生日主数字：MM · DD（从 date 提取）；副文案：现有 formatCountdown 倒计时（强制 countdown 口径）。
   生理期主数字：优先「距预计经期 N 天」（现有 daysUntilPeriod），否则现有估算兜底；
   副文案：现有 formatPeriodEstimate / 「预计经期开始」。 */
function dateMD(date: string): { m: string; d: string } | null {
  const iso = date.match(/^(\d{4})-(\d{2})-(\d{2})$/) as RegExpMatchArray | null
  if (iso) return { m: iso[2], d: iso[3] }
  const md = date.match(/^(\d{2})-(\d{2})$/) as RegExpMatchArray | null
  return md ? { m: md[1], d: md[2] } : null
}

function birthdayNum(a: Anniversary): string {
  const md = dateMD(a.date)
  return md ? `${md.m} · ${md.d}` : '— —'
}

function birthdaySub(a: Anniversary, now: number): string {
  return formatCountdown({ ...a, countMode: 'countdown' }, now) || '每年都会记得'
}

function periodNum(a: Anniversary, now: number): string {
  const n = daysUntilPeriod(a, now)
  if (n != null && n > 0) return `${n} 天`
  const est = formatPeriodEstimate(a, now)
  if (est && est !== '该更新啦') {
    const md = dateMD(a.date)
    return md ? `${md.m} · ${md.d}` : '— —'
  }
  return '— —'
}

function periodSub(a: Anniversary, now: number): string {
  const n = daysUntilPeriod(a, now)
  if (n != null && n > 0) return '预计经期开始'
  const est = formatPeriodEstimate(a, now)
  return est || '记录一次'
}

type TimeKind = 'birthday' | 'period'
type TimeSheet = { kind: TimeKind; mode: 'add' | 'edit'; id?: string } | null

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

  // ---- 我的时间：生日 Sheet / 生理期 Sheet（各自独立，无类型切换 tab；复用 anniversary.ts 数据层） ----
  // 展示层拆分后：empty 直接进 add、有数据进 edit；sheet 类型固定，Review-Fix-01 的 kind 切换问题自然消失。
  const [sheet, setSheet] = useState<TimeSheet>(null)
  const [bMonth, setBMonth] = useState('09')
  const [bDay, setBDay] = useState('28')
  const [pYear, setPYear] = useState(String(new Date().getFullYear()))
  const [pMonth, setPMonth] = useState('09')
  const [pDay, setPDay] = useState('12')
  const [pCycle, setPCycle] = useState(28)

  const openBirthday = () => {
    const target = birthday
    if (target) {
      const p = parseDateForPicker(target.date)
      if (p) {
        setBMonth(pad2(p.month))
        setBDay(pad2(p.day))
      }
    } else {
      const t = new Date()
      setBMonth(pad2(t.getMonth() + 1))
      setBDay(pad2(t.getDate()))
    }
    setSheet({ kind: 'birthday', mode: target ? 'edit' : 'add', id: target?.id })
  }
  const openPeriod = () => {
    const target = period
    if (target) {
      const p = parseDateForPicker(target.date)
      if (p) {
        // REVIEW-FIX-01 防御：存量数据若为未来日期（异常），回填时 clamp 到今天
        const t = new Date()
        const cy = t.getFullYear()
        const cm = t.getMonth() + 1
        const cd = t.getDate()
        const y = p.year ?? cy
        const m = p.month
        const d = Math.min(p.day, y === cy && m === cm ? cd : monthDayCount(y, m))
        setPYear(String(y))
        setPMonth(pad2(m))
        setPDay(pad2(d))
      }
      setPCycle(clampCycleDays(target.periodDays ?? 28))
    } else {
      const t = new Date()
      setPYear(String(t.getFullYear()))
      setPMonth(pad2(t.getMonth() + 1))
      setPDay(pad2(t.getDate()))
      setPCycle(28)
    }
    setSheet({ kind: 'period', mode: target ? 'edit' : 'add', id: target?.id })
  }
  const closeSheet = () => setSheet(null)

  // Escape（桌面）关闭 sheet
  useEffect(() => {
    if (!sheet) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheet(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet])

  // 月份/年份切换后，若当前日超过新月份天数 → clamp 到月末（4/31 这类非法日期从 UI 上不可能产生）
  const onBirthdayMonth = (m: string) => {
    setBMonth(m)
    const max = m === '02' ? 29 : new Date(new Date().getFullYear(), Number(m), 0).getDate()
    if (Number(bDay) > max) setBDay(pad2(max))
  }
  // REVIEW-FIX-01：生理期 year/month/day 切换时，未来 onset 不可达。
  // 今年月份 > 当前月 → clamp 到当前月；今年当前月日期 > 当前日 → clamp 到当前日。
  // 去年：任何已发生日期都合法，仅按真实月天数 clamp。
  const onPeriodYear = (y: string) => {
    setPYear(y)
    const yy = Number(y)
    const t = new Date()
    const cy = t.getFullYear()
    const cm = t.getMonth() + 1
    const cd = t.getDate()
    let mm = Number(pMonth)
    if (yy === cy && mm > cm) {
      mm = cm
      setPMonth(pad2(mm))
    }
    if (yy === cy && mm === cm) {
      if (Number(pDay) > cd) setPDay(pad2(cd))
    } else if (Number(pDay) > monthDayCount(yy, mm)) {
      setPDay(pad2(monthDayCount(yy, mm)))
    }
  }
  const onPeriodMonth = (m: string) => {
    setPMonth(m)
    const yy = Number(pYear)
    const mm = Number(m)
    const t = new Date()
    const cy = t.getFullYear()
    const cm = t.getMonth() + 1
    const cd = t.getDate()
    if (yy === cy && mm === cm) {
      if (Number(pDay) > cd) setPDay(pad2(cd))
    } else if (Number(pDay) > monthDayCount(yy, mm)) {
      setPDay(pad2(monthDayCount(yy, mm)))
    }
  }

  const saveSheet = () => {
    if (!sheet) return
    if (sheet.kind === 'birthday') {
      const d = toMonthDay(Number(bMonth), Number(bDay))
      if (!isValidAnniversaryDate(d)) return
      if (sheet.mode === 'add') {
        addAnniversary('我的生日', d, { kind: 'personal', countMode: 'countdown' }, undefined)
      } else if (birthday) {
        updateAnniversary(
          birthday.id,
          birthday.label || '我的生日',
          d,
          { kind: 'personal', countMode: 'countdown', color: birthday.color },
          undefined,
        )
      }
    } else {
      const d = toFullDate(Number(pYear), Number(pMonth), Number(pDay))
      if (!isValidAnniversaryDate(d)) return
      // REVIEW-FIX-01 最终防御：selected onset > 本地今天 → 不保存（本地日历比较，不走 UTC）
      if (isFutureOnset(Number(pYear), Number(pMonth), Number(pDay))) return
      const n = clampCycleDays(pCycle)
      if (sheet.mode === 'add') {
        addAnniversary('生理期', d, { kind: 'personal', periodDays: n }, undefined)
      } else if (period) {
        updateAnniversary(
          period.id,
          period.label || '生理期',
          d,
          { kind: 'personal', periodDays: n, color: period.color },
          undefined,
        )
      }
    }
    closeSheet()
  }

  const milestonePct = Math.round(Math.min(1, Math.max(0, milestone.progress)) * 100)

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
            废弃单一 bigDay 展示形态（homeBigDay 模块保留给其他调用者，Home 不再使用）。
            UI2-VISUAL-CLOSURE：两条 row → 两个并排大数字时间窗；右上＋删除（窗口本身承担添加/编辑入口）。 */}
        <section className="home-my-time" aria-label="我的时间">
          <div className="home-my-time-head">
            <span className="home-eyebrow">MY TIME</span>
          </div>

          {/* 双大数字时间窗：生日 + 生理期并排、约 1:1、透明语言；空态可点击进入现有添加流程 */}
          <div className="home-time-windows">
            <button
              type="button"
              className="home-time-window"
              onClick={openBirthday}
            >
              <span className="home-time-window-k">我的生日</span>
              <span className="home-time-window-num">{birthday ? birthdayNum(birthday) : '— —'}</span>
              <span className="home-time-window-sub">{birthday ? birthdaySub(birthday, now.getTime()) : '点一下写下'}</span>
            </button>

            <button
              type="button"
              className="home-time-window"
              onClick={openPeriod}
            >
              <span className="home-time-window-k">生理期</span>
              <span className="home-time-window-num">{period ? periodNum(period, now.getTime()) : '— —'}</span>
              <span className="home-time-window-sub">{period ? periodSub(period, now.getTime()) : '记录一次'}</span>
            </button>
          </div>

          {/* milestone 关系轨迹：真横排（flex row + inline-flex day；不竖字、不逐字换行）+
              当前进度节点（自绘 SVG，跟随真实 progress；0%/100% 靠 track 左右 margin 防裁切） */}
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
              <span className="home-anniv-track-inner">
                <span className="home-anniv-track-fill" style={{ width: `${milestonePct}%` }} />
                <span className="home-milestone-node" style={{ '--node-p': `${milestonePct}%` } as React.CSSProperties}>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="1" opacity="0.35" />
                    <path
                      d="M12 3.2v2.6M12 18.2v2.6M3.2 12h2.6M18.2 12h2.6"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      opacity="0.6"
                    />
                    <circle cx="12" cy="12" r="3.1" fill="currentColor" />
                  </svg>
                </span>
              </span>
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

      {/* 我的生日：专属 Bottom Sheet（双列 Wheel：月/日，无年份、无 HTML date input、无类型切换 tab） */}
      {sheet?.kind === 'birthday' && (
        <div className="home-time-mask" onClick={closeSheet}>
          <div className="home-time-sheet" onClick={(e) => e.stopPropagation()}>
            <h3 className="home-time-sheet-title">我的生日</h3>
            <p className="home-time-sub">TA 会记得这一天</p>
            <div className="tw-row">
              <TimeWheel options={monthOptions()} value={bMonth} onChange={onBirthdayMonth} ariaLabel="选择月份" />
              <TimeWheel
                options={dayOptions(undefined, Number(bMonth))}
                value={bDay}
                onChange={setBDay}
                ariaLabel="选择日期"
              />
            </div>
            <button type="button" className="home-time-save" onClick={saveSheet}>
              保存
            </button>
          </div>
        </div>
      )}

      {/* 我的周期：专属 Bottom Sheet（年/月/日三列 Wheel + 周期 stepper；真实日期保存，不出现 HTML date input） */}
      {sheet?.kind === 'period' && (
        <div className="home-time-mask" onClick={closeSheet}>
          <div className="home-time-sheet" onClick={(e) => e.stopPropagation()}>
            <h3 className="home-time-sheet-title">我的周期</h3>
            <p className="home-time-sub">上次经期开始</p>
            <div className="tw-row">
              <TimeWheel
                className="tw-col-year"
                options={periodYearOptions().map(String)}
                value={pYear}
                onChange={onPeriodYear}
                ariaLabel="选择年份"
              />
              <TimeWheel
                options={periodMonthOptions(Number(pYear))}
                value={pMonth}
                onChange={onPeriodMonth}
                ariaLabel="选择月份"
              />
              <TimeWheel
                options={periodDayOptions(Number(pYear), Number(pMonth))}
                value={pDay}
                onChange={setPDay}
                ariaLabel="选择日期"
              />
            </div>
            <div className="home-period-cycle" aria-label="平均周期">
              <button
                type="button"
                className="home-cycle-btn"
                aria-label="减少周期天数"
                onClick={() => setPCycle(clampCycleDays(pCycle - 1))}
              >
                −
              </button>
              <span className="home-cycle-num">
                {pCycle} <small>天</small>
              </span>
              <button
                type="button"
                className="home-cycle-btn"
                aria-label="增加周期天数"
                onClick={() => setPCycle(clampCycleDays(pCycle + 1))}
              >
                ＋
              </button>
            </div>
            <p className="home-period-note">TA 会根据这次记录估算下一次</p>
            <button type="button" className="home-time-save" onClick={saveSheet}>
              保存记录
            </button>
          </div>
        </div>
      )}
    </HomeScene>
  )
}
