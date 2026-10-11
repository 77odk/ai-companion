import SpaceBookDeskCamera from './SpaceBookDeskCamera'
import SpaceBookSurface from './SpaceBookSurface'
import { useSpaceDismiss } from './SpaceFocusLayer'
import { paginateSpaceThoughts, playSpacePaperSound, type SpaceBookLeaf } from '../lib/spaceBookPaper'
import { transitionSpaceScene } from '../lib/spaceSceneTransition'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ELUVIN_DATA_CHANGE } from '../lib/dataChange'
import { getActiveSessionId } from '../lib/sessionStore'
import { loadTaThoughts, settleTaThoughts, type TaThoughtView } from '../lib/taThoughts'
import { useSpaceObjectScene } from '../lib/useSpaceObjectScene'

interface Props {
  onBack: () => void
}

type TurnDirection = 'next' | 'prev' | null

function thoughtDate(ts: number): string {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function PageContent({ thought, pageNumber }: { thought?: SpaceBookLeaf; pageNumber: number }) {
  return (
    <div className="thought-paper-content">
      <span className="thought-page-num">{pageNumber}</span>
      {thought ? (
        <>
          <time>{thoughtDate(thought.date)}</time>
          <p>{thought.text}</p>
        </>
      ) : (
        <p className="thought-paper-blank">这一页还是空的。</p>
      )}
    </div>
  )
}

export default function ThoughtBook({ onBack }: Props) {
  const artwork = useSpaceObjectScene()
  const sessionId = getActiveSessionId()
  const inRoom = useSpaceDismiss(onBack)
  const [sound, setSound] = useState(true)
  const [thoughts, setThoughts] = useState<TaThoughtView[]>(() => (
    sessionId ? settleTaThoughts(sessionId) : []
  ))
  const [spread, setSpread] = useState(0)
  const [turn, setTurn] = useState<TurnDirection>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  useEffect(() => {
    if (!sessionId) return
    const refresh = () => setThoughts(loadTaThoughts(sessionId))
    setThoughts(settleTaThoughts(sessionId))
    window.addEventListener(ELUVIN_DATA_CHANGE, refresh)
    return () => {
      window.removeEventListener(ELUVIN_DATA_CHANGE, refresh)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [sessionId])

  const pages = useMemo(() => paginateSpaceThoughts([...thoughts].sort((a,b)=>b.createdAt-a.createdAt)), [thoughts])
  const maxSpread = Math.max(0, Math.ceil(pages.length / 2) - 1)
  const visibleSpread = Math.min(spread, maxSpread)
  const currentIndex = visibleSpread * 2
  const nextIndex = Math.min(maxSpread, visibleSpread + 1) * 2
  const prevIndex = Math.max(0, visibleSpread - 1) * 2

  const beginTurn = (direction: Exclude<TurnDirection, null>) => {
    if (turn) return
    if (direction === 'next' && visibleSpread >= maxSpread) return
    if (direction === 'prev' && visibleSpread <= 0) return
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    const destination = direction === 'next' ? Math.min(maxSpread, visibleSpread + 1) : Math.max(0, visibleSpread - 1)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setSpread(destination)
      return
    }
    if (sound) playSpacePaperSound()
    setTurn(direction)
    timerRef.current = window.setTimeout(() => {
      setSpread(destination)
      setTurn(null)
      timerRef.current = null
    }, 650)
  }

  // 翻页时底层不能整幅提前跳到下一 spread：
  // next = 左页保持 current、右页先露出 next-right；翻起页的背面才是 next-left。
  // prev = 右页保持 current、左页先露出 prev-left；翻起页的背面才是 prev-right。
  const baseLeft = turn === 'prev' ? prevIndex : currentIndex
  const baseRight = turn === 'next' ? nextIndex + 1 : currentIndex + 1

  return (
    <div className={`page space-object-page thought-book-page${artwork.ready ? ' is-native-object-focus' : ''}`}>
      {!inRoom && <header className="space-object-topbar">
        <button type="button" onClick={() => transitionSpaceScene(onBack)} className="space-object-back">‹ 返回</button>
        <div>
          <strong>思绪</strong>
          <span>THOUGHTS</span>
        </div>
        <span aria-hidden="true" />
      </header>}

      <main className="thought-book-stage" aria-label="TA 的思绪">
        {inRoom && <SpaceBookDeskCamera native={artwork.ready} />}
        <div className="thought-book-shell is-open is-reading is-original-paper">
          <SpaceBookSurface native={artwork.ready} left={pages[baseLeft]} right={pages[baseRight]}
            front={turn === 'next' ? pages[currentIndex+1] : pages[currentIndex]}
            back={turn === 'next' ? pages[nextIndex] : pages[prevIndex+1]} turn={turn} onArtworkError={artwork.fail} />
          <div className="thought-book-paper-plane">
          <div className="thought-book-pages space-book-accessibility" aria-live="polite">
            {pages.length === 0 ? (
              <div className="thought-book-empty">
                <p>这里还没有长出新的思绪。</p>
              </div>
            ) : (
              <>
                <div className="thought-book-page-side is-left">
                  <PageContent thought={pages[baseLeft]} pageNumber={baseLeft + 1} />
                </div>
                <div className="thought-book-page-side is-right">
                  <PageContent thought={pages[baseRight]} pageNumber={baseRight + 1} />
                </div>

              </>
            )}
          </div>
          </div>
                <button
                  type="button"
                  className="thought-turn-hit is-prev"
                  onClick={() => beginTurn('prev')}
                  disabled={ visibleSpread <= 0 || Boolean(turn)}
                  aria-label="上一页"
                />
                <button
                  type="button"
                  className="thought-turn-hit is-next"
                  onClick={() => beginTurn('next')}
                  disabled={ visibleSpread >= maxSpread || Boolean(turn)}
                  aria-label="下一页"
                />
          <button type="button" className="space-book-sound" aria-label={sound ? '关闭翻页声音' : '开启翻页声音'} aria-pressed={sound} onClick={() => setSound(!sound)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M3 9h4l5-4v14l-5-4H3Z" />{sound ? <path d="M16 8a6 6 0 0 1 0 8" /> : <path d="m16 9 5 6m0-6-5 6" />}</svg>
          </button>
        </div>

        {!inRoom && pages.length > 0 && (
          <p className="thought-book-hint">轻点书页边缘翻页</p>
        )}
      </main>
    </div>
  )
}
