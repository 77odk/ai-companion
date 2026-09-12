import { useEffect, useMemo, useState } from 'react'
import { getActiveSessionId, getBusyState, getSessionsCache, getSessionLang } from '../lib/sessionStore'
import { getFirstSeen, loadAIProfile } from '../lib/storage'
import { computeDaysKnown } from '../lib/aiSpaceDetail'
import {
  formatAnniversaryDate,
  formatCountdown,
  getAnniversaries,
  mergeDuplicateAnniversaries,
  type Anniversary,
} from '../lib/anniversary'
import { getMilestoneProgress, pickHomeBigDay } from '../lib/homeBigDay'
import { getKnownDays } from '../lib/milestone'
import { MEMORY_UPDATED_EVENT } from '../lib/memory'
import { loadCurrentPosts } from '../lib/aiSpace'
import { getOrAdvanceTaRuntime, getSessionPersona, runtimeDisplayLabel } from '../lib/taRuntime'
import { displaySessionName } from '../lib/sessionFlow'
import HomeScene, { getHomeScene } from './HomeScene'
import HomeAnniversary from './HomeAnniversary'
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

export default function Home({ onGoChat, onGoLife, onGoAnniversary }: Props) {
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

  const [anniversaries, setAnniversaries] = useState<Anniversary[]>(() => getAnniversaries(sid))
  const bigDay = useMemo(
    () => pickHomeBigDay(mergeDuplicateAnniversaries(anniversaries), now.getTime()),
    [anniversaries, now],
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

  return (
    <HomeScene scene={scene}>
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

        <HomeAnniversary
          label={bigDay?.label}
          count={bigDay ? formatCountdown(bigDay) : undefined}
          date={bigDay ? formatAnniversaryDate(bigDay.date) : undefined}
          dateValue={bigDay?.date}
          milestone={milestone}
          onView={onGoAnniversary}
        />

        <section className="home-companion" aria-labelledby="home-moment-title">
          <div className="home-moment-copy">
            <h2 id="home-moment-title">{taName} 此刻</h2>
            <p>{momentText}</p>
          </div>
          <TaOrb label={taName} scene={scene.id} avatar={taAvatar} />
          <button type="button" className="home-talk" onClick={onGoChat}>和 {taName} 说说话 <span>→</span></button>
        </section>

        <nav className="home-shortcuts" aria-label="首页快捷入口">
          <button type="button" onClick={onGoLife}>{taName} 的生活</button>
        </nav>
      </div>
    </HomeScene>
  )
}
