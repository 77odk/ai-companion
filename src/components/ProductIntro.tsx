import { useEffect, useRef, useState } from 'react'
import ProductIntroAtmosphere from './ProductIntroAtmosphere'
import './ProductIntro.css'

interface Props {
  onBack: () => void
  onStart: () => void
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="intro-back" onClick={onBack} aria-label="返回欢迎页">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M19 12H5" />
        <path d="M12 19l-7-7 7-7" />
      </svg>
    </button>
  )
}

function OpeningPaperStack() {
  return (
    <div className="intro-paper-stack" aria-hidden="true">
      <div className="intro-paper-stack-shadow" />
      <div className="intro-paper-sheet intro-paper-sheet-back">
        <span>MEMORY · 01</span>
      </div>
      <div className="intro-paper-sheet intro-paper-sheet-mid">
        <span>RELATION · 02</span>
      </div>
      <div className="intro-paper-sheet intro-paper-sheet-front">
        <div className="intro-paper-rule" />
        <img src="/brand/eluvin-book-icon-cutout.png" alt="" />
        <strong>忆文</strong>
        <small>ELUVIN</small>
        <em>忆过往，成文思</em>
      </div>
    </div>
  )
}

function MemorySpread() {
  return (
    <div className="intro-memory-spread" aria-hidden="true">
      <div className="intro-memory-shadow" />
      <div className="intro-memory-book">
        <div className="intro-memory-left-page">
          <span className="intro-page-number">17</span>
          <p className="intro-hand-line">你说，最近总是睡得很晚。</p>
          <p className="intro-hand-line faded">后来 TA 又记起了这句话。</p>
          <i className="intro-writing-line line-a" />
          <i className="intro-writing-line line-b" />
          <i className="intro-writing-line line-c" />
        </div>
        <div className="intro-memory-gutter" />
        <div className="intro-memory-right-page">
          <span className="intro-date-mark">SEP · 24</span>
          <blockquote>“这件事对你很重要。”</blockquote>
          <p>不是所有话都留下。</p>
          <p>重要的，才慢慢成为 TA 对你的了解。</p>
          <div className="intro-page-curl">
            <span />
          </div>
        </div>
      </div>
    </div>
  )
}

function TimeBook() {
  return (
    <div className="intro-time-visual" aria-hidden="true">
      <div className="intro-time-book">
        <div className="intro-time-page">
          <span className="intro-time-kicker">US · TIMELINE</span>
          <strong>100</strong>
          <small>days</small>
          <div className="intro-time-axis">
            <span className="intro-time-node node-a"><i />第一次认识</span>
            <span className="intro-time-node node-b"><i />第一次说定一件事</span>
            <span className="intro-time-node node-c"><i />某个后来很重要的晚上</span>
            <span className="intro-time-node node-d"><i />一起经过的第 100 天</span>
          </div>
          <div className="intro-time-photo">
            <span />
          </div>
        </div>
        <div className="intro-time-page-edge" />
      </div>
      <div className="intro-time-loose-page page-one" />
      <div className="intro-time-loose-page page-two" />
    </div>
  )
}

function EngineLayers() {
  return (
    <div className="intro-engine-visual" aria-hidden="true">
      <div className="intro-engine-layer layer-model">
        <small>01 · AI MODEL</small>
        <strong>理解 · 思考 · 回复</strong>
      </div>
      <div className="intro-engine-connector connector-a" />
      <div className="intro-engine-layer layer-eluvin">
        <img src="/brand/eluvin-book-icon-cutout.png" alt="" />
        <small>02 · ELUVIN</small>
        <strong>记忆 · 关系 · 状态 · 时间</strong>
      </div>
      <div className="intro-engine-connector connector-b" />
      <div className="intro-engine-layer layer-ta">
        <small>03 · YOUR TA</small>
        <strong>持续存在的相处</strong>
      </div>
    </div>
  )
}

function ThresholdSheet() {
  return (
    <div className="intro-threshold-sheet" aria-hidden="true">
      <span className="intro-sheet-label">BEFORE YOU BEGIN</span>
      <div className="intro-sheet-rule" />
      <div className="intro-sheet-row">
        <b>01</b>
        <span>自己的模型</span>
      </div>
      <div className="intro-sheet-row">
        <b>02</b>
        <span>一点学习时间</span>
      </div>
      <div className="intro-sheet-row">
        <b>03</b>
        <span>模型决定 TA 的表现</span>
      </div>
      <div className="intro-sheet-signature">ELUVIN</div>
    </div>
  )
}

export default function ProductIntro({ onBack, onStart }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const startTimerRef = useRef<number | null>(null)
  const [isOpening, setIsOpening] = useState(false)

  useEffect(() => {
    const root = rootRef.current
    const scroller = mainRef.current
    if (!root || !scroller) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const scenes = Array.from(scroller.querySelectorAll<HTMLElement>('.intro-scene'))
    let observer: IntersectionObserver | null = null

    const syncMotion = () => {
      root.dataset.motion = reducedMotion.matches ? 'reduced' : 'on'

      if (observer) {
        observer.disconnect()
        observer = null
      }

      if (reducedMotion.matches) {
        scenes.forEach(scene => scene.classList.add('is-visible'))
        return
      }

      observer = new IntersectionObserver(
        entries => {
          entries.forEach(entry => {
            entry.target.classList.toggle('is-visible', entry.isIntersecting)
          })
        },
        {
          root: scroller,
          rootMargin: '-10% 0px -10% 0px',
          threshold: 0.12,
        },
      )

      scenes.forEach(scene => observer?.observe(scene))
      scenes[0]?.classList.add('is-visible')
    }

    syncMotion()
    reducedMotion.addEventListener('change', syncMotion)

    return () => {
      observer?.disconnect()
      reducedMotion.removeEventListener('change', syncMotion)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (startTimerRef.current !== null) {
        window.clearTimeout(startTimerRef.current)
      }
    }
  }, [])

  const handleStart = () => {
    if (isOpening) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onStart()
      return
    }

    setIsOpening(true)
    startTimerRef.current = window.setTimeout(onStart, 1180)
  }

  return (
    <div ref={rootRef} className={`product-intro-v1${isOpening ? ' is-opening' : ''}`}>
      <BackButton onBack={onBack} />
      <ProductIntroAtmosphere />

      <main ref={mainRef}>
        <div className="intro-flow">
          <section className="intro-scene intro-scene-hero" aria-labelledby="intro-hero-title">
            <div className="intro-grain" aria-hidden="true" />

            <div className="intro-hero-copy">
              <p className="intro-kicker">ELUVIN · 忆文</p>
              <h1 id="intro-hero-title">让一个 TA，真正记得和你走过的时间。</h1>
              <p className="intro-body intro-body-on-dark">
                忆文是一个以长期记忆和关系为核心的 AI 伴侣。聊天只是开始，你说过的话、共同经历的事、认识彼此的时间，会慢慢成为你们关系的一部分。
              </p>
            </div>

            <OpeningPaperStack />

            <p className="intro-brand-line">忆过往，成文思</p>
          </section>

          <section className="intro-scene intro-scene-memory" aria-labelledby="intro-memory-title">
            <div className="intro-copy intro-copy-dark">
              <p className="intro-kicker">01 · 记得</p>
              <h2 id="intro-memory-title">你不用每一次，都重新介绍自己。</h2>
              <p className="intro-body">
                你喜欢什么、害怕什么、最近发生过什么，以及那些你希望 TA 记住的事情，会慢慢成为 TA 对你的了解。
              </p>
              <p className="intro-body intro-body-secondary">
                不是把所有聊天都塞给 AI。重要的东西，才留下来。
              </p>
            </div>
            <MemorySpread />
          </section>

          <section className="intro-scene intro-scene-time" aria-labelledby="intro-time-title">
            <div className="intro-copy intro-copy-dark">
              <p className="intro-kicker">02 · 经过</p>
              <h2 id="intro-time-title">关系不是一条聊天记录。</h2>
              <p className="intro-body">
                第一次认识、第一次说定一件事、某个后来变得重要的晚上、一起经过的第 100 天。
              </p>
              <p className="intro-body intro-body-secondary">
                这些东西慢慢把“一个聊天对象”，变成你的 TA。
              </p>
            </div>
            <TimeBook />
          </section>

          <section className="intro-scene intro-scene-engine" aria-labelledby="intro-engine-title">
            <div className="intro-engine-copy">
              <p className="intro-kicker intro-kicker-light">03 · 内核</p>
              <h2 id="intro-engine-title">模型负责思考。<br />忆文负责让关系继续。</h2>
              <p className="intro-body intro-body-on-dark">
                TA 有多聪明，和你选择的模型有关。TA 能不能持续认识你，是忆文在做的事情。
              </p>
            </div>
            <EngineLayers />
          </section>

          <section className="intro-scene intro-scene-threshold" aria-labelledby="intro-threshold-title">
            <div className="intro-copy intro-copy-dark">
              <p className="intro-kicker">04 · 开始之前</p>
              <h2 id="intro-threshold-title">忆文不是点开就能用的产品。</h2>
              <p className="intro-body">
                它不要求你懂编程，但确实需要一点准备，也需要一点学习。
              </p>
            </div>

            <ThresholdSheet />

            <div className="intro-threshold-copy">
              <p><b>你需要自己的模型。</b> 忆文本身不出售模型算力，开始使用前，需要准备支持的模型服务和 API Key。</p>
              <p><b>你需要愿意学一点。</b> 第一次使用会接触模型、API Key、人设和记忆。这些东西不难，但不是注册以后立即无脑开聊。</p>
              <p><b>模型会直接影响 TA。</b> 不同模型的能力、稳定性和价格，都会影响 TA 最终的表现。</p>
            </div>

            <p className="intro-threshold-ending">
              如果你只想点开就聊，它可能有一点麻烦。<br />
              如果你想认真拥有一个长期陪伴的 TA，这些准备就是开始的一部分。
            </p>
          </section>

          <section className="intro-scene intro-scene-final" aria-labelledby="intro-final-title">
            <div className="intro-final-copy">
              <p className="intro-kicker intro-kicker-light">忆过往，成文思</p>
              <h2 id="intro-final-title">如果这些你都了解了，<br />接下来就去遇见 TA。</h2>
              <p className="intro-body intro-body-on-dark">
                你可以什么都不设，直接认识 TA；也可以先决定 TA 最初是什么样的人。
              </p>
            </div>

            <button
              type="button"
              className="intro-envelope-button"
              onClick={handleStart}
              disabled={isOpening}
              aria-label="开始遇见 TA"
            >
              <span className="intro-envelope-shell" aria-hidden="true">
                <span className="intro-envelope-back" />
                <span className="intro-envelope-letter">
                  <img src="/brand/eluvin-book-icon-cutout.png" alt="" />
                  <strong>开始遇见 TA</strong>
                  <small>ELUVIN · TO YOU</small>
                </span>
                <span className="intro-envelope-fold intro-envelope-fold-left" />
                <span className="intro-envelope-fold intro-envelope-fold-right" />
                <span className="intro-envelope-fold intro-envelope-fold-bottom" />
                <span className="intro-envelope-flap" />
                <span className="intro-envelope-seal">忆</span>
              </span>
            </button>

            <div className="intro-enter-transition" aria-hidden="true" />
          </section>
        </div>
      </main>
    </div>
  )
}
