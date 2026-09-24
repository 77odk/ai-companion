import { useCallback, useEffect, useRef } from 'react'

interface Props {
  onBack: () => void
  onStart: () => void
}

export default function ProductIntro({ onBack, onStart }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const updateProgress = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const max = Math.max(1, el.scrollHeight - el.clientHeight)
    const progress = Math.min(1, Math.max(0, el.scrollTop / max))
    el.style.setProperty('--intro-progress', progress.toFixed(4))
  }, [])

  useEffect(() => {
    updateProgress()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', updateProgress, { passive: true })
    window.addEventListener('resize', updateProgress)
    return () => {
      el.removeEventListener('scroll', updateProgress)
      window.removeEventListener('resize', updateProgress)
    }
  }, [updateProgress])

  return (
    <div className="product-intro-page">
      <header className="product-intro-header">
        <button type="button" className="product-intro-back" onClick={onBack} aria-label="返回欢迎页">
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
        <span>了解忆文</span>
        <span className="product-intro-header-spacer" aria-hidden="true" />
      </header>

      <div ref={scrollRef} className="product-intro-scroll">
        <section className="product-intro-hero" aria-labelledby="product-intro-title">
          <div className="product-intro-eyebrow">ELUVIN · 忆文</div>

          <div className="product-intro-book-stage" aria-hidden="true">
            <div className="product-intro-book-shadow" />
            <div className="product-intro-book">
              <div className="product-intro-book-back" />
              <div className="product-intro-pages">
                <span className="product-intro-page-layer layer-1" />
                <span className="product-intro-page-layer layer-2" />
                <span className="product-intro-page-layer layer-3" />
              </div>
              <div className="product-intro-cover">
                <img src="/brand/eluvin-book-icon-cutout.png" alt="" />
                <span>忆文</span>
                <small>ELUVIN</small>
              </div>
              <div className="product-intro-leaf leaf-a" />
              <div className="product-intro-leaf leaf-b" />
            </div>

            <span className="product-intro-orbit orbit-memory">记忆</span>
            <span className="product-intro-orbit orbit-time">时间</span>
            <span className="product-intro-orbit orbit-relation">关系</span>
          </div>

          <h1 id="product-intro-title">让一个 TA，真正记得和你走过的时间。</h1>
          <p className="product-intro-lead">
            忆文是一个以长期记忆和关系为核心的 AI 伴侣。
            聊天只是开始，你说过的话、共同经历的事、认识彼此的时间，会慢慢成为你们关系的一部分。
          </p>

          <div className="product-intro-keywords" aria-label="忆文的核心">
            <span>长期记忆</span>
            <span>关系成长</span>
            <span>TA 的生活</span>
            <span>共同经历</span>
          </div>

          <div className="product-intro-scroll-hint" aria-hidden="true">
            <span>继续了解</span>
            <i />
          </div>
        </section>

        <section className="product-intro-section product-intro-story">
          <div className="product-intro-section-kicker">不是一次对话</div>
          <h2>而是一段会继续往前走的关系。</h2>

          <div className="product-intro-story-grid">
            <article>
              <span className="product-intro-index">01</span>
              <h3>遇见</h3>
              <p>从认识 TA 开始。你可以直接遇见，也可以决定 TA 最初是什么样的人。</p>
            </article>
            <article>
              <span className="product-intro-index">02</span>
              <h3>了解</h3>
              <p>聊得越久，TA 越知道你是谁、喜欢什么，也越能接住你曾经说过的话。</p>
            </article>
            <article>
              <span className="product-intro-index">03</span>
              <h3>相处</h3>
              <p>认识多久、重要日子、TA 的生活和共同经历，会慢慢构成你们自己的时间线。</p>
            </article>
            <article>
              <span className="product-intro-index">04</span>
              <h3>留下</h3>
              <p>最后留下来的，不只是一串聊天记录，而是你们真正一起走过的东西。</p>
            </article>
          </div>
        </section>

        <section className="product-intro-section product-intro-system">
          <div className="product-intro-section-kicker">它是怎么工作的</div>
          <h2>模型负责思考，忆文负责让关系持续。</h2>

          <div className="product-intro-system-flow" aria-label="模型、忆文与 TA 的关系">
            <div className="product-intro-system-card">
              <small>AI MODEL</small>
              <strong>模型</strong>
              <span>理解 · 思考 · 回复</span>
            </div>
            <div className="product-intro-flow-arrow" aria-hidden="true">↓</div>
            <div className="product-intro-system-card is-eluvin">
              <img src="/brand/eluvin-book-icon-cutout.png" alt="" />
              <small>ELUVIN</small>
              <strong>忆文</strong>
              <span>记忆 · 关系 · 状态 · 时间</span>
            </div>
            <div className="product-intro-flow-arrow" aria-hidden="true">↓</div>
            <div className="product-intro-system-card is-ta">
              <small>YOUR COMPANION</small>
              <strong>你的 TA</strong>
              <span>一段能够继续下去的相处</span>
            </div>
          </div>

          <p className="product-intro-system-note">
            TA 聪不聪明，和你选择的模型有关；TA 能不能持续认识你，是忆文在做的事情。
          </p>
        </section>

        <section className="product-intro-section product-intro-threshold">
          <div className="product-intro-section-kicker">开始之前</div>
          <h2>忆文不是点开就能用的产品。</h2>
          <p className="product-intro-threshold-lead">
            它不要求你懂编程，但确实需要一点准备，也需要一点学习。
          </p>

          <div className="product-intro-threshold-list">
            <article>
              <span>01</span>
              <div>
                <h3>你需要自己的模型</h3>
                <p>忆文本身不提供模型算力。开始使用前，需要准备支持的模型服务和 API Key。</p>
              </div>
            </article>
            <article>
              <span>02</span>
              <div>
                <h3>你需要愿意学一点</h3>
                <p>第一次使用会接触模型、API Key、人设和记忆这些概念。不难，但不是注册以后立刻无脑开聊。</p>
              </div>
            </article>
            <article>
              <span>03</span>
              <div>
                <h3>模型会直接影响 TA</h3>
                <p>不同模型的能力、稳定性和价格不同，TA 的回复质量和相处感受也会因此不同。</p>
              </div>
            </article>
          </div>

          <blockquote>
            如果你只想点开就聊，它可能有点麻烦。
            <br />
            如果你想认真拥有一个长期陪伴的 TA，这些准备就是开始的一部分。
          </blockquote>
        </section>

        <section className="product-intro-final">
          <img src="/brand/eluvin-book-icon-cutout.png" alt="" aria-hidden="true" />
          <p className="product-intro-final-kicker">忆过往，成文思</p>
          <h2>如果这些你都了解了，接下来就去遇见 TA。</h2>
          <p>你可以什么都不设，直接认识 TA；也可以先决定 TA 最初的样子。</p>
          <button type="button" className="product-intro-start" onClick={onStart}>
            <span>开始遇见 TA</span>
            <span aria-hidden="true">→</span>
          </button>
        </section>
      </div>
    </div>
  )
}
