// 时间展示小工具：相对时间文案

/** 把时间戳变成"刚刚 / N 分钟前 / N 小时前 / N 天前 / N 个月前 / N 年前" */
export function timeAgo(ts: number | undefined): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '很久以前'
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo} 个月前`
  return `${Math.floor(mo / 12)} 年前`
}
