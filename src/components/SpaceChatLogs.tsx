// 聊天记录子页（P3 从 AISpace 抽出，资料卡里复用）：
// 搜索框 + 日历选日期 + 按天折叠目录（微信式，M7-2），点某天进完整回放。
// 数据只读（消息由外层传入），内部状态全是视图态，组件级复用不复制两份逻辑。

import { useMemo, useState } from 'react'
import {
  calendarMonthRange,
  dayKey,
  getCalendarMonth,
  groupMessagesByDay,
  highlightDayKeys,
  monthLabel,
  searchMessages,
  shiftMonth,
  truncatePreview,
  type DayGroup,
} from '../lib/aiSpaceDetail'
import { stripMemoryMarkers } from '../lib/memory'
import type { StoredMessage } from '../lib/storage'
import { SearchIcon } from './spaceIcons'

interface Props {
  /** 该角色的全部消息（有会话读缓存，无会话读全局） */
  messages: StoredMessage[]
  /** 用户昵称（回放里标注角色名用） */
  yourName: string
  /** TA 的昵称（回放里标注角色名用） */
  aiNickname: string
  /** 返回资料卡 */
  onBack: () => void
}

export default function SpaceChatLogs({ messages, yourName, aiNickname, onBack }: Props) {
  // 聊天记录二级视图：非 null 表示正在看某一天的完整消息
  const [logDayKey, setLogDayKey] = useState<string | null>(null)
  // 搜索关键词 / 日历当前月份 / 目录折叠（null = 默认展开最近 3 天）
  const [chatSearch, setChatSearch] = useState('')
  const [calYear, setCalYear] = useState<number>(() => new Date().getFullYear())
  const [calMonth, setCalMonth] = useState<number>(() => new Date().getMonth())
  const [expandedDays, setExpandedDays] = useState<Set<string> | null>(null)
  // 今天（日历高亮用）：挂载时定一次即可，跨天可随重渲染刷新
  const [todayKey] = useState<string>(() => dayKey(Date.now()))

  const dayGroups = useMemo(() => groupMessagesByDay(messages), [messages])
  const searchHits = useMemo(() => searchMessages(messages, chatSearch), [messages, chatSearch])
  const calHighlight = useMemo(() => new Set(highlightDayKeys(messages)), [messages])
  const calRange = useMemo(() => calendarMonthRange(messages), [messages])

  // 目录折叠：默认展开最近 3 天（dayGroups 日期倒序，前 3 组即最近三天），其余折叠
  const expandedSet = expandedDays ?? new Set(dayGroups.slice(0, 3).map((g) => g.key))
  const toggleDay = (key: string) => {
    const next = new Set(expandedSet)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setExpandedDays(next)
  }
  const expandAllDays = () => setExpandedDays(new Set(dayGroups.map((g) => g.key)))
  const collapseAllDays = () => setExpandedDays(new Set())

  // 日历切月：不早于最早聊天月、不晚于当前月
  const canPrevCal =
    calYear > calRange.minYear || (calYear === calRange.minYear && calMonth > calRange.minMonth)
  const canNextCal =
    calYear < calRange.maxYear || (calYear === calRange.maxYear && calMonth < calRange.maxMonth)
  const goPrevCal = () => {
    if (!canPrevCal) return
    const next = shiftMonth(calYear, calMonth, -1)
    setCalYear(next.year)
    setCalMonth(next.month)
  }
  const goNextCal = () => {
    if (!canNextCal) return
    const next = shiftMonth(calYear, calMonth, 1)
    setCalYear(next.year)
    setCalMonth(next.month)
  }

  const logDay = logDayKey ? dayGroups.find((g) => g.key === logDayKey) ?? null : null
  const isLogView = logDay != null

  /** 日历：当前月网格，有聊天记录的天打圆点，点某天直接进那天回放 */
  function renderCalendar() {
    const weeks = getCalendarMonth(calYear, calMonth)
    return (
      <div className="ai-space-cal">
        <div className="ai-space-cal-head">
          <button
            type="button"
            className="ai-space-cal-nav"
            onClick={goPrevCal}
            disabled={!canPrevCal}
            aria-label="上个月"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <span className="ai-space-cal-title">{monthLabel(calYear, calMonth)}</span>
          <button
            type="button"
            className="ai-space-cal-nav"
            onClick={goNextCal}
            disabled={!canNextCal}
            aria-label="下个月"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
        <div className="ai-space-cal-grid">
          {['一', '二', '三', '四', '五', '六', '日'].map((w, i) => (
            <span key={i} className="ai-space-cal-dow">
              {w}
            </span>
          ))}
          {weeks.flat().map((cell, i) =>
            cell == null ? (
              <span key={`b${i}`} className="ai-space-cal-cell ai-space-cal-blank" aria-hidden="true" />
            ) : (
              <button
                key={cell.key}
                type="button"
                className={`ai-space-cal-cell${calHighlight.has(cell.key) ? ' ai-space-cal-has' : ''}${
                  cell.key === todayKey ? ' ai-space-cal-today' : ''
                }`}
                onClick={() => setLogDayKey(cell.key)}
                disabled={!calHighlight.has(cell.key)}
              >
                <span className="ai-space-cal-day">{cell.day}</span>
                {calHighlight.has(cell.key) && <span className="ai-space-cal-dot" aria-hidden="true" />}
              </button>
            ),
          )}
        </div>
      </div>
    )
  }

  /** 搜索命中列表：日期 + 摘要 + 前后各一条上下文；点结果进那天的回放 */
  function renderSearchResults() {
    if (searchHits.length === 0) {
      return <p className="ai-space-empty">没有找到相关聊天</p>
    }
    return (
      <div className="ai-space-search-results">
        {searchHits.map((hit, i) => {
          const prevText = hit.prev ? truncatePreview(stripMemoryMarkers(hit.prev.content), 20) : ''
          const nextText = hit.next ? truncatePreview(stripMemoryMarkers(hit.next.content), 20) : ''
          return (
            <button
              key={i}
              type="button"
              className="ai-space-search-item"
              onClick={() => setLogDayKey(hit.dayKey)}
            >
              <span className="ai-space-search-item-head">
                <span className="ai-space-search-day">{hit.dayLabel}</span>
                <span className="ai-space-search-summary">
                  {truncatePreview(stripMemoryMarkers(hit.msg.content), 28)}
                </span>
              </span>
              {(hit.prev || hit.next) && (
                <span className="ai-space-search-ctx">
                  {hit.prev && (
                    <span className="ai-space-search-ctx-line">
                      <span className="ai-space-search-ctx-tag">上一条</span>
                      {prevText}
                    </span>
                  )}
                  {hit.next && (
                    <span className="ai-space-search-ctx-line">
                      <span className="ai-space-search-ctx-tag">下一条</span>
                      {nextText}
                    </span>
                  )}
                </span>
              )}
            </button>
          )
        })}
      </div>
    )
  }

  /** 目录里的一天：头部点击展开/收起，展开后看当天消息、可进完整回放 */
  function renderDayGroup(g: DayGroup) {
    const open = expandedSet.has(g.key)
    const recent = g.messages.slice(-4)
    return (
      <div key={g.key} className={`ai-space-dir-day${open ? ' ai-space-dir-day-open' : ''}`}>
        <button type="button" className="ai-space-dir-head" onClick={() => toggleDay(g.key)} aria-expanded={open}>
          <span className="ai-space-dir-name">{g.label}</span>
          <span className="ai-space-dir-preview">{g.preview || '…'}</span>
          <span className="ai-space-dir-count">{g.messages.length} 条</span>
          <svg
            className="ai-space-dir-chevron"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        {open && (
          <div className="ai-space-dir-body">
            {recent.map((m, i) => {
              const isUser = m.role === 'user'
              return (
                <button
                  key={i}
                  type="button"
                  className="ai-space-dir-msg"
                  onClick={() => setLogDayKey(g.key)}
                >
                  <span className="ai-space-dir-msg-role">{isUser ? yourName : aiNickname}</span>
                  <span className="ai-space-dir-msg-text">
                    {truncatePreview(stripMemoryMarkers(m.content), 24)}
                  </span>
                </button>
              )
            })}
            <button type="button" className="ai-space-dir-open" onClick={() => setLogDayKey(g.key)}>
              查看完整回放
              <svg
                className="ai-space-dir-open-chevron"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        )}
      </div>
    )
  }

  /** 聊天记录子页 */
  function renderChatsPage() {
    const searchActive = chatSearch.trim().length > 0
    return (
      <>
        <div className="ai-space-topbar ai-space-sub-bar">
          <button type="button" className="link-btn ai-space-back" onClick={onBack}>
            ‹ 返回
          </button>
          <h2 className="ai-space-sub-title">聊天记录</h2>
          <span className="ai-space-topbar-spacer" aria-hidden="true" />
        </div>

        <div className="ai-space-timeline">
          <div className="ai-space-search">
            <span className="ai-space-search-icon" aria-hidden="true">
              <SearchIcon />
            </span>
            <input
              type="text"
              className="ai-space-search-input"
              value={chatSearch}
              onChange={(e) => setChatSearch(e.target.value)}
              placeholder="搜索聊天内容"
              aria-label="搜索聊天内容"
            />
            {chatSearch && (
              <button
                type="button"
                className="ai-space-search-clear"
                onClick={() => setChatSearch('')}
                aria-label="清空搜索"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </div>

          {searchActive ? (
            renderSearchResults()
          ) : dayGroups.length === 0 ? (
            <p className="ai-space-empty">还没聊过天，去和 TA 说说话吧</p>
          ) : (
            <>
              {renderCalendar()}
              <div className="ai-space-dir-tools">
                <button type="button" className="ai-space-dir-tool" onClick={expandAllDays}>
                  全部展开
                </button>
                <span className="ai-space-dir-tool-sep" aria-hidden="true" />
                <button type="button" className="ai-space-dir-tool" onClick={collapseAllDays}>
                  全部收起
                </button>
              </div>
              <div className="ai-space-day-dir">{dayGroups.map((g) => renderDayGroup(g))}</div>
            </>
          )}
        </div>
      </>
    )
  }

  /** 某一天的回放（聊天记录子页的二级视图，全屏替换） */
  function renderLogView() {
    if (!logDay) return null
    return (
      <div className="ai-space-log">
        <div className="ai-space-topbar ai-space-log-bar">
          <button type="button" className="link-btn ai-space-back" onClick={() => setLogDayKey(null)}>
            ‹ 返回
          </button>
          <h2 className="ai-space-log-title">{logDay.label}</h2>
          <span className="ai-space-topbar-spacer" aria-hidden="true" />
        </div>

        <div className="ai-space-log-list">
          {logDay.messages.map((m, i) => {
            const isUser = m.role === 'user'
            return (
              <div key={i} className={`message-row ${isUser ? 'row-user' : 'row-assistant'}`}>
                <div className="message-body">
                  <span className="ai-space-log-role">{isUser ? yourName : aiNickname}</span>
                  <div className={`bubble ${isUser ? 'bubble-user' : 'bubble-assistant'}`}>
                    <span className="bubble-text">{isUser ? m.content : stripMemoryMarkers(m.content)}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="ai-space-log-foot">
          <button type="button" className="btn btn-ghost" onClick={() => setLogDayKey(null)}>
            返回聊天记录
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`page ai-space-page${isLogView ? ' ai-space-page-log' : ' ai-space-page-sub'}`}>
      {isLogView ? renderLogView() : renderChatsPage()}
    </div>
  )
}
