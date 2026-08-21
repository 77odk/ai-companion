// 头像图片处理：上传 → canvas 压缩成小尺寸 dataURL（存 localStorage 用）

const AVATAR_SIZE = 128

/**
 * 把上传的图片文件压缩为方形 dataURL。
 * - 居中裁剪成正方形，再缩到 128x128，jpeg 质量 0.82
 * - 结果几 KB~十几 KB，可安全存 localStorage
 * - 失败（非图片/解析不了）抛 Error
 */
export function fileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('请选择图片文件'))
      return
    }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const size = Math.min(img.naturalWidth, img.naturalHeight)
        const sx = (img.naturalWidth - size) / 2
        const sy = (img.naturalHeight - size) / 2

        const canvas = document.createElement('canvas')
        canvas.width = AVATAR_SIZE
        canvas.height = AVATAR_SIZE
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('浏览器不支持图片处理'))
          return
        }
        ctx.drawImage(img, sx, sy, size, size, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      } catch (e) {
        reject(new Error('图片处理失败，请换一张试试'))
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片解析失败，请换一张试试'))
    }
    img.src = url
  })
}
