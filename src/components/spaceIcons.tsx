/* TA 空间 / 资料卡共用的详情页小线条图标（去 emoji，跟全站同一种描边风格）
   P3 从 AISpace 抽出共用：聊天记录 / 动态 / 纪念日入口在资料卡里也要用同一组图标 */

const ChatIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5c-1.36 0-2.66-.32-3.8-.9L3 20l.9-3.7A8.5 8.5 0 1 1 21 11.5z" />
  </svg>
)

const HeartIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
  </svg>
)

const CalendarIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
    <path d="M8 2.5v4M16 2.5v4M3 9h18" />
  </svg>
)

const SearchIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.35-4.35" />
  </svg>
)

const SparkleIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
  </svg>
)

const RefreshIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20 11a8 8 0 1 0-2.34 5.66" />
    <path d="M20 5v6h-6" />
  </svg>
)

/** 相与书（周记）的本子图标 */
const NotebookIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 4h16v16H4z" />
    <path d="M8 2v20" />
    <path d="M11 8h5M11 12h5M11 16h5" />
  </svg>
)

/** 入口列表右侧箭头 › */
const EntryChevron = ({ open = false }: { open?: boolean }) => (
  <svg
    className={`ai-space-entry-chevron${open ? ' ai-space-entry-chevron-open' : ''}`}
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
)

export {
  ChatIcon,
  HeartIcon,
  CalendarIcon,
  SearchIcon,
  SparkleIcon,
  RefreshIcon,
  NotebookIcon,
  EntryChevron,
}
