interface Props {
  label?: string
  count?: string
  date?: string
  dateValue?: string
  onView: () => void
}

export default function HomeAnniversary({ label, count, date, dateValue, onView }: Props) {
  return (
    <section className="home-anniversary" aria-label="重要日期">
      <span className="home-eyebrow">IMPORTANT DATE</span>
      {label ? (
        <>
          <h2>{label}</h2>
          <strong>{count}</strong>
          <time dateTime={dateValue?.length === 5 ? `--${dateValue}` : dateValue}>{date}</time>
        </>
      ) : (
        <>
          <h2>属于你们的重要日子</h2>
          <strong>慢慢写下</strong>
          <span className="home-anniversary-empty">每一天都算数</span>
        </>
      )}
      <button type="button" className="home-anniversary-view" onClick={onView}>查看</button>
    </section>
  )
}
