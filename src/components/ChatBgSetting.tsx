// 聊天背景设置（2026-08-25 七七拍板：全屏对标微信，选图可缩放）
// 入口：TA 资料卡 → 聊天记录下面一栏 → 聊天背景
// 存储：ai_companion_chat_bg_<sid>（dataURL），空 = 默认背景
import { useRef, useState, type ChangeEvent } from 'react'
import { loadChatBg, saveChatBg } from '../lib/storage'

interface Props {
  sessionId?: string
  onBack: () => void
}

export default function ChatBgSetting({ sessionId, onBack }: Props) {
  const [bg, setBg] = useState<string>(() => loadChatBg(sessionId))
  // 缩放：1 = 原图铺满，可放大（微信式）
  const [zoom, setZoom] = useState<number>(1)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      // 背景图要更清晰，用高质量压缩（avatar 的 128px 太小，这里放宽到 1024）
      const url = await fileToBgDataUrl(file)
      setBg(url)
      setZoom(1)
      setSaved(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片处理失败，请换一张试试')
    }
  }

  const handleSave = () => {
    saveChatBg(bg, sessionId)
    setSaved(true)
    setError(null)
    window.setTimeout(() => setSaved(false), 2000)
  }

  const handleReset = () => {
    setBg('')
    saveChatBg('', sessionId)
    setZoom(1)
  }

  return (
    <div className="page ai-space-page ai-space-page-sub">
      <div className="ai-space-topbar ai-space-sub-bar">
        <button type="button" className="link-btn ai-space-back" onClick={onBack}>
          ‹ 返回
        </button>
        <h2 className="ai-space-sub-title">聊天背景</h2>
        <span className="ai-space-topbar-spacer" aria-hidden="true" />
      </div>

      <div className="chatbg-body">
        {/* 预览：模拟聊天页全屏背景（缩放实时预览） */}
        <div
          className="chatbg-preview"
          style={
            bg
              ? { backgroundImage: `url(${bg})`, backgroundSize: `${zoom * 100}%`, backgroundPosition: 'center' }
              : undefined
          }
        >
          {!bg && <p className="chatbg-preview-empty">还没有背景，选一张喜欢的图吧</p>}
        </div>

        <div className="chatbg-actions">
          <button type="button" className="btn btn-ghost chatbg-upload-btn" onClick={() => inputRef.current?.click()}>
            选择图片
          </button>
          {bg && (
            <>
              <div className="chatbg-zoom-row">
                <span className="chatbg-zoom-label">缩放</span>
                <input
                  type="range"
                  min={1}
                  max={2}
                  step={0.05}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="chatbg-zoom-slider"
                  aria-label="背景缩放"
                />
                <span className="chatbg-zoom-value">{Math.round(zoom * 100)}%</span>
              </div>
              <div className="chatbg-btn-row">
                <button type="button" className="btn btn-ghost" onClick={handleReset}>
                  恢复默认
                </button>
                <button type="button" className="btn btn-primary" onClick={handleSave}>
                  保存
                </button>
              </div>
            </>
          )}
          <p className="chatbg-hint">图片会全屏铺在聊天页后面，气泡照常显示。换设备后背景随账号同步。</p>
        </div>

        {error && <p className="test-result error">{error}</p>}
        {saved && <p className="test-result success">背景已保存</p>}

        <input ref={inputRef} type="file" accept="image/*" onChange={(e) => void handleFile(e)} hidden />
      </div>
    </div>
  )
}

/** 背景图压缩：限宽 1024，JPEG 0.82 质量，保留背景需要的清晰度 */
function fileToBgDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('图片格式不支持'))
      img.onload = () => {
        const maxW = 1024
        const scale = Math.min(1, maxW / img.width)
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('当前浏览器不支持，换个浏览器试试'))
          return
        }
        ctx.drawImage(img, 0, 0, w, h)
        try {
          resolve(canvas.toDataURL('image/jpeg', 0.82))
        } catch {
          reject(new Error('图片处理失败，请换一张试试'))
        }
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}
