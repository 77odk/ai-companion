// 照片墙 · 前端层（TASK-UI-BATCH7，2026-09-10 乔定接口契约）
// - 图片文件本身交给浏览器 HTTP 缓存（后端文件落盘），前端本地只缓存元数据（id/日期/尺寸）。
// - 登录用户：上传走 POST /api/photos，列表走 GET /api/photos，渲染用 GET /api/photos/<id>?token=
// - 未登录（游客）：无 token，图片 dataUrl 直接落本地缓存，渲染直接用，不上云（登录后列表合并云端）
// 后端在乔手上（表 photos + 4 个接口），本文件只碰前端。

export interface PhotoMeta {
  id: string
  sessionId: string
  width: number
  height: number
  createdAt: number
  /** 仅未登录游客本地上传时存在：dataUrl 直接可渲染；登录用户走云端 URL，本地不存图 */
  dataUrl?: string
}

/** 单张上传返回（契约：POST /api/photos → { ok, photo }） */
export interface PhotoUploadResult {
  id: string
  sessionId: string
  width: number
  height: number
  createdAt: number
}

export interface PhotoListResult {
  photos: PhotoUploadResult[]
}

/** 本地元数据缓存 key：按会话隔离（契约：sessionId 必传；无会话兜底全局） */
export function photoKey(sessionId?: string): string {
  return sessionId ? `ai_space_photos_${sessionId}` : 'ai_space_photos_global'
}

/** 读本地照片元数据（损坏/非数组 → 空） */
export function loadLocalPhotos(sessionId?: string): PhotoMeta[] {
  try {
    const raw = localStorage.getItem(photoKey(sessionId))
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (p): p is PhotoMeta =>
        p != null &&
        typeof p.id === 'string' &&
        typeof p.width === 'number' &&
        typeof p.height === 'number' &&
        typeof p.createdAt === 'number',
    )
  } catch {
    return []
  }
}

/** 写本地照片元数据 */
export function saveLocalPhotos(photos: PhotoMeta[], sessionId?: string): void {
  try {
    localStorage.setItem(photoKey(sessionId), JSON.stringify(photos))
  } catch {
    // 配额满（游客本地 dataUrl 可能撑爆）静默失败，不阻塞页面
  }
}

/** 本地追加一张（放最前，createdAt 倒序） */
export function addLocalPhoto(photo: PhotoMeta, sessionId?: string): PhotoMeta[] {
  const next = [photo, ...loadLocalPhotos(sessionId).filter((p) => p.id !== photo.id)]
  saveLocalPhotos(next, sessionId)
  return next
}

/**
 * 本地 + 云端合并：按 id 去重，云端优先（云端有 dataUrl 的覆盖本地）；createdAt 倒序。
 * 契约：列表接口按需拉、不进 /api/sync 同步包，前端在进入照片墙时拉一次合并。
 */
export function mergePhotos(local: PhotoMeta[], cloud: PhotoMeta[]): PhotoMeta[] {
  const byId = new Map<string, PhotoMeta>()
  for (const p of local ?? []) {
    if (p != null && p.id) byId.set(p.id, p)
  }
  for (const c of cloud ?? []) {
    if (c == null || !c.id) continue
    const prev = byId.get(c.id)
    byId.set(c.id, prev && prev.dataUrl && !c.dataUrl ? { ...c, dataUrl: prev.dataUrl } : c)
  }
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt)
}

/** 图片渲染地址：登录用户走云端 URL（token 走 query，契约已确认 getToken 支持） */
export function photoUrl(id: string, token?: string): string {
  const base = 'https://api.eluvin.space'
  if (!token) return `${base}/api/photos/${encodeURIComponent(id)}`
  return `${base}/api/photos/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`
}

/**
 * 等比缩放尺寸（纯函数）：最长边压到 maxSide 以内，不放大、不裁切。
 * 单测覆盖：小图保持、超限等比、恰好等于 maxSide 保持。
 */
export function calcScaleSize(width: number, height: number, maxSide = 1024): { width: number; height: number } {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  const max = Math.max(w, h)
  if (max <= maxSide) return { width: w, height: h }
  const ratio = maxSide / max
  return {
    width: Math.max(1, Math.round(w * ratio)),
    height: Math.max(1, Math.round(h * ratio)),
  }
}

/** 单张图片 → 压缩 dataUrl（浏览器：FileReader + Image + canvas；最长边 ≤1024、jpeg 0.8） */
export function scaleImageToDataUrl(
  file: File | Blob,
  maxSide = 1024,
  quality = 0.8,
): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read-fail'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('decode-fail'))
      img.onload = () => {
        try {
          const { width, height } = calcScaleSize(img.naturalWidth, img.naturalHeight, maxSide)
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('canvas-fail')
          ctx.drawImage(img, 0, 0, width, height)
          const dataUrl = canvas.toDataURL('image/jpeg', quality)
          resolve({ dataUrl, width, height })
        } catch (e) {
          reject(e instanceof Error ? e : new Error('compress-fail'))
        }
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

/** dataUrl 字节数估算（base64 长度 × 0.75）——契约单张上限 4MB，超了不调接口直接提示 */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return dataUrl.length
  return Math.floor((dataUrl.length - comma - 1) * 0.75)
}

// ---- 云端接口（契约，乔实现后端；token 走现有 auth.getToken）----

export interface ApiResult<T> {
  ok: boolean
  status: number
  message: string
  data?: T
}

async function apiRequest<T>(
  path: string,
  token: string,
  options: { method: string; body?: unknown },
): Promise<ApiResult<T>> {
  let resp: Response
  try {
    resp = await fetch(`https://api.eluvin.space${path}`, {
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    return { ok: false, status: 0, message: '网络不通，连不上服务器，请检查网络后重试' }
  }
  if (!resp.ok) {
    let message = `操作失败（HTTP ${resp.status}）`
    try {
      const j = (await resp.json()) as { message?: string }
      if (j && typeof j.message === 'string' && j.message) message = j.message
    } catch {
      // 非 JSON 响应，用兜底文案
    }
    return { ok: false, status: resp.status, message }
  }
  const data = (await resp.json().catch(() => null)) as T | null
  return { ok: true, status: resp.status, message: '', data: data ?? undefined }
}

/** POST /api/photos：{ sessionId, dataUrl, width, height } → { photo } */
export function uploadPhoto(
  token: string,
  sessionId: string,
  dataUrl: string,
  width: number,
  height: number,
): Promise<ApiResult<{ photo: PhotoUploadResult }>> {
  return apiRequest<{ photo: PhotoUploadResult }>('/api/photos', token, {
    method: 'POST',
    body: { sessionId, dataUrl, width, height },
  })
}

/** GET /api/photos?sessionId= → { photos }（createdAt 倒序） */
export function listPhotos(token: string, sessionId: string): Promise<ApiResult<PhotoListResult>> {
  return apiRequest<PhotoListResult>(
    `/api/photos?sessionId=${encodeURIComponent(sessionId)}`,
    token,
    { method: 'GET' },
  )
}
