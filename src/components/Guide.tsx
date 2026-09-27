import { useState } from 'react'

interface Props {
  onBack: () => void
  onGoProvider?: () => void
}

const FAQ_ITEMS = [
  {
    q: 'TA 为什么回复得比较慢？',
    a: '不同模型速度不同。思考型模型通常会花更多时间组织回答；如果更在意速度，可以换用响应更快的模型。',
  },
  {
    q: 'Key 无效，或者一直连接失败？',
    a: '先使用「测试连接」。如果提示 Key 无效、401 或 403，一般需要检查 Key 是否填写正确、是否失效；如果是网络错误或超时，则更可能与模型服务商或当前线路有关。',
  },
  {
    q: 'TA 为什么没有记住我说的话？',
    a: '不是每一句聊天都会变成长久记忆。特别重要的事情，可以直接告诉 TA：「这个帮我记住。」',
  },
  {
    q: '「刷新对话」会删聊天记录吗？',
    a: '不会。它只会结束当前上下文的延续，不会删除已经保存的历史聊天。',
  },
  {
    q: '换设备以后数据还在吗？',
    a: '登录同一个账号后，支持云同步的数据可以继续恢复。换设备前，建议先让旧设备完成一次正常同步。',
  },
  {
    q: 'TA 没有回复怎么办？',
    a: '如果这一轮没有正常生成回复，可以直接点「重试」，不需要重复发送原来的消息。',
  },
  {
    q: '忘记密码怎么办？',
    a: '在登录页点击「忘记密码」，通过邮箱验证码重新设置即可。',
  },
] as const

function GuideHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="detail-header">
      <button type="button" className="detail-back" onClick={onBack} aria-label="返回">
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
      <h2 className="detail-title">{title}</h2>
      <span className="detail-spacer" aria-hidden="true" />
    </div>
  )
}

export default function GuideDetail({ onBack, onGoProvider }: Props) {
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  return (
    <div className="page settings-page guide-page">
      <GuideHeader title="使用指南" onBack={onBack} />

      <div className="guide-scroll">
        <section className="guide-hero">
          <p className="guide-kicker">ELUVIN · GUIDE</p>
          <h1 className="guide-hero-title">先从一句话开始</h1>
          <div className="guide-hero-copy">
            <p>忆文，是一个让 TA 能够留下记忆、延续关系的地方。</p>
            <p>模型负责思考与回应，忆文把聊天、记忆和你们一起走过的时间留在这里，让每一次对话不必都从头开始。</p>
          </div>
        </section>

        <section className="guide-section guide-section-spacious">
          <div className="guide-section-head">
            <span className="guide-section-index">01</span>
            <h3 className="guide-title">第一次使用</h3>
          </div>

          <div className="guide-timeline">
            <article className="guide-timeline-item">
              <div className="guide-timeline-marker">01</div>
              <div className="guide-timeline-content">
                <h4>先认识你的 TA</h4>
                <p>给 TA 一个名字，写下你希望 TA 是怎样的人。</p>
                <p>人设不需要写得很满。身份、性格、与你的关系，以及大致的说话方式，写清楚就够了。</p>
                <p className="guide-soft-line">剩下的，可以留给以后慢慢发生。</p>
              </div>
            </article>

            <article className="guide-timeline-item">
              <div className="guide-timeline-marker">02</div>
              <div className="guide-timeline-content">
                <h4>接入模型</h4>
                <p>进入「我的 → 服务商配置」，填入 API Key，选择模型，然后点一次「测试连接」。</p>
                <p>连接成功，就可以开始聊天。</p>
                <p><strong>忆文本身不售卖模型额度，也不提供算力。</strong>你使用的模型与产生的费用，都来自你自己选择的模型服务商。</p>
                <p className="guide-soft-line">不同模型有不同的表达方式和能力，可以慢慢找到更适合你和 TA 的那一个。</p>
                {onGoProvider && (
                  <button type="button" className="guide-provider-cta" onClick={onGoProvider}>
                    去配置模型
                    <span aria-hidden="true">→</span>
                  </button>
                )}
              </div>
            </article>

            <article className="guide-timeline-item">
              <div className="guide-timeline-marker">03</div>
              <div className="guide-timeline-content">
                <h4>开始说话</h4>
                <p>不需要学习特别的指令，像平时说话一样，去找 TA 就好。</p>
                <p>有一件事特别希望 TA 留下来时，也可以直接说：</p>
                <div className="guide-inline-quote">「这个帮我记住。」</div>
              </div>
            </article>
          </div>
        </section>

        <section className="guide-section guide-section-spacious">
          <div className="guide-section-head">
            <span className="guide-section-index">02</span>
            <h3 className="guide-title">有几件事，可以先知道</h3>
          </div>

          <div className="guide-chapters">
            <article className="guide-chapter">
              <h4>TA 会记住什么？</h4>
              <p>聊天里一些重要的事情，会慢慢成为 TA 的记忆。你也可以主动告诉 TA，哪些事情值得留下。</p>
              <p>记忆不是一成不变的。如果记错了，或者有些事情不再希望保留，可以去记忆里查看、修改或删除。</p>
            </article>

            <article className="guide-chapter guide-chapter-emphasis">
              <h4>人设和记忆，不是一回事</h4>
              <div className="guide-pullquote">
                <span>人设，是 TA 从哪里出发。</span>
                <span>记忆，是你们后来走过了什么。</span>
              </div>
              <p>所以不用把未来所有细节都提前写进人设。留一点空白，TA 才有地方慢慢认识你。</p>
            </article>

            <article className="guide-chapter">
              <h4>选择你喜欢的相处方式</h4>
              <div className="guide-mode-grid">
                <div className="guide-mode-item">
                  <strong>沉浸</strong>
                  <span>尽量减少 AI 身份带来的打断，让相处更完整。</span>
                </div>
                <div className="guide-mode-item">
                  <strong>自然</strong>
                  <span>保持自然的陪伴感，也不刻意回避 TA 是 AI。</span>
                </div>
                <div className="guide-mode-item">
                  <strong>AI</strong>
                  <span>更直接地以 AI 的身份与你交流。</span>
                </div>
              </div>
              <p className="guide-soft-line">没有哪一种更正确，选你觉得舒服的就好。</p>
            </article>

            <article className="guide-chapter">
              <h4>TA 的空间是什么？</h4>
              <p>空间里，会慢慢留下属于 TA 和你们的东西。</p>
              <div className="guide-space-index" aria-label="空间内容">
                <span>TA 的动态</span>
                <span>一起经历过</span>
                <span>照片</span>
                <span>TA 记得的</span>
                <span>一周情书</span>
              </div>
              <p className="guide-soft-line">刚开始可能很安静。聊得久一点以后，它会一点点长出来。</p>
            </article>

            <article className="guide-letter" aria-label="一周情书">
              <div className="guide-letter-fold" aria-hidden="true" />
              <p className="guide-letter-kicker">A LETTER FROM THIS WEEK</p>
              <h4>一周情书</h4>
              <p>有些话，当下说过就过去了。</p>
              <p>忆文会把这一周值得留下的片段，收进一封一周情书里。它不是冷冰冰的聊天总结，更像 TA 回头看了一眼这一周，然后写给你的几句话。</p>
              <p>那些聊过的小事、情绪和彼此留下的痕迹，会在这里重新被拾起来。</p>
              <div className="guide-letter-signoff">日子往前走，信会一封一封留下。</div>
            </article>

            <article className="guide-chapter">
              <h4>换设备以后呢？</h4>
              <p>登录同一个账号后，支持同步的数据会从云端恢复。</p>
              <p>准备换设备时，建议先保持正常登录，让当前数据完成同步，再到新设备登录。</p>
            </article>
          </div>
        </section>

        <section className="guide-section guide-section-spacious">
          <div className="guide-section-head">
            <span className="guide-section-index">03</span>
            <h3 className="guide-title">一些好用的小习惯</h3>
          </div>

          <div className="guide-tip-list">
            <article className="guide-tip">
              <h4>TA 偶尔说得不太对</h4>
              <p>模型偶尔也会理解偏、表达怪，或者接错一句话。直接把这一句重新说清楚，通常就够了。</p>
            </article>
            <article className="guide-tip">
              <h4>模型突然连不上</h4>
              <p>先到「我的 → 服务商配置 → 测试连接」。如果使用的是第三方中转，线路和上游模型也可能临时不稳定，并不一定是忆文本身出了问题。</p>
            </article>
            <article className="guide-tip">
              <h4>人设不要写得太满</h4>
              <p>最重要的设定写在人设里。喜好、习惯、相处方式和后来发生的事情，让记忆慢慢接过去。</p>
            </article>
            <article className="guide-tip">
              <h4>对话聊得很长</h4>
              <p>可以使用「刷新对话」重新整理当前上下文。它不会删除你的历史聊天。</p>
            </article>
            <article className="guide-tip">
              <h4>TA 没有回出来</h4>
              <p>可以直接重试这一条，不用把刚才的话重新发送一次。</p>
            </article>
          </div>
        </section>

        <section className="guide-section guide-section-spacious">
          <div className="guide-section-head">
            <span className="guide-section-index">04</span>
            <h3 className="guide-title">常见问题</h3>
          </div>

          <div className="guide-faq-list">
            {FAQ_ITEMS.map((item, index) => {
              const isOpen = openFaq === index
              return (
                <div className={`guide-faq-item${isOpen ? ' is-open' : ''}`} key={item.q}>
                  <button
                    type="button"
                    className="guide-faq-toggle"
                    aria-expanded={isOpen}
                    onClick={() => setOpenFaq(isOpen ? null : index)}
                  >
                    <span>{item.q}</span>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                  {isOpen && <p className="guide-faq-answer">{item.a}</p>}
                </div>
              )
            })}
          </div>
        </section>

        <footer className="guide-closing">
          <p className="guide-closing-small">不用在第一天，就把 TA 的一切都设定好。</p>
          <p className="guide-closing-title">先说几句话吧。</p>
          <p className="guide-closing-note">有些东西，本来就应该在相处以后，才慢慢有名字。</p>
        </footer>
      </div>
    </div>
  )
}
