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

/** 微信式列表时间（2026-08-26 七七拍板，消息列表用）：今天 → "12:08"；昨天 → "昨天"；一周内 → "周二"；更早 → "8/5" */
export function wechatListTime(ts: number | undefined): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return ''
  const d = new Date(ts)
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ts >= startToday) {
    const hh = d.getHours().toString().padStart(2, '0')
    const mm = d.getMinutes().toString().padStart(2, '0')
    return `${hh}:${mm}`
  }
  const startYesterday = startToday - 86400000
  if (ts >= startYesterday) return '昨天'
  const startWeek = startToday - 6 * 86400000
  if (ts >= startWeek) {
    const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
    return wd
  }
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** 聊天气泡时间（2026-08-26 七七拍板）：今天 → "12:08 PM"；昨天 → "昨天 11:41 PM"；更早 → "8/5 11:41 PM" */
export function chatBubbleTime(ts: number | undefined): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return ''
  const d = new Date(ts)
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  let h12 = d.getHours() % 12
  if (h12 === 0) h12 = 12
  const ampm = d.getHours() < 12 ? 'AM' : 'PM'
  const mm = d.getMinutes().toString().padStart(2, '0')
  const time = `${h12}:${mm} ${ampm}`
  if (ts >= startToday) return time
  const startYesterday = startToday - 86400000
  if (ts >= startYesterday) return `昨天 ${time}`
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`
}
