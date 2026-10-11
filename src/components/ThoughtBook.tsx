import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ELUVIN_DATA_CHANGE } from '../lib/dataChange'
import { getActiveSessionId } from '../lib/sessionStore'
import { loadTaThoughts, settleTaThoughts, type TaThoughtView } from '../lib/taThoughts'
import SpaceObjectScene, { SpaceObjectPlane } from './SpaceObjectScene'
import { useSpaceObjectScene } from '../lib/useSpaceObjectScene'
import { SPACE_BOOK_FRAME, SPACE_BOOK_PAPER } from '../lib/spaceObjectFocus'

interface Props {
  onBack: () => void
}

type TurnDirection = 'next' | 'prev' | null

function BookPaper({ native, children }: { native: boolean; children: ReactNode }) {
  return native
    ? <SpaceObjectPlane className="thought-book-paper-plane" frame={SPACE_BOOK_FRAME} corners={SPACE_BOOK_PAPER}>{children}</SpaceObjectPlane>
    : <div className="thought-book-paper-plane">{children}</div>
}

function thoughtDate(ts: number): string {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function PageContent({ thought, pageNumber }: { thought?: TaThoughtView; pageNumber: number }) {
  return (
    <div className="thought-paper-content">
      <span className="thought-page-num">{pageNumber}</span>
      {thought ? (
        <>
          <time>{thoughtDate(thought.createdAt)}</time>
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
  const [opened, setOpened] = useState(false)
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

  const pages = useMemo(() => [...thoughts].sort((a, b) => b.createdAt - a.createdAt), [thoughts])
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
    setTurn(direction)
    timerRef.current = window.setTimeout(() => {
      setSpread(destination)
      setTurn(null)
      timerRef.current = null
    }, 440)
  }

  // 翻页时底层不能整幅提前跳到下一 spread：
  // next = 左页保持 current、右页先露出 next-right；翻起页的背面才是 next-left。
  // prev = 右页保持 current、左页先露出 prev-left；翻起页的背面才是 prev-right。
  const baseLeft = turn === 'prev' ? prevIndex : currentIndex
  const baseRight = turn === 'next' ? nextIndex + 1 : currentIndex + 1

  return (
    <div className={`page space-object-page thought-book-page${artwork.ready ? ' is-native-object-focus' : ''}`}>
      <header className="space-object-topbar">
        <button type="button" onClick={onBack} className="space-object-back">‹ 返回</button>
        <div>
          <strong>思绪</strong>
          <span>THOUGHTS</span>
        </div>
        <span aria-hidden="true" />
      </header>

      <main className="thought-book-stage" aria-label="TA 的思绪">
        <div className={`thought-book-shell${opened ? ' is-open' : ''}`}>
          {artwork.ready ? <SpaceObjectScene frame={SPACE_BOOK_FRAME} onError={artwork.fail} /> : <img
            className="thought-book-approved-art"
            src="/space/cutouts/thought-book.png"
            onError={(event) => {
              const image = event.currentTarget
              if (!image.dataset.fallback) {
                image.dataset.fallback = 'true'
                image.src = '/space/layered/open_book.png'
              }
            }}
            alt=""
            aria-hidden="true"
            draggable={false}
          />}
          <BookPaper native={artwork.ready}>
          <button
            type="button"
            className="thought-book-cover"
            onClick={() => setOpened(true)}
            aria-label={opened ? '思绪书已打开' : '打开思绪书'}
            disabled={opened}
          >
            <span className="thought-book-spine" aria-hidden="true" />
            <span className="thought-book-cover-title">思绪</span>
            <span className="thought-book-cover-sub">TA 自己想过的</span>
          </button>

          <div className="thought-book-pages" aria-hidden={!opened}>
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

                {turn === 'next' && (
                  <div className="thought-book-turning-page is-next" aria-hidden="true">
                    <div className="thought-book-face is-front">
                      <PageContent thought={pages[currentIndex + 1]} pageNumber={currentIndex + 2} />
                    </div>
                    <div className="thought-book-face is-back">
                      <PageContent thought={pages[nextIndex]} pageNumber={nextIndex + 1} />
                    </div>
                  </div>
                )}

                {turn === 'prev' && (
                  <div className="thought-book-turning-page is-prev" aria-hidden="true">
                    <div className="thought-book-face is-front">
                      <PageContent thought={pages[currentIndex]} pageNumber={currentIndex + 1} />
                    </div>
                    <div className="thought-book-face is-back">
                      <PageContent thought={pages[prevIndex + 1]} pageNumber={prevIndex + 2} />
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  className="thought-turn-hit is-prev"
                  onClick={() => beginTurn('prev')}
                  disabled={!opened || visibleSpread <= 0 || Boolean(turn)}
                  aria-label="上一页"
                />
                <button
                  type="button"
                  className="thought-turn-hit is-next"
                  onClick={() => beginTurn('next')}
                  disabled={!opened || visibleSpread >= maxSpread || Boolean(turn)}
                  aria-label="下一页"
                />
              </>
            )}
          </div>
          </BookPaper>
        </div>

        {artwork.ready && !opened && (
          <p className="thought-book-hint">轻点书页查看思绪</p>
        )}
        {opened && pages.length > 0 && (
          <p className="thought-book-hint">轻点书页边缘翻页</p>
        )}
      </main>
    </div>
  )
}
