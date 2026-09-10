import { useMemo } from 'react'
import { getActiveSessionId } from '../lib/sessionStore'
import { getFirstSeen } from '../lib/storage'
import { computeDaysKnown } from '../lib/aiSpaceDetail'
import {
  getAnniversaries,
  pickNextBigDay,
  daysUntilNext,
} from '../lib/anniversary'
import { loadCurrentPosts } from '../lib/aiSpace'
import { timeAgo } from '../lib/time'

interface Props {
  /** 「和 TA 说说话」→ 聊天页 */
  onGoChat: () => void
  /** 「TA 的生活 · 全部」→ TA 空间 */
  onGoSpace: () => void
}

/** 按时段问候（凌晨/早上/上午/中午/下午/晚上/夜深） */
function greeting(now: Date): string {
  const h = now.getHours()
  if (h < 5) return '夜深了'
  if (h < 9) return '早上好'
  if (h < 12) return '上午好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  if (h < 22) return '晚上好'
  return '夜深了'
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 时间戳 → 2026.08.15 */
function fmtFull(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`
}

/** 'MM-DD' → 8月5日；'YYYY-MM-DD' → 2026年8月5日；'YYYY.MM.DD' → 8月5日 */
function fmtDateLabel(date: string): string {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`
  const d = date.match(/^(\d{2})-(\d{2})$/)
  if (d) return `${Number(d[1])}月${Number(d[2])}日`
  const dot = date.match(/^(\d{4})\.(\d{2})\.(\d{2})$/)
  if (dot) return `${Number(dot[2])}月${Number(dot[3])}日`
  return date
}

/** 倒计时天数文案：0=今天，1=明天，正=N天 */
function countdownText(n: number): string {
  if (n <= 0) return '今天'
  if (n === 1) return '明天'
  return `${n}天`
}

export default function Home({ onGoChat, onGoSpace }: Props) {
  const sid = getActiveSessionId() || undefined
  const firstSeen = useMemo(() => getFirstSeen(sid), [sid])
  const days = useMemo(() => computeDaysKnown(firstSeen), [firstSeen])
  const anniversaries = useMemo(() => getAnniversaries(sid), [sid])
  const nextBigDay = useMemo(() => pickNextBigDay(anniversaries), [anniversaries])
  const nextBigDiff = useMemo(
    () => (nextBigDay ? daysUntilNext(nextBigDay) : null),
    [nextBigDay],
  )
  const posts = useMemo(() => loadCurrentPosts(sid), [sid])
  // TA 此刻：优先取事件动态（AI Space v3 生成的生活快照），没有则取最近一条
  const momentPost = useMemo(
    () => posts.find((p) => p.source === 'event') ?? posts[0],
    [posts],
  )
  // TA 的生活：最近一条动态；避免和「此刻」重复，优先取另一条
  const lifePost = useMemo(
    () => posts.find((p) => p.id !== momentPost?.id) ?? posts[0],
    [posts, momentPost],
  )

  return (
    <div className="home-page">
      <div className="home-inner">
        {/* 品牌区 */}
        <div className="home-brand">
          <span className="home-brand-logo" aria-hidden="true">
            忆
          </span>
          <div className="home-brand-text">
            <span className="home-brand-name">忆文</span>
            <span className="home-brand-en">ELUVIN</span>
          </div>
        </div>

        {/* 问候 + 认识天数 */}
        <p className="home-greeting">{greeting(new Date())}</p>
        <h2 className="home-days-title">和 TA 的第 {days} 天</h2>
        <p className="home-days-range">
          {fmtFull(firstSeen)} — 今天
        </p>

        {/* 重要倒计时 */}
        <div className="home-section-head">
          <span className="home-section-title">重要倒计时</span>
          <span className="home-section-en">COUNTDOWNS</span>
        </div>
        <div className="home-countdowns">
          <div className="home-count-card">
            <p className="home-count-label">和 TA 在一起</p>
            <p className="home-count-num">{days}天</p>
            <p className="home-count-sub">从 {fmtDateLabel(fmtFull(firstSeen))} 开始</p>
          </div>
          {nextBigDay && nextBigDiff != null ? (
            <div className="home-count-card">
              <p className="home-count-label">{nextBigDay.label}</p>
              <p className="home-count-num">{countdownText(nextBigDiff)}</p>
              <p className="home-count-sub">{fmtDateLabel(nextBigDay.date)}</p>
            </div>
          ) : (
            <div className="home-count-card">
              <p className="home-count-label">下一个纪念日</p>
              <p className="home-count-num">—</p>
              <p className="home-count-sub">去空间添加</p>
            </div>
          )}
        </div>

        {/* TA 此刻 */}
        <div className="home-section-head">
          <span className="home-section-title">TA 此刻</span>
        </div>
        <p className="home-moment">
          {momentPost ? momentPost.text : 'TA 正过着寻常的一天。'}
        </p>

        {/* 主按钮 */}
        <button type="button" className="btn btn-primary home-chat-btn" onClick={onGoChat}>
          和 TA 说说话
        </button>

        {/* TA 的生活 */}
        <div className="home-life-head">
          <div className="home-section-head">
            <span className="home-section-title">TA 的生活</span>
          </div>
          <button type="button" className="home-more" onClick={onGoSpace}>
            全部 ›
          </button>
        </div>
        {lifePost ? (
          <div className="home-life-card">
            <p className="home-life-text">{lifePost.text}</p>
            <p className="home-life-time">{timeAgo(lifePost.at)}</p>
          </div>
        ) : (
          <div className="home-life-card home-life-empty">
            <p className="home-life-text">TA 还没有分享生活。</p>
            <p className="home-life-time">去空间看看</p>
          </div>
        )}
      </div>
    </div>
  )
}
