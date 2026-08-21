import { useRef, type ChangeEvent } from 'react'
import { fileToAvatarDataUrl } from '../lib/avatar'

interface Props {
  options: string[]
  value: string
  onChange: (avatar: string) => void
}

/** 头像选择：emoji 一行 + 上传图片按钮。avatar 存 emoji 或 dataURL */
export default function AvatarPicker({ options, value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const isImage = value.startsWith('data:')

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      onChange(await fileToAvatarDataUrl(file))
    } catch (err) {
      alert(err instanceof Error ? err.message : '图片处理失败，请换一张试试')
    }
  }

  return (
    <div className="avatar-pick-area">
      <div className="avatar-preview">
        {isImage ? <img src={value} alt="头像" /> : <span className="avatar-preview-emoji">{value}</span>}
      </div>
      <div className="avatar-pick-row">
        {options.map((a) => (
          <button
            key={a}
            type="button"
            className={`avatar-pick${!isImage && value === a ? ' active' : ''}`}
            onClick={() => onChange(a)}
          >
            {a}
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-ghost avatar-upload-btn" onClick={() => inputRef.current?.click()}>
        <svg
          className="avatar-upload-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
          <circle cx="12" cy="13.5" r="3.2" />
        </svg>
        上传图片
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={handleFile}
      />
      <p className="hint">上传的图片会自动裁剪成方形小图，只存你浏览器本地</p>
    </div>
  )
}
