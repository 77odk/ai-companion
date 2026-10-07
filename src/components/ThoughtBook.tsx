interface Props {
  onBack: () => void
}

export default function ThoughtBook({ onBack }: Props) {
  return (
    <div className="page space-object-page thought-book-page">
      <header className="space-object-topbar">
        <button type="button" onClick={onBack} className="space-object-back">‹ 返回</button>
        <div>
          <strong>思绪</strong>
          <span>THOUGHTS</span>
        </div>
        <span aria-hidden="true" />
      </header>
      <main className="thought-book-stage" aria-label="TA 的思绪">
        <div className="thought-book-shell">
          <div className="thought-book-cover">
            <span className="thought-book-spine" aria-hidden="true" />
            <span className="thought-book-cover-title">思绪</span>
            <span className="thought-book-cover-sub">TA 自己想过的</span>
          </div>
          <div className="thought-book-empty">
            <p>这里还没有写下新的思绪。</p>
          </div>
        </div>
      </main>
    </div>
  )
}
