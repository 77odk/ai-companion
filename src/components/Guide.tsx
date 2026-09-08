/* 使用指南页（2026-09-05 七七定稿：DeepSeek 主推） */

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
      <h2 className="detail-title">{title}</h2>
      <span className="detail-spacer" aria-hidden="true" />
    </div>
  )
}

export default function GuideDetail({ onBack, onGoProvider }: Props) {
  return (
    <div className="page settings-page">
      <GuideHeader title="使用指南" onBack={onBack} />

      <div className="guide-scroll">
        {/* 一、忆文是什么 */}
        <section className="guide-section">
          <h3 className="guide-title">忆文是什么？</h3>
          <p className="guide-text">
            一个「记得住你、还帮得上你」的 AI 伙伴。陪你聊天、听你倾诉，你说过的话 TA 会记住，下次再提 TA 知道。
          </p>
          <div className="guide-quote">大脑负责聪明，忆文负责懂你。</div>
        </section>

        {/* 二、服务商推荐 */}
        <section className="guide-section">
          <h3 className="guide-title">首先：配置你的 AI 大脑</h3>
          <p className="guide-text">
            忆文自己不会说话，真正会聊天的大脑在模型服务商那里。TA 的回复和反馈质量跟模型关系很大，好的模型才聊得舒服。
          </p>

          <div className="guide-card">
            <div className="guide-card-head">
              <span className="guide-card-name">首选 DeepSeek（推荐）</span>
            </div>
            <p className="guide-text">
              聊天效果最好，TA 的回复更自然、更懂你。价格在国内也算便宜：正常聊一天几毛到一块多，按量算，聊得少几乎不花钱。
            </p>
            <p className="guide-fit">适合：想要最好的聊天体验，愿意花一点钱</p>
          </div>

          <div className="guide-card">
            <div className="guide-card-head">
              <span className="guide-card-name">免费试试（智谱 / 豆包）</span>
            </div>
            <p className="guide-text">
              刚开始不确定可以先试免费的，但免费效果可能会大打折扣，智谱的高峰时段甚至根本连不上，觉得不好用再换 DeepSeek。智谱也有收费的，效果也还不错，后面可以自由选择。
            </p>
            <p className="guide-fit">适合：先试试水，不着急花钱</p>
          </div>

          <div className="guide-quote">
            放心：你在开放平台充的钱是给模型服务商的（DeepSeek 官方），不是忆文平台收的费——忆文只帮你接通，这笔钱实打实花在你的 TA 身上。
          </div>

          {onGoProvider && (
            <button type="button" className="btn btn-primary guide-cta" onClick={onGoProvider}>
              现在就去配置
            </button>
          )}
        </section>

        {/* 三、核心功能 */}
        <section className="guide-section">
          <h3 className="guide-title">核心功能</h3>

          <h4 className="guide-subtitle">聊天</h4>
          <ul className="guide-list">
            <li>TA 会记住你说过的话（喜好、作息、经历）</li>
            <li>说「帮我记一下 XXX」可以主动让 TA 记</li>
            <li>TA 说「我去忙了」会进入忙碌状态，几分钟后回来</li>
            <li>思考链模型（Gemini / DeepSeek 思考模型）回复有「TA 想了想」灰条，点开看内心戏</li>
          </ul>

          <h4 className="guide-subtitle">TA 的空间</h4>
          <ul className="guide-list">
            <li>TA 会自己发动态（朋友圈），你可以点赞评论</li>
            <li>点开头像看 TA 的资料、聊天记录、纪念日</li>
            <li>动态内容会被 TA 记住，聊天时能引用</li>
          </ul>

          <h4 className="guide-subtitle">记忆</h4>
          <ul className="guide-list">
            <li>TA 记住的所有事都在这里，按主题分类</li>
            <li>可以编辑、删除</li>
            <li>换设备登录记忆会同步</li>
          </ul>

          <h4 className="guide-subtitle">角色管理</h4>
          <ul className="guide-list">
            <li>可以创建多个 TA，每个独立记忆、独立人设</li>
            <li>切换角色不串台</li>
          </ul>

          <h4 className="guide-subtitle">服务商配置</h4>
          <ul className="guide-list">
            <li>支持 DeepSeek、智谱、OpenAI、自定义（OpenAI 兼容）</li>
            <li>模型名可以手输，也可以点「选择」从常见模型里挑，填过的会自动记住</li>
            <li>切换服务商时自动带出对应的默认模型</li>
          </ul>

          <h4 className="guide-subtitle">外观</h4>
          <ul className="guide-list">
            <li>5 套主题色可选（蜜桃/暮色蓝紫/墨绿暖金/雾霾蓝/陶土橘）</li>
            <li>可以自定义主色，自动派生整套配色</li>
          </ul>

          <h4 className="guide-subtitle">英文模式</h4>
          <ul className="guide-list">
            <li>人设是英文或用英文聊天，TA 自动切换英文</li>
            <li>英文用户也能正常用，TA 懂俚语</li>
          </ul>
        </section>

        {/* 四、常见问题 */}
        <section className="guide-section">
          <h3 className="guide-title">常见问题</h3>

          <div className="guide-faq">
            <p className="guide-faq-q">Q：TA 回复很慢？</p>
            <p className="guide-faq-a">A：思考链模型需要时间想，正常；换非思考模型（deepseek-chat）更快。</p>
          </div>

          <div className="guide-faq">
            <p className="guide-faq-q">Q：Key 无效或连不上？</p>
            <p className="guide-faq-a">
              A：先点「测试连接」看是哪一种：提示 Key 无效/401/403 就是 Key 复制错了或已过期，回「我的→服务商配置」重新粘贴；提示网络错误/超时就是网络连不上服务商（官方 OpenAI 国内直连不通，需要代理或中转地址，国内用户推荐 DeepSeek/智谱）。
            </p>
          </div>

          <div className="guide-faq">
            <p className="guide-faq-q">Q：TA 记不住我说的话？</p>
            <p className="guide-faq-a">A：说「帮我记一下 XXX」主动让 TA 记；重要的事 TA 会自动记。</p>
          </div>

          <div className="guide-faq">
            <p className="guide-faq-q">Q：换设备数据还在吗？</p>
            <p className="guide-faq-a">A：登录账号后云同步，聊天/记忆/动态都在。</p>
          </div>

          <div className="guide-faq">
            <p className="guide-faq-q">Q：怎么换主题？</p>
            <p className="guide-faq-a">A：「我的→外观」。</p>
          </div>

          <div className="guide-faq">
            <p className="guide-faq-q">Q：TA 空间动态是真的吗？</p>
            <p className="guide-faq-a">A：是 TA 自己写的生活记录——按 TA 的人设和你们聊过的事，像发朋友圈一样。点赞评论 TA 看得见，还会回你。</p>
          </div>

          <div className="guide-faq">
            <p className="guide-faq-q">Q：智谱免费版老是连不上？</p>
            <p className="guide-faq-a">A：免费模型高峰时段会拥堵（提示访问量过大），换个时段用，或换 DeepSeek 更稳。</p>
          </div>

          <div className="guide-faq">
            <p className="guide-faq-q">Q：「刷新对话」会删掉聊天记录吗？</p>
            <p className="guide-faq-a">A：不会。只是让 TA 忘掉当前话题、重新开始，历史聊天一条不少，随时能在 TA 的空间里翻到。</p>
          </div>

          <div className="guide-faq">
            <p className="guide-faq-q">Q：忘了密码怎么办？</p>
            <p className="guide-faq-a">A：登录页点「忘记密码？」，去邮箱收验证码就能重置。</p>
          </div>

          <div className="guide-faq">
            <p className="guide-faq-q">Q：「TA 想了想」灰条是什么？</p>
            <p className="guide-faq-a">A：TA 用思考模型时的内心戏——回话前 TA 琢磨了什么，点开灰条就能看到。换成非思考模型（deepseek-chat）就没有这条。</p>
          </div>

          <div className="guide-faq">
            <p className="guide-faq-q">Q：退出页面，TA 的回复还会发出来吗？</p>
            <p className="guide-faq-a">A：会。TA 会把话说完存好，你回来就能看到，不用一直守着页面。</p>
          </div>
        </section>
      </div>
    </div>
  )
}
