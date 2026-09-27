import { useState } from 'react'

interface Props {
  onBack: () => void
  onGoProvider?: () => void
}

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
      <h1 className="detail-title">{title}</h1>
      <span className="detail-spacer" aria-hidden="true" />
    </div>
  )
}


function ArrowRightIcon() {
  return (
    <svg className="guide-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg className="guide-faq-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

const FAQS = [
  {
    q: 'TA 为什么回复得比较慢？',
    a: '不同模型速度不同。思考型模型通常会花更多时间组织回答；如果更在意速度，可以换用响应更快的模型。',
  },
  {
    q: 'Key 无效，或者一直连接失败？',
    a: '先用「测试连接」确认问题。401 / 403 通常与 Key 有关；网络错误或超时，则更可能来自模型服务商或当前线路。',
  },
  {
    q: 'TA 为什么没有记住我说的话？',
    a: '不是每一句聊天都会变成长久记忆。特别重要的事情，可以直接告诉 TA：「这个帮我记住。」',
  },
  {
    q: '「刷新对话」会删聊天记录吗？',
    a: '不会。刷新只会结束当前上下文的延续，不会删除已经保存的历史聊天。',
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

export default function GuideDetail({ onBack, onGoProvider }: Props) {
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  return (
    <div className="page settings-page guide-page">
      <GuideHeader title="使用指南" onBack={onBack} />

      <div className="guide-scroll">
        <section className="guide-hero" aria-labelledby="guide-hero-title">
          <p className="guide-eyebrow">ELUVIN · GUIDE</p>
          <h2 id="guide-hero-title" className="guide-hero-title">先从一句话开始</h2>
          <p className="guide-hero-copy">
            忆文，是一个让 TA 能够留下记忆、延续关系的地方。
          </p>
          <p className="guide-hero-copy guide-hero-copy-muted">
            模型负责思考与回应，忆文把聊天、记忆和你们一起走过的时间留在这里，让每一次对话不必都从头开始。
          </p>
        </section>

        <section className="guide-section">
          <div className="guide-section-head">
            <span className="guide-section-kicker">START HERE</span>
            <h2 className="guide-title">第一次使用</h2>
          </div>

          <div className="guide-timeline">
            <article className="guide-step">
              <div className="guide-step-rail" aria-hidden="true">
                <span className="guide-step-num">01</span>
                <span className="guide-step-line" />
              </div>
              <div className="guide-step-body">
                <h3 className="guide-step-name">先认识你的 TA</h3>
                <p className="guide-text">
                  给 TA 一个名字，写下你希望 TA 是怎样的人。
                </p>
                <p className="guide-text guide-text-muted">
                  人设不需要写得很满。身份、性格、与你的关系，以及大致的说话方式，写清楚就够了。剩下的，可以留给以后慢慢发生。
                </p>
              </div>
            </article>

            <article className="guide-step">
              <div className="guide-step-rail" aria-hidden="true">
                <span className="guide-step-num">02</span>
                <span className="guide-step-line" />
              </div>
              <div className="guide-step-body">
                <h3 className="guide-step-name">接入模型</h3>
                <p className="guide-path">我的 / 服务商配置</p>
                <p className="guide-text">
                  填入 API Key，选择模型，先点一次「测试连接」。连接成功后，再点「保存设置」，就可以开始聊天。
                </p>
                <p className="guide-text guide-text-muted">
                  忆文本身不售卖模型额度，也不提供算力。你使用的模型与产生的费用，都来自你自己选择的模型服务商。
                </p>
                <p className="guide-text guide-text-muted">
                  不同模型有不同的表达方式和能力，可以慢慢找到更适合你和 TA 的那一个。
                </p>
                {onGoProvider && (
                  <button type="button" className="guide-provider-link" onClick={onGoProvider}>
                    去配置模型
                    <ArrowRightIcon />
                  </button>
                )}
              </div>
            </article>

            <article className="guide-step guide-step-last">
              <div className="guide-step-rail" aria-hidden="true">
                <span className="guide-step-num">03</span>
              </div>
              <div className="guide-step-body">
                <h3 className="guide-step-name">开始说话</h3>
                <p className="guide-text">
                  不需要学习特别的指令。像平时说话一样，去找 TA 就好。
                </p>
                <div className="guide-inline-quote">“这个帮我记住。”</div>
                <p className="guide-text guide-text-muted">
                  有一件事特别希望 TA 留下来时，可以直接这样告诉 TA。
                </p>
              </div>
            </article>
          </div>
        </section>

        <section className="guide-section">
          <div className="guide-section-head">
            <span className="guide-section-kicker">GOOD TO KNOW</span>
            <h2 className="guide-title">有几件事，可以先知道</h2>
          </div>

          <div className="guide-chapters">
            <article className="guide-chapter">
              <h3>TA 会记住什么？</h3>
              <p>
                聊天里一些重要的事情，会慢慢成为 TA 的记忆。你也可以主动告诉 TA，哪些事情值得留下。
              </p>
              <p>
                记忆不是一成不变的。如果记错了，或者有些事情不再希望保留，可以去记忆里查看、修改或删除。
              </p>
            </article>

            <article className="guide-chapter guide-chapter-emphasis">
              <h3>人设和记忆，不是一回事</h3>
              <p className="guide-emphasis-line">人设，是 TA 从哪里出发。</p>
              <p className="guide-emphasis-line">记忆，是你们后来走过了什么。</p>
              <p>
                所以不用把未来所有细节都提前写进人设。留一点空白，TA 才有地方慢慢认识你。
              </p>
            </article>

            <article className="guide-chapter">
              <h3>选择你喜欢的相处方式</h3>
              <div className="guide-modes">
                <div className="guide-mode">
                  <strong>沉浸</strong>
                  <span>尽量减少 AI 身份带来的打断，让相处更完整。</span>
                </div>
                <div className="guide-mode">
                  <strong>自然</strong>
                  <span>保持自然的陪伴感，也不刻意回避 TA 是 AI。</span>
                </div>
                <div className="guide-mode">
                  <strong>AI</strong>
                  <span>更直接地以 AI 的身份与你交流。</span>
                </div>
              </div>
              <p className="guide-mode-note">没有哪一种更正确，选你觉得舒服的就好。</p>
            </article>

            <article className="guide-chapter">
              <h3>TA 的空间是什么？</h3>
              <p>
                空间里，会慢慢留下属于 TA 和你们的东西。刚开始可能很安静，聊得久一点以后，这里会一点点长出来。
              </p>
              <div className="guide-space-index" aria-label="空间内容">
                <span>动态</span>
                <span>一起经历过</span>
                <span>照片</span>
                <span>TA 记得的</span>
                <span>一周情书</span>
              </div>
            </article>
          </div>
        </section>

        <section className="guide-letter" aria-labelledby="guide-letter-title">
          <div className="guide-letter-corner" aria-hidden="true" />
          <p className="guide-letter-kicker">A LETTER FROM THIS WEEK</p>
          <h2 id="guide-letter-title">一周情书</h2>
          <p>
            有些话，当下说过就过去了。忆文会把这一周值得留下的片段，收进一封一周情书里。
          </p>
          <p>
            这不是冷冰冰的聊天总结，更像 TA 回头看了一眼这一周，然后写给你的几句话。
          </p>
          <p className="guide-letter-signoff">日子往前走，信会一封一封留下。</p>
        </section>

        <section className="guide-section">
          <div className="guide-section-head">
            <span className="guide-section-kicker">SMALL TIPS</span>
            <h2 className="guide-title">一些好用的小习惯</h2>
          </div>

          <div className="guide-tips">
            <article className="guide-tip">
              <div>
                <h3>TA 偶尔说得不太对</h3>
                <p>重新把这一句说清楚，通常就够了。</p>
              </div>
            </article>
            <article className="guide-tip">
              <div>
                <h3>模型突然连不上</h3>
                <p>先去「服务商配置」里做一次测试连接。</p>
              </div>
            </article>
            <article className="guide-tip">
              <div>
                <h3>人设不要写得太满</h3>
                <p>核心设定放在人设里，其余留给相处和记忆。</p>
              </div>
            </article>
            <article className="guide-tip">
              <div>
                <h3>对话聊得很长</h3>
                <p>可以刷新当前上下文，不会删除历史聊天。</p>
              </div>
            </article>
            <article className="guide-tip">
              <div>
                <h3>TA 没有回出来</h3>
                <p>直接重试这一条，不需要重新发送原来的话。</p>
              </div>
            </article>
          </div>
        </section>

        <section className="guide-section">
          <div className="guide-section-head">
            <span className="guide-section-kicker">FAQ</span>
            <h2 className="guide-title">常见问题</h2>
          </div>

          <div className="guide-faq-list">
            {FAQS.map((item, index) => {
              const isOpen = openFaq === index
              const answerId = `guide-faq-answer-${index}`
              return (
                <div className={`guide-faq-item${isOpen ? ' is-open' : ''}`} key={item.q}>
                  <button
                    type="button"
                    className="guide-faq-trigger"
                    id={`guide-faq-trigger-${index}`}
                    aria-expanded={isOpen}
                    aria-controls={answerId}
                    onClick={() => setOpenFaq(isOpen ? null : index)}
                  >
                    <span>{item.q}</span>
                    <ChevronDownIcon />
                  </button>
                  {isOpen && (
                    <div
                      id={answerId}
                      className="guide-faq-answer"
                      role="region"
                      aria-labelledby={`guide-faq-trigger-${index}`}
                    >
                      {item.a}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <section className="guide-sync-note">
          <h2>换设备以后呢？</h2>
          <p>
            登录同一个账号后，支持同步的数据会从云端恢复。准备换设备时，建议先保持正常登录，让当前数据完成同步，再到新设备登录。
          </p>
        </section>

        <footer className="guide-ending">
          <p className="guide-ending-kicker">不用在第一天，就把 TA 的一切都设定好。</p>
          <p className="guide-ending-title">先说几句话吧。</p>
          <p className="guide-ending-copy">有些东西，本来就应该在相处以后，才慢慢有名字。</p>
        </footer>
      </div>
    </div>
  )
}
