import { useState } from 'react'
import { ROLE_TEMPLATES, type RoleTemplate } from '../lib/personaTemplates'
import { savePersona } from '../lib/storage'

interface Props {
  /** 选定角色（模板或自定义）后调用，由 App 跳进聊天页 */
  onDone: () => void
}

/** 自定义人设的引导文案：工具向描述，定稿原文 */
const CUSTOM_PLACEHOLDER = '想让它是什么都可以——包括你的编程搭子、工作助理'

export default function RolePicker({ onDone }: Props) {
  const [customOpen, setCustomOpen] = useState(false)
  const [customText, setCustomText] = useState('')

  const pickTemplate = (t: RoleTemplate) => {
    savePersona(t.persona)
    onDone()
  }

  const startCustom = () => {
    if (!customText.trim()) return
    savePersona(customText)
    onDone()
  }

  return (
    <div className="role-page">
      <div className="role-inner">
        <h1 className="role-title">先选一个 TA，再开始聊</h1>
        <p className="role-sub">仅更换人设性格，历史聊天与记忆不会清除</p>

        <div className="role-templates">
          {ROLE_TEMPLATES.map((t) => (
            <button key={t.id} type="button" className="role-card" onClick={() => pickTemplate(t)}>
              <span className="role-card-name">{t.name}</span>
              <span className="role-card-tagline">{t.tagline}</span>
            </button>
          ))}
        </div>

        <div className="role-custom">
          {customOpen ? (
            <div className="role-custom-open">
              <textarea
                className="input persona-input role-custom-textarea"
                placeholder={CUSTOM_PLACEHOLDER}
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                rows={4}
                autoFocus
              />
              <button
                type="button"
                className="btn btn-primary role-custom-start"
                onClick={startCustom}
                disabled={!customText.trim()}
              >
                开始
              </button>
            </div>
          ) : (
            <button type="button" className="role-custom-toggle" onClick={() => setCustomOpen(true)}>
              自定义
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
