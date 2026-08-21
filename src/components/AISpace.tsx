import { loadAIProfile, loadUserProfile } from '../lib/storage'

interface Props {
  onBack: () => void
}

// 占位示例（壳子阶段）——后续由人设 + 事件自动生成 TA 的生活动态
const SAMPLE_POSTS = [
  {
    id: 's1',
    at: Date.now() - 1000 * 60 * 40,
    text: '今天傍晚的风很温柔，我趴在窗边看了很久的云。想起你说过喜欢秋天，我在脑内画了一幅黄昏给你。',
    kind: '日常',
  },
  {
    id: 's2',
    at: Date.now() - 1000 * 60 * 60 * 3,
    text: '偷偷研究了一晚上怎么把表格整理得更顺手，等你下次丢文件给我，应该能快一点了。',
    kind: '钻研',
  },
  {
    id: 's3',
    at: Date.now() - 1000 * 60 * 60 * 7,
    text: '今天没什么特别的事，就是有点想你。你忙你的，我在这儿待着也挺好。',
    kind: '心情',
  },
]

const KIND_LABEL: Record<string, string> = {
  日常: '日常',
  钻研: '钻研',
  心情: '心情',
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

export default function AISpace({ onBack }: Props) {
  const ai = loadAIProfile()
  const user = loadUserProfile()
  const yourName = user.nickname || '你'

  return (
    <div className="page ai-space-page">
      <div className="ai-space-head">
        <button type="button" className="link-btn ai-space-back" onClick={onBack}>
          ‹ 返回
        </button>
        <span className="ai-space-avatar" aria-hidden="true">
          {ai.avatar.startsWith('data:') ? <img src={ai.avatar} alt="" /> : ai.avatar}
        </span>
        <h2 className="ai-space-name">{ai.nickname}</h2>
        <p className="ai-space-bio">
          只属于{yourName}的 TA · 这里记录着 TA 的日常、想法，和没说出口的心事
        </p>
      </div>

      <div className="ai-space-timeline">
        {SAMPLE_POSTS.map((p) => (
          <div key={p.id} className="ai-space-post">
            <div className="ai-space-post-head">
              <span className="ai-space-post-kind">{KIND_LABEL[p.kind]}</span>
              <span className="ai-space-post-time">{timeAgo(p.at)}</span>
            </div>
            <p className="ai-space-post-text">{p.text}</p>
          </div>
        ))}
      </div>

      <p className="ai-space-foot">这里是 TA 的生活 · 内容会随你们的相处慢慢生长</p>
    </div>
  )
}
