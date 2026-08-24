import { useState } from 'react'
import { ROLE_TEMPLATES, type RoleTemplate } from '../lib/personaTemplates'
import { savePersona } from '../lib/storage'
import { buildCustomPersona } from '../lib/customPersona'

interface Props {
  /** 选定角色（模板或自定义）后调用，由 App 跳进聊天页 */
  onDone: () => void
}

/** 自定义人设表单字段（对应结构化表单的四项，全是文本，不做字符上限） */
interface CustomFormState {
  nickname: string
  personality: string
  background: string
  opening: string
}

const EMPTY_FORM: CustomFormState = { nickname: '', personality: '', background: '', opening: '' }

/** 表单字段占位提示（定稿原文） */
const FIELD_PLACEHOLDERS = {
  nickname: '给TA起称呼，可留空',
  personality: '描述性格、说话习惯，例如：温柔理智、嘴硬心软',
  background: '你们是什么关系，TA的经历、相处细节',
  opening: 'TA初次和你见面说的第一句话',
}

/** 自定义卡片选中后的标记：表单里性格的前几个字，性格空则固定文案「已设置」 */
function customMarker(form: CustomFormState): string {
  const p = form.personality.trim()
  if (!p) return '已设置'
  return p.length > 8 ? `${p.slice(0, 8)}…` : p
}

export default function RolePicker({ onDone }: Props) {
  // 选中的角色：模板 id 或 'custom'；没选中时【开始】置灰
  const [selected, setSelected] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [customForm, setCustomForm] = useState<CustomFormState>(EMPTY_FORM)
  // 自定义已确认的完整 persona；customFromAdvanced 标记它来自高级编辑（表单与高级编辑各管各的）
  const [customPersona, setCustomPersona] = useState('')
  const [customFromAdvanced, setCustomFromAdvanced] = useState(false)

  const pickTemplate = (t: RoleTemplate) => {
    setSelected(t.id)
  }

  const openCustom = () => setModalOpen(true)

  /** 统一「开始」：把选中的角色写进 persona 再进聊天 */
  const start = () => {
    if (!selected) return
    if (selected === 'custom') {
      savePersona(customPersona || buildCustomPersona(customForm))
    } else {
      const t = ROLE_TEMPLATES.find((x) => x.id === selected)
      if (t) savePersona(t.persona)
    }
    onDone()
  }

  const handleCustomConfirm = (form: CustomFormState, persona: string, fromAdvanced: boolean) => {
    setCustomForm(form)
    setCustomPersona(persona)
    setCustomFromAdvanced(fromAdvanced)
    setSelected('custom')
    setModalOpen(false)
  }

  return (
    <div className="role-page">
      <div className="role-inner">
        <h1 className="role-title">先选一个 TA，再开始聊</h1>
        <p className="role-sub">仅更换人设性格，历史聊天与记忆不会清除</p>

        <div className="role-templates">
          {ROLE_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`role-card${selected === t.id ? ' selected' : ''}`}
              onClick={() => pickTemplate(t)}
            >
              <span className="role-card-name">{t.name}</span>
              <span className="role-card-tagline">{t.tagline}</span>
            </button>
          ))}
        </div>

        <div className="role-custom">
          <button
            type="button"
            className={`role-custom-toggle${selected === 'custom' ? ' selected' : ''}`}
            onClick={openCustom}
          >
            <span>自定义</span>
            {selected === 'custom' && <span className="role-custom-marker">{customMarker(customForm)}</span>}
          </button>
        </div>
      </div>

      <div className="role-start-bar">
        <button type="button" className="btn btn-primary role-start-btn" onClick={start} disabled={!selected}>
          开始
        </button>
      </div>

      {modalOpen && (
        <CustomRoleModal
          initialForm={customForm}
          initialPersona={customPersona}
          initialFromAdvanced={customFromAdvanced}
          onClose={() => setModalOpen(false)}
          onConfirm={handleCustomConfirm}
        />
      )}
    </div>
  )
}

/**
 * 自定义角色 · 全屏弹窗：四个字段全部选填（仅性格特质必填）。
 * 高级文本编辑与表单「各管各的」：高级编辑保存后表单字段不回写；
 * 表单里的小字提示「手动编辑后，表单修改会覆盖高级编辑内容」。
 */
function CustomRoleModal({
  initialForm,
  initialPersona,
  initialFromAdvanced,
  onClose,
  onConfirm,
}: {
  initialForm: CustomFormState
  initialPersona: string
  initialFromAdvanced: boolean
  onClose: () => void
  onConfirm: (form: CustomFormState, persona: string, fromAdvanced: boolean) => void
}) {
  const [form, setForm] = useState<CustomFormState>(initialForm)
  // 表单是否有改动：改了之后高级编辑预览就以表单拼接为准（覆盖高级编辑内容）
  const [formDirty, setFormDirty] = useState(false)
  const [view, setView] = useState<'form' | 'advanced'>('form')
  const [advancedDraft, setAdvancedDraft] = useState('')

  const setField = (key: keyof CustomFormState, value: string) => {
    setFormDirty(true)
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const openAdvanced = () => {
    // 高级编辑预览：来自高级编辑且表单没改过 → 沿用已确认的高级原文；
    // 否则按当前表单重新拼接（表单改动会覆盖高级编辑内容）
    setAdvancedDraft(!formDirty && initialFromAdvanced ? initialPersona : buildCustomPersona(form))
    setView('advanced')
  }

  const confirmForm = () => {
    onConfirm(form, buildCustomPersona(form), false)
  }

  const confirmAdvanced = () => {
    onConfirm(form, advancedDraft.trim(), true)
  }

  const valid = form.personality.trim() !== ''

  return (
    <div className="role-modal-overlay" role="dialog" aria-modal="true" aria-label="自定义 TA">
      <div className="role-modal">
        <div className="role-modal-header">
          <h2 className="role-modal-title">自定义 TA</h2>
          <button type="button" className="role-modal-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="role-modal-body">
          {view === 'form' ? (
            <>
              <div className="field">
                <label htmlFor="custom-nickname">TA昵称</label>
                <input
                  id="custom-nickname"
                  className="input"
                  placeholder={FIELD_PLACEHOLDERS.nickname}
                  value={form.nickname}
                  onChange={(e) => setField('nickname', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="custom-personality">
                  性格特质 <span className="required-mark">必填</span>
                </label>
                <textarea
                  id="custom-personality"
                  className="input persona-input"
                  placeholder={FIELD_PLACEHOLDERS.personality}
                  value={form.personality}
                  onChange={(e) => setField('personality', e.target.value)}
                  rows={3}
                />
              </div>
              <div className="field">
                <label htmlFor="custom-background">关系&背景设定</label>
                <textarea
                  id="custom-background"
                  className="input persona-input"
                  placeholder={FIELD_PLACEHOLDERS.background}
                  value={form.background}
                  onChange={(e) => setField('background', e.target.value)}
                  rows={3}
                />
              </div>
              <div className="field">
                <label htmlFor="custom-opening">开场第一句</label>
                <input
                  id="custom-opening"
                  className="input"
                  placeholder={FIELD_PLACEHOLDERS.opening}
                  value={form.opening}
                  onChange={(e) => setField('opening', e.target.value)}
                />
              </div>
              <p className="hint role-modal-hint">手动编辑后，表单修改会覆盖高级编辑内容</p>
              <button type="button" className="btn btn-ghost role-modal-advanced-btn" onClick={openAdvanced}>
                高级文本编辑
              </button>
            </>
          ) : (
            <>
              <p className="hint">拼接完成后的完整人设原文，可自由修改</p>
              <textarea
                className="input persona-input role-modal-advanced"
                value={advancedDraft}
                onChange={(e) => setAdvancedDraft(e.target.value)}
                rows={12}
                autoFocus
              />
            </>
          )}
        </div>

        <div className="role-modal-footer">
          {view === 'form' ? (
            <>
              {!valid && <span className="role-modal-required-hint">请填写角色性格</span>}
              <div className="role-modal-actions">
                <button type="button" className="btn btn-ghost" onClick={onClose}>
                  取消
                </button>
                <button type="button" className="btn btn-primary" onClick={confirmForm} disabled={!valid}>
                  确认使用
                </button>
              </div>
            </>
          ) : (
            <div className="role-modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setView('form')}>
                返回
              </button>
              <button type="button" className="btn btn-primary" onClick={confirmAdvanced} disabled={!advancedDraft.trim()}>
                保存
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
