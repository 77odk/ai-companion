import { useRef, useState, type ChangeEvent } from 'react'
import { API_BASE } from '../lib/sync'
import { getToken, logout } from '../lib/auth'

export type FeedbackType = 'bug' | 'idea' | 'experience' | 'other'

export interface PickedImage {
  name: string
  mime: string
  bytes: number
  dataUrl: string
}

export interface FeedbackDraft {
  type: FeedbackType
  content: string
  images: PickedImage[]
}

interface Props {
  onBack: () => void
  initialDraft: FeedbackDraft
  onDraftChange: (draft: FeedbackDraft) => void
  onAuthExpired?: () => void
}

const MAX_IMAGES = 5
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_CONTENT_LENGTH = 2000
const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp']

const TYPE_OPTIONS: Array<{ value: FeedbackType; label: string }> = [
  { value: 'bug', label: '出问题了' },
  { value: 'idea', label: '想要的功能' },
  { value: 'experience', label: '用起来的感觉' },
  { value: 'other', label: '其他' },
]

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function mimeLabel(mime: string): string {
  if (mime === 'image/jpeg') return 'JPG'
  if (mime === 'image/png') return 'PNG'
  if (mime === 'image/webp') return 'WebP'
  return mime
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('read failed'))
    }
    reader.onerror = () => reject(new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

/**
 * 反馈与建议：类型 + 正文（≤2000 字）+ 可选截图（最多 5 张、单张 ≤5MB、JPG/PNG/WebP）。
 * 提交前先在本地校验一遍，超出限制直接给人话提示；提交成功后清空表单，失败保留已填内容。
 */
export default function FeedbackPage({ onBack, initialDraft, onDraftChange, onAuthExpired }: Props) {
  const [type, setType] = useState<FeedbackType>(initialDraft.type)
  const [content, setContent] = useState(initialDraft.content)
  const [images, setImages] = useState<PickedImage[]>(initialDraft.images)
  const [submitting, setSubmitting] = useState(false)
  const [readingImages, setReadingImages] = useState(false)
  const imageReadInFlightRef = useRef(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const pickImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? [])
    // 清掉 value，同一张图改完还能再选一次
    event.target.value = ''
    if (picked.length === 0 || imageReadInFlightRef.current || submitting) return

    imageReadInFlightRef.current = true
    setReadingImages(true)
    const loaded: PickedImage[] = []
    const problems: string[] = []
    const remaining = Math.max(0, MAX_IMAGES - images.length)

    try {
      for (const file of picked) {
        if (!ACCEPTED_MIME.includes(file.type)) {
          problems.push(`「${file.name}」不是支持的类型，只收 JPG、PNG、WebP。`)
          continue
        }
        if (file.size > MAX_IMAGE_BYTES) {
          problems.push(`「${file.name}」有 ${formatBytes(file.size)}，超过 5MB 了，换一张小一点的。`)
          continue
        }
        if (loaded.length >= remaining) {
          problems.push('截图最多 5 张，多出来的没有加进去。')
          break
        }
        try {
          loaded.push({
            name: file.name,
            mime: file.type,
            bytes: file.size,
            dataUrl: await readAsDataUrl(file),
          })
        } catch {
          problems.push(`「${file.name}」没能读出来，再选一次试试。`)
        }
      }
      if (loaded.length > 0) {
        setImages((current) => {
          const next = [...current, ...loaded].slice(0, MAX_IMAGES)
          onDraftChange({ type, content, images: next })
          return next
        })
      }
      setError(problems.join(' '))
      setDone(false)
    } finally {
      imageReadInFlightRef.current = false
      setReadingImages(false)
    }
  }

  const removeImage = (index: number) => {
    const next = images.filter((_, position) => position !== index)
    setImages(next)
    onDraftChange({ type, content, images: next })
    setError('')
  }

  const handleSubmit = async () => {
    if (submitting || readingImages || imageReadInFlightRef.current) return
    const trimmed = content.trim()
    if (!trimmed) {
      setError('先写点内容再提交吧。')
      return
    }
    if (trimmed.length > MAX_CONTENT_LENGTH) {
      setError(`正文最多 ${MAX_CONTENT_LENGTH} 字，现在有点长了。`)
      return
    }
    // 提交前再核一遍截图：数量 / 单张大小 / 格式，避免白跑一趟
    if (images.length > MAX_IMAGES) {
      setError(`截图最多 ${MAX_IMAGES} 张。`)
      return
    }
    const tooBig = images.find((image) => image.bytes > MAX_IMAGE_BYTES)
    if (tooBig) {
      setError(`「${tooBig.name}」超过 5MB 了，换一张小一点的。`)
      return
    }
    const badType = images.find((image) => !ACCEPTED_MIME.includes(image.mime))
    if (badType) {
      setError(`「${badType.name}」不是支持的类型，只收 JPG、PNG、WebP。`)
      return
    }
    const token = getToken()
    if (!token) {
      setError('登录之后才能提交反馈与建议。')
      return
    }

    setSubmitting(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/api/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          type,
          content: trimmed,
          images: images.map((image) => ({ name: image.name, mime: image.mime, dataUrl: image.dataUrl })),
        }),
      })
      if (response.status === 401) {
        if (getToken() === token) {
          onAuthExpired?.()
          logout()
        }
        return
      }
      if (!response.ok) throw new Error(`feedback ${response.status}`)
      setContent('')
      setImages([])
      setType('bug')
      onDraftChange({ type: 'bug', content: '', images: [] })
      setDone(true)
    } catch {
      // 失败保留已填内容，让 TA 直接重试
      setError('没提交成功，网络可能开小差了。内容都还在，过一会儿再点一次。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page settings-page feedback-page">
      <div className="detail-header">
        <button type="button" className="detail-back detail-back-text" onClick={onBack} aria-label="返回">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
          返回
        </button>
        <h2 className="detail-title">反馈与建议</h2>
        <span className="detail-spacer" aria-hidden="true" />
      </div>

      <section className="profile-group">
        <h3 className="profile-group-title">类型</h3>
        <div className="profile-group-card" role="radiogroup" aria-label="反馈类型">
          {TYPE_OPTIONS.map((option) => {
            const selected = option.value === type
            return (
              <button
                key={option.value}
                type="button"
                className="entry-row"
                role="radio"
                aria-checked={selected}
                disabled={submitting || readingImages}
                onClick={() => {
                  setType(option.value)
                  onDraftChange({ type: option.value, content, images })
                  setDone(false)
                }}
              >
                <span className="entry-label">{option.label}</span>
                {selected ? <span className="entry-status">已选</span> : null}
              </button>
            )
          })}
        </div>
      </section>

      <div className="settings-card">
        <div className="field">
          <label htmlFor="feedback-content">想说什么</label>
          <textarea
            id="feedback-content"
            className="input"
            rows={6}
            maxLength={MAX_CONTENT_LENGTH}
            placeholder="遇到的情况、想要的功能，或者哪里用起来别扭，都可以写在这里。"
            value={content}
            disabled={submitting || readingImages}
            onChange={(e) => {
              const next = e.target.value
              setContent(next)
              onDraftChange({ type, content: next, images })
              setDone(false)
            }}
          />
          <p className="hint">{content.trim().length} / {MAX_CONTENT_LENGTH}</p>
        </div>

        <div className="field">
          <label>截图（可选）</label>
          <input
            ref={fileInputRef}
            style={{ display: 'none' }}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={submitting || readingImages}
            onChange={(e) => void pickImages(e)}
            aria-label="选择截图"
          />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => fileInputRef.current?.click()}
            disabled={submitting || readingImages || images.length >= MAX_IMAGES}
          >
            添加截图
          </button>
          <p className="hint">最多 5 张，单张不超过 5MB，只收 JPG、PNG、WebP。</p>
        </div>

        {images.length > 0 && (
          <div className="field">
            <label>已选的截图（{images.length} / {MAX_IMAGES}）</label>
            <div className="profile-group-card">
              {images.map((image, index) => (
                <div className="entry-row feedback-image-row" key={`${image.name}-${index}`}>
                  <span className="entry-label feedback-image-name">{image.name}</span>
                  <span className="entry-status">{mimeLabel(image.mime)} · {formatBytes(image.bytes)}</span>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => removeImage(index)}
                    disabled={submitting || readingImages}
                    aria-label={`移除 ${image.name}`}
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="settings-actions">
        <button type="button" className="btn btn-primary" onClick={() => void handleSubmit()} disabled={submitting || readingImages}>
          {submitting ? '提交中…' : readingImages ? '正在读取截图…' : '提交'}
        </button>
      </div>

      {done && <p className="test-result success">收到啦，我们会看到。回复会出现在消息与通知里。</p>}
      {error ? <p className="test-result error">{error}</p> : null}
    </div>
  )
}
