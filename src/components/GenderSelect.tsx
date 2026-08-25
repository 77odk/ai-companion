import { AIGENDER_LABELS, type AIGender } from '../lib/storage'

const OPTIONS: AIGender[] = ['male', 'female', 'unknown']

/** 性别三选一（男/女/未知），设定弹窗与 TA 资料卡共用 */
export default function GenderSelect({ value, onChange }: { value: AIGender; onChange: (g: AIGender) => void }) {
  return (
    <div className="gender-options" role="radiogroup" aria-label="性别">
      {OPTIONS.map((g) => (
        <button
          key={g}
          type="button"
          role="radio"
          aria-checked={value === g}
          className={`gender-option${value === g ? ' active' : ''}`}
          onClick={() => onChange(g)}
        >
          {AIGENDER_LABELS[g]}
        </button>
      ))}
    </div>
  )
}
