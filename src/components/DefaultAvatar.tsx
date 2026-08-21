interface Props {
  /** 谁的默认头像：用户是一个人形，TA 是一颗心 */
  kind?: 'user' | 'ai'
  className?: string
}

/** 默认头像（没上传图片时的兜底），纯线条 SVG，不用 emoji */
export default function DefaultAvatar({ kind = 'user', className }: Props) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === 'ai' ? (
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
      ) : (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21v-1a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7v1" />
        </>
      )}
    </svg>
  )
}
