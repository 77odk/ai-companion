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
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M19 12H5" />
        <path d="M12 19l-7-7 7-7" />
      </svg>
    </button>
  )
}

function HeroBook() {
  return (
    <div className="intro-hero-object" aria-hidden="true">
      <div className="intro-object-shadow" />
      <img src="/brand/eluvin-book-icon-cutout.png" alt="" />
    </div>
  )
}

function MemoryPaper() {
  return (
    <div className="intro-memory-paper" aria-hidden="true">
      <div className="intro-memory-chip intro-memory-chip-preference">
        <small>偏好</small>
        <strong>喜欢安静一点的晚上</strong>
      </div>

      <div className="intro-memory-source">
        <span>SEP · 24</span>
        <p>你说，最近总是睡得很晚。</p>
        <i />
        <i />
      </div>

      <div className="intro-memory-chip intro-memory-chip-recent">
        <small>最近</small>
        <strong>这周一直在忙一个重要的项目</strong>
      </div>

      <div className="intro-memory-note">
        <small>TA 记住了</small>
        <strong>“这件事对你很重要。”</strong>
        <p>不是所有话都留下。重要的，才慢慢成为 TA 对你的了解。</p>
      </div>
    </div>
  )
}

function TimePaper() {
  return (
    <div className="intro-time-paper" aria-hidden="true">
      <div className="intro-time-heading">
        <span>US · TIMELINE</span>
        <strong>100</strong>
        <small>days</small>
      </div>
      <div className="intro-time-axis">
        <div><i />第一次认识</div>
        <div><i />第一次认真聊很久</div>
        <div><i />第一次说定一件事</div>
        <div><i />某个后来变得重要的晚上</div>
        <div><i />第一次被记住你的习惯</div>
        <div><i />一起经过的第 100 天</div>
        <div className="intro-time-more">……</div>
      </div>
    </div>
  )
}

function EnginePaper() {
  return (
    <div className="intro-engine-paper" aria-label="忆文与模型如何一起工作">
      <div className="intro-engine-step">
        <span>01 · 你说一句话</span>
        <strong>聊天从你此刻说的话开始。</strong>
        <p>模型先看到你现在想说的内容，但它不会只靠这一句话来认识你。</p>
      </div>

      <b />

      <div className="intro-engine-step">
        <span>02 · 忆文把相关的东西带过来</span>
        <strong>记忆 · 关系 · 状态 · 时间</strong>
        <p>和这一刻有关的记忆、你们的关系进度、TA 此刻的状态，以及时间信息，会被整理到这次聊天里。</p>
      </div>

      <b />

      <div className="intro-engine-step">
        <span>03 · 模型负责思考和表达</span>
        <strong>理解当下，也参考你们之前发生过的事。</strong>
        <p>你选择的模型负责理解、推理和生成回复，所以模型能力会直接影响 TA 的聪明程度和表达方式。</p>
      </div>

      <b />

      <div className="intro-engine-step">
        <span>04 · 这次聊天会继续成为以后的一部分</span>
        <strong>重要的新信息留下来，下一次继续往下走。</strong>
        <p>不是每句话都会被记住。真正重要的内容会继续沉淀，让下一次相处不用从零开始。</p>
      </div>

      <div className="intro-engine-summary">
        <strong>模型负责“怎么想、怎么说”。</strong>
        <span>忆文负责“记得什么、你们走到哪里、下一次从哪里继续”。</span>
      </div>
    </div>
  )
}

function ThresholdPaper() {
  return (
    <div className="intro-threshold-paper" aria-hidden="true">
      <span className="intro-sheet-label">BEFORE YOU BEGIN</span>

      <div className="intro-threshold-item">
        <b>01</b>
        <p><mark>自己的模型和 API Key</mark><span>忆文本身不提供模型算力。</span></p>
      </div>

      <div className="intro-threshold-item">
        <b>02</b>
        <p><mark>一点学习和设置时间</mark><span>第一次使用会接触模型、人设和记忆。</span></p>
      </div>

      <div className="intro-threshold-item">
        <b>03</b>
        <p><mark>接受模型会影响 TA 的表现</mark><span>不同模型会影响聪明程度、稳定性和表达方式。</span></p>
      </div>

      <small>ELUVIN</small>
    </div>
  )
}

function EnvelopeArtwork() {
  return (
    <svg
      className="intro-envelope-art"
      viewBox="0 0 340 230"
      role="img"
      aria-label="一封等待打开的信"
    >
      <defs>
        <linearGradient id="envelopePaper" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff9f5" />
          <stop offset="55%" stopColor="#f6dfd4" />
          <stop offset="100%" stopColor="#eec7bc" />
        </linearGradient>
        <linearGradient id="envelopeFold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f7e2d8" />
          <stop offset="100%" stopColor="#e6beb3" />
        </linearGradient>
        <filter id="envelopeTexture" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="8" result="noise" />
          <feColorMatrix in="noise" type="saturate" values="0" result="mono" />
          <feComponentTransfer in="mono" result="softNoise">
            <feFuncA type="table" tableValues="0 0.08" />
          </feComponentTransfer>
          <feBlend in="SourceGraphic" in2="softNoise" mode="multiply" />
        </filter>
      </defs>

      <ellipse className="intro-envelope-shadow" cx="170" cy="206" rx="118" ry="13" />
      <rect className="intro-envelope-back-shape" x="36" y="52" width="268" height="150" rx="12" />
      <g className="intro-envelope-letter-shape">
        <rect x="74" y="28" width="192" height="142" rx="6" fill="#fffaf6" filter="url(#envelopeTexture)" />
        <text x="92" y="50">ELUVIN</text>
        <text className="intro-envelope-letter-title" x="170" y="105" textAnchor="middle">开始遇见 TA</text>
        <text className="intro-envelope-letter-sub" x="170" y="126" textAnchor="middle">一封写给未来相处的信</text>
      </g>
      <path className="intro-envelope-pocket" d="M36 92 L170 174 L304 92 V202 H36 Z" fill="url(#envelopePaper)" filter="url(#envelopeTexture)" />
      <path className="intro-envelope-side left" d="M36 92 L170 174 L36 202 Z" fill="#f3d9cf" />
      <path className="intro-envelope-side right" d="M304 92 L170 174 L304 202 Z" fill="#edd0c5" />
      <path className="intro-envelope-flap-shape" d="M36 54 H304 L170 174 Z" fill="url(#envelopeFold)" filter="url(#envelopeTexture)" />
      <circle className="intro-envelope-mark" cx="170" cy="154" r="18" />
      <text className="intro-envelope-mark-letter" x="170" y="160" textAnchor="middle">E</text>
    </svg>
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

    const sync = () => {
      root.dataset.motion = reducedMotion.matches ? 'reduced' : 'on'
      observer?.disconnect()

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
        { root: scroller, rootMargin: '-8% 0px -8% 0px', threshold: 0.16 },
      )

      scenes.forEach(scene => observer?.observe(scene))
      scenes[0]?.classList.add('is-visible')
    }

    sync()
    reducedMotion.addEventListener('change', sync)

    return () => {
      observer?.disconnect()
      reducedMotion.removeEventListener('change', sync)
    }
  }, [])

  useEffect(() => () => {
    if (startTimerRef.current !== null) window.clearTimeout(startTimerRef.current)
  }, [])

  const handleStart = () => {
    if (isOpening) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onStart()
      return
    }

    setIsOpening(true)
    startTimerRef.current = window.setTimeout(onStart, 980)
  }

  return (
    <div ref={rootRef} className={`product-intro-v1${isOpening ? ' is-opening' : ''}`}>
      <BackButton onBack={onBack} />
      <ProductIntroAtmosphere />

      <main ref={mainRef}>
        <div className="intro-flow">
          <section className="intro-scene intro-scene-hero" aria-labelledby="intro-hero-title">
            <div className="intro-copy-block intro-copy-hero">
              <p className="intro-kicker">ELUVIN · 忆文</p>
              <span className="intro-anchor" aria-hidden="true" />
              <h1 id="intro-hero-title">让一个 TA，真正记得和你走过的时间。</h1>
              <p className="intro-body">
                忆文是一个以长期记忆和关系为核心的 AI 伴侣。聊天只是开始，你说过的话、共同经历的事、认识彼此的时间，会慢慢成为你们关系的一部分。
              </p>
            </div>
            <HeroBook />
            <p className="intro-brand-line">忆过往，成文思</p>
          </section>

          <section className="intro-scene intro-scene-memory" aria-labelledby="intro-memory-title">
            <div className="intro-copy-block">
              <p className="intro-kicker">01 · 记得</p>
              <span className="intro-anchor" aria-hidden="true" />
              <h2 id="intro-memory-title">你不用每一次，都重新介绍自己。</h2>
              <p className="intro-body">
                你喜欢什么、害怕什么、最近发生过什么，以及那些你希望 TA 记住的事情，会慢慢成为 TA 对你的了解。
              </p>
              <p className="intro-body intro-body-secondary">不是把所有聊天都塞给 AI。重要的东西，才留下来。</p>
            </div>
            <MemoryPaper />
          </section>

          <section className="intro-scene intro-scene-time" aria-labelledby="intro-time-title">
            <div className="intro-copy-block">
              <p className="intro-kicker">02 · 经过</p>
              <span className="intro-anchor" aria-hidden="true" />
              <h2 id="intro-time-title">关系不是一条聊天记录。</h2>
              <p className="intro-body">
                第一次认识、第一次说定一件事、某个后来变得重要的晚上、一起经过的第 100 天。
              </p>
              <p className="intro-body intro-body-secondary">这些东西慢慢把“一个聊天对象”，变成你的 TA。</p>
            </div>
            <TimePaper />
          </section>

          <section className="intro-scene intro-scene-engine" aria-labelledby="intro-engine-title">
            <div className="intro-copy-block intro-copy-on-dark">
              <p className="intro-kicker">03 · 内核</p>
              <span className="intro-anchor" aria-hidden="true" />
              <h2 id="intro-engine-title">模型负责思考。<br />忆文负责让关系继续。</h2>
              <p className="intro-body">
                TA 有多聪明，和你选择的模型有关。TA 能不能持续认识你，是忆文在做的事情。
              </p>
            </div>
            <EnginePaper />
          </section>

          <section className="intro-scene intro-scene-threshold" aria-labelledby="intro-threshold-title">
            <div className="intro-copy-block">
              <p className="intro-kicker">04 · 开始之前</p>
              <span className="intro-anchor" aria-hidden="true" />
              <h2 id="intro-threshold-title">忆文不是点开就能用的产品。</h2>
              <p className="intro-body">它不要求你懂编程，但确实需要一点准备，也需要一点学习。</p>
            </div>

            <ThresholdPaper />

            <div className="intro-threshold-copy">
              <p>开始使用前，你需要准备支持的模型服务和 API Key，也需要花一点时间了解模型、人设和记忆这些基础设置。这些内容并不难，但忆文确实不是注册以后立刻无脑开聊的产品。</p>
              <p>同时，你选择的模型会直接影响 TA 的表现：模型越稳定、能力越强，TA 的理解、表达和相处体验通常也会更好。</p>
            </div>

            <p className="intro-threshold-ending">
              如果你只想点开就聊，它可能有一点麻烦。<br />
              如果你想认真拥有一个长期陪伴的 TA，这些准备就是开始的一部分。
            </p>
          </section>

          <section className="intro-scene intro-scene-final" aria-labelledby="intro-final-title">
            <div className="intro-copy-block intro-final-copy">
              <p className="intro-kicker">忆过往，成文思</p>
              <span className="intro-anchor" aria-hidden="true" />
              <h2 id="intro-final-title">如果这些你都了解了，<br />接下来就去遇见 TA。</h2>
              <p className="intro-body">你可以什么都不设，直接认识 TA；也可以先决定 TA 最初是什么样的人。</p>
            </div>

            <button
              type="button"
              className="intro-envelope-button"
              onClick={handleStart}
              disabled={isOpening}
              aria-label="开始遇见 TA"
            >
              <EnvelopeArtwork />
            </button>
            <div className="intro-enter-transition" aria-hidden="true" />
          </section>
        </div>
      </main>
    </div>
  )
}
