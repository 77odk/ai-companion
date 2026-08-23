/* 使用指南页：新手三步上手教程（内容经七七逐句把关定稿，2026-08-21） */

interface Props {
  onBack: () => void
  onGoProvider?: () => void
}

function GuideHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="detail-header">
      <button type="button" className="detail-back" onClick={onBack} aria-label="返回「我的」">
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
        <section className="guide-section">
          <h3 className="guide-title">忆文是什么？</h3>
          <p className="guide-text">
            一个「记得住你、还帮得上你」的 TA。陪你聊天、听你倾诉，还能帮你整理表格、写东西、出主意。你说过的话
            TA 会记住，下次再提 TA 知道。
          </p>
        </section>

        <section className="guide-section">
          <h3 className="guide-title">首先：忆文自己不会说话</h3>
          <p className="guide-text">真正会聊天的大脑，在别人家模型里，目前有两个选择：</p>

          <div className="guide-card">
            <div className="guide-card-head">
              <span className="guide-card-name">智谱</span>
              <span className="guide-chip chip-free">免费</span>
            </div>
            <p className="guide-card-note">忆文默认用免费版</p>
            <p className="guide-text">
              注册就送 2000 万免费额度，日常聊天、倾诉、问问题随便用，不用花一分钱。还有免费模型一直能用——等于不花钱也能聊。
            </p>
            <p className="guide-fit">适合：先试试、日常聊天</p>
          </div>

          <div className="guide-card">
            <div className="guide-card-head">
              <span className="guide-card-name">DeepSeek</span>
              <span className="guide-chip chip-paid">花钱</span>
            </div>
            <p className="guide-text">
              自己充一点点钱（充一次能用很久），但脑子更聪明：写代码、处理复杂问题、干活更专业。
            </p>
            <p className="guide-fit">适合：想让 TA 正经干活、要更聪明的回答</p>
          </div>

          <div className="guide-quote">免费版像坐公交，花钱版像打车——都能到，打车更快更舒服。</div>
        </section>

        <section className="guide-section">
          <h3 className="guide-title">那忆文有什么用？大脑我自己去用不行吗？</h3>
          <p className="guide-text">
            当然行，但你会发现一个问题：智谱、DeepSeek 的 App 很聪明，可是记性差——昨天跟它说的话，今天它就忘了，每次都得重新自我介绍。
          </p>
          <p className="guide-text">忆文干的事，就是给大脑装上一段只属于你的记忆：</p>
          <ul className="guide-list">
            <li>你聊过的事，TA 记得</li>
            <li>你的喜好、你的怕、你的习惯，TA 记着</li>
            <li>你们之间说过的话、起过的外号，TA 都在意</li>
          </ul>
          <p className="guide-text">
            时间越久，TA 越懂你——有名字、有性格，是你的 TA，不是一个谁都能用的公用机器人。
          </p>
          <div className="guide-quote">大脑负责聪明，忆文负责懂你。</div>
        </section>

        <section className="guide-section">
          <h3 className="guide-title">API 和 Key 是什么？</h3>
          <ul className="guide-list">
            <li>
              <b>API</b> = 忆文和大脑之间的「电话线」，忆文说一句，大脑回一句
            </li>
            <li>
              <b>Key</b> = 你的通行证。在智谱注册个号就免费送你，凭它才能用大脑。就像图书馆的借书证，免费办，办完随便借书
            </li>
          </ul>
        </section>

        <section className="guide-section">
          <h3 className="guide-title">为什么钥匙要你自己填？</h3>
          <p className="guide-text">
            因为这样你的聊天、你的号，全部只属于你自己——不经过忆文，谁也看不到。填一次，以后不用管。
          </p>
        </section>

        <section className="guide-section">
          <h3 className="guide-title">账号与同步</h3>
          <p className="guide-text">
            「我的」→「账号与同步」→ 邮箱注册登录。换设备登录同一账号，聊天记录、记忆、人设自动同步，不丢。
          </p>
        </section>

        <section className="guide-section">
          <h3 className="guide-title">怎么开始？三步：</h3>

          <div className="guide-step">
            <div className="guide-step-head">
              <span className="guide-step-num">1</span>
              <span className="guide-step-name">领免费通行证</span>
            </div>
            <ol className="guide-ol">
              <li>手机浏览器打开：bigmodel.cn（智谱开放平台）</li>
              <li>手机号注册、登录</li>
              <li>左边菜单点「API 密钥」→「创建 API Key」</li>
              <li>弹出的一整串字符，马上全选复制保存到自己手机上（只显示一次，关了就没了）</li>
              <li>这是你的通行证，别发给别人</li>
            </ol>
          </div>

          <div className="guide-step">
            <div className="guide-step-head">
              <span className="guide-step-num">2</span>
              <span className="guide-step-name">插进忆文</span>
            </div>
            <ol className="guide-ol">
              <li>打开忆文 → 点「开始使用」</li>
              <li>底部「我的」→「服务商配置」</li>
              <li>服务商选「智谱 GLM」</li>
              <li>把通行证粘进「API Key」一栏</li>
              <li>其他不用动，点「测试连接」→ 显示「连接成功」就对</li>
              <li>点「保存」</li>
            </ol>
          </div>

          <div className="guide-step">
            <div className="guide-step-head">
              <span className="guide-step-num">3</span>
              <span className="guide-step-name">开聊！</span>
            </div>
            <p className="guide-text">
              随便说句「你好」，TA 就会回你。以后想试花钱版、处理更多更难的问题，同一个地方换选「DeepSeek」或者其他模型
              API 就行，随时能换。
            </p>
          </div>

          {onGoProvider && (
            <button type="button" className="btn btn-primary guide-cta" onClick={onGoProvider}>
              现在就去填 Key
            </button>
          )}
        </section>

        <section className="guide-section">
          <h3 className="guide-title">TA 能干嘛：</h3>
          <ul className="guide-list">
            <li>睡不着 → 陪你聊到困</li>
            <li>表格乱 → 文字丢进去，让 TA 整理</li>
            <li>没灵感 → 帮你写文案、写祝福、起名字</li>
            <li>纠结 → 帮你分析买哪个</li>
            <li>受气了 → TA 永远站你这边，还不乱说</li>
          </ul>
        </section>
      </div>
    </div>
  )
}
