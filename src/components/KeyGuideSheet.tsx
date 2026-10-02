/**
 * 「怎么获取 API Key」弹层。
 *
 * 从 API 设置页那行「不会配？」点开：不再跳去使用指南，直接给一段能照做的流程。
 * 居中、半屏高、内容可上下滚动、右上角 ×，点遮罩关闭。
 */
interface Props {
  open: boolean
  onClose: () => void
}

export default function KeyGuideSheet({ open, onClose }: Props) {
  if (!open) return null
  return (
    <div className="key-guide-mask" role="presentation" onClick={onClose}>
      <section
        className="key-guide-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="怎么获取 API Key"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="key-guide-head">
          <h2>怎么获取 API Key</h2>
          <button type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="key-guide-body">
          <section className="key-guide-block">
            <h3>智谱 GLM（免费，但高峰时期会连不上）</h3>
            <p>打开 bigmodel.cn → 注册并登录 → 个人中心里的「API Keys」→ 创建 → 复制</p>
          </section>
          <section className="key-guide-block">
            <h3>DeepSeek（付费，物美价廉，忆文做了省 token，一天上限最多 2 元）</h3>
            <p>打开 platform.deepseek.com → 登录（首次要实名）→ 先充一点余额（最低 1 元）→ 左侧「API Keys」→ 创建 → 复制</p>
          </section>
          <section className="key-guide-block">
            <h3>中转站</h3>
            <p>服务商选「自定义」，下面会自动展开高级设置：</p>
            <ul>
              <li>地址：填它给你的接口地址，一般以 /v1 结尾</li>
              <li>模型：填它文档里写的模型名</li>
              <li>Key：填它发你的那串</li>
            </ul>
          </section>
          <section className="key-guide-block">
            <h3>拿到之后</h3>
            <p>回上一页，把 Key 粘进输入框（用中转站的，地址和模型也一起填上），先点「测试连接」，通了再保存。</p>
          </section>
          <p className="key-guide-note">
            Key 只存在你自己的浏览器里。中转站连不上，多半是它不允许网页直接连接，换回智谱或 DeepSeek 官方即可。
          </p>
        </div>
      </section>
    </div>
  )
}
