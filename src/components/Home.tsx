import { useEffect, useMemo, useState } from 'react'
import { getActiveSessionId, getSessionsCache } from '../lib/sessionStore'
import { getFirstSeen, loadAIProfile } from '../lib/storage'
import { computeDaysKnown } from '../lib/aiSpaceDetail'
import {
  formatAnniversaryDate,
  formatCountdown,
  isMilestoneAnniversary,
  mergeDuplicateAnniversaries,
  readRoleAnniversaries,
  resolveMainAnniversary,
  type Anniversary,
} from '../lib/anniversary'
import { MEMORY_UPDATED_EVENT } from '../lib/memory'
import { loadCurrentPosts } from '../lib/aiSpace'
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

  const [anniversaries, setAnniversaries] = useState<Anniversary[]>(() =>
    readRoleAnniversaries(sid).filter((item) => item.kind !== 'personal'),
  )
  const mainAnniversary = useMemo(() => {
    const candidates = mergeDuplicateAnniversaries(
      anniversaries.filter((item) => !isMilestoneAnniversary(item)),
    )
    return resolveMainAnniversary(candidates, sid)
  }, [anniversaries, sid])

  useEffect(() => {
    const refresh = () => {
      setAnniversaries(
        readRoleAnniversaries(getActiveSessionId() || undefined).filter((item) => item.kind !== 'personal'),
      )
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
          label={mainAnniversary?.label}
          count={mainAnniversary ? formatCountdown(mainAnniversary) : undefined}
          date={mainAnniversary ? formatAnniversaryDate(mainAnniversary.date) : undefined}
          dateValue={mainAnniversary?.date}
          onView={onGoAnniversary}
        />

        <section className="home-companion" aria-labelledby="home-moment-title">
          <div className="home-moment-copy">
            <h2 id="home-moment-title">{taName} 此刻</h2>
            <p>{momentPost?.text ?? '正过着安静而寻常的一天，也在等你来。'}</p>
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
