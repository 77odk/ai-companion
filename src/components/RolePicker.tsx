import { useState } from 'react'
import { applyRoleTemplatePersonality, ROLE_TEMPLATES, type RoleTemplate, type RoleTemplateCategory } from '../lib/personaTemplates'
import {
  buildCustomPersona,
  canSavePersonaLength,
  countPersonaCharacters,
  hasPersonaIdentityConflict,
  PERSONA_HARD_LIMIT,
  PERSONA_SOFT_LIMIT,
} from '../lib/customPersona'
import {
  savePersona,
  saveAIProfile,
  saveAIRemark,
  saveAIGender,
  type AIGender,
} from '../lib/storage'
import { getToken, isLoggedIn } from '../lib/auth'
import { createSession } from '../lib/sessionApi'
import { getActiveSessionId, setActiveSessionId } from '../lib/sessionStore'
import { resolveSessionName, type RolePickMode } from '../lib/sessionFlow'
import AvatarPicker from './AvatarPicker'
import GenderSelect from './GenderSelect'
import { AIDetail } from './Settings'

interface Props {
  /** first/new = 新建 TA；current = 直接复用现有「TA 的样子」编辑页 */
  mode: RolePickMode
  onDone: (info?: { title?: string; startChat?: boolean }) => void
  onNaturalLogin?: (setup: NaturalSetup) => void
  initialNatural?: NaturalSetup
  initialNaturalError?: string
  onBack?: () => void
  onLogin?: () => void
}

interface RoleSetupState {
  avatar: string
  nickname: string
  remark: string
  gender: AIGender
  personality: string
  background: string
  opening: string
}

type RoleSetupKind = 'natural' | 'custom'

export interface NaturalSetup {
  avatar: string
  nickname: string
  remark: string
  gender: AIGender
}

interface CustomFormState {
  nickname: string
  personality: string
  background: string
  opening: string
  avatar: string
  remark: string
  gender: AIGender
}

const EMPTY_FORM: CustomFormState = {
  nickname: '',
  personality: '',
  background: '',
  opening: '',
  avatar: '',
  remark: '',
  gender: 'unknown',
}

const NICKNAME_PLACEHOLDER = '给 TA 起个名字'
const PERSONALITY_PLACEHOLDER = '例如：慢热、有自己的想法，说话不多，但熟悉以后会变得很亲近'
const BACKGROUND_PLACEHOLDER = '你们是什么关系、怎样认识，或者 TA 有哪些重要经历'
const OPENING_PLACEHOLDER = 'TA 第一次和你见面时，会说什么？'

const TEMPLATE_FILTERS: Array<{ id: 'all' | RoleTemplateCategory; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'lover', label: '恋人' },
  { id: 'friend', label: '朋友' },
  { id: 'companion', label: '陪伴' },
  { id: 'personality', label: '个性' },
]

export default function RolePicker({
  mode,
  onDone,
  onNaturalLogin,
  initialNatural,
  initialNaturalError,
  onBack,
  onLogin,
}: Props) {
  const [customForm, setCustomForm] = useState<CustomFormState>(EMPTY_FORM)
  const [setup, setSetup] = useState<{
    open: boolean
    kind: RoleSetupKind
    initial: RoleSetupState
  } | null>(() =>
    initialNatural
      ? {
          open: true,
          kind: 'natural',
          initial: { ...EMPTY_FORM, ...initialNatural },
        }
      : null,
  )
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(initialNaturalError ?? null)

  // current 不再经过“选模板/换人设”页，直接复用角色详情里的同一套编辑器，避免两个入口抢同一件事。
  if (mode === 'current') {
    return (
      <AIDetail
        sessionId={getActiveSessionId() || undefined}
        onBack={onBack ?? (() => onDone())}
      />
    )
  }

  const openCustom = () => {
    setSubmitError(null)
    setSetup({
      open: true,
      kind: 'custom',
      initial: {
        avatar: customForm.avatar,
        nickname: customForm.nickname,
        remark: customForm.remark,
        gender: customForm.gender,
        personality: customForm.personality,
        background: customForm.background,
        opening: customForm.opening,
      },
    })
  }

  const openNatural = () => {
    setSubmitError(null)
    setSetup({
      open: true,
      kind: 'natural',
      initial: { ...EMPTY_FORM },
    })
  }

  const persistSetup = (persona: string) => {
    savePersona(persona)
  }

  const saveProfileForSession = (s: RoleSetupState, sessionId?: string) => {
    saveAIProfile({ nickname: s.nickname.trim(), avatar: s.avatar }, sessionId)
    saveAIRemark(s.remark.trim(), sessionId)
    saveAIGender(s.gender, sessionId)
  }

  const proceed = async (
    persona: string,
    s: RoleSetupState,
    roleKey: string | null,
    allowEmptyPersona = false,
  ): Promise<boolean> => {
    if (submitting) return false
    if (!allowEmptyPersona && !persona.trim()) return false
    setSubmitting(true)
    setSubmitError(null)
    if (!allowEmptyPersona) persistSetup(persona)

    const title = s.nickname.trim() || resolveSessionName(persona, roleKey ?? undefined)

    try {
      let createdTitle: string | undefined
      if (isLoggedIn()) {
        // current 已在组件顶部直接复用 AIDetail；走到这里的一定是 first/new，只负责新建 TA。
        const res = await createSession(getToken(), { persona, title })
        if (!res.ok) throw new Error(res.message)
        setActiveSessionId(String(res.data.id))
        createdTitle = res.data.title
        // Natural 允许姓名为空，但会话级 profile 也必须有安全称呼，避免只读 ai_profile 的页面出现空名字。
        const profileState = allowEmptyPersona && !s.nickname.trim()
          ? { ...s, nickname: res.data.title?.trim() || 'TA' }
          : s
        saveProfileForSession(profileState, String(res.data.id))
      } else if (allowEmptyPersona) {
        // UI 允许 Natural 名字留空；游客登录链仍需要一个安全标题，内部用 TA 兜底，不把空串交给建会话。
        onNaturalLogin?.({
          avatar: s.avatar,
          nickname: s.nickname.trim() || 'TA',
          remark: s.remark.trim(),
          gender: s.gender,
        })
      } else {
        saveProfileForSession(s)
      }

      if (isLoggedIn() && allowEmptyPersona) persistSetup('')
      onDone(createdTitle || allowEmptyPersona ? { title: createdTitle, startChat: allowEmptyPersona } : undefined)
      return true
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '创建会话失败，请稍后重试')
      return false
    } finally {
      setSubmitting(false)
    }
  }

  const handleSetupConfirm = async (s: RoleSetupState) => {
    if (!setup) return

    if (setup.kind === 'natural') {
      const succeeded = await proceed('', s, null, true)
      if (succeeded) setSetup(null)
      return
    }

    setCustomForm({
      nickname: s.nickname,
      personality: s.personality,
      background: s.background,
      opening: s.opening,
      avatar: s.avatar,
      remark: s.remark,
      gender: s.gender,
    })

    const persona = buildCustomPersona({
      nickname: s.nickname,
      personality: s.personality,
      background: s.background,
      opening: s.opening,
    })
    const succeeded = await proceed(persona, s, 'custom')
    if (succeeded) setSetup(null)
  }

  return (
    <div className="role-page role-choice-page">
      <div className="role-inner">
        {onBack && (
          <div className="role-topbar">
            <button type="button" className="link-btn ai-space-back" onClick={onBack}>
              ‹ 返回
            </button>
            <span aria-hidden="true" />
          </div>
        )}

        <div className="role-choice-heading">
          <p className="role-choice-eyebrow">认识 TA</p>
          <h1 className="role-title">想怎么认识 TA？</h1>
          <p className="role-sub">可以直接开始相处，也可以先告诉 TA，你希望 TA 是什么样的人。</p>
        </div>

        <div className="role-choice-list">
          <button type="button" className="role-choice-card role-choice-card-primary" onClick={openNatural}>
            <span className="role-choice-card-copy">
              <span className="role-choice-card-kicker">从相处开始</span>
              <span className="role-card-name">直接认识 TA</span>
              <span className="role-card-tagline">不预设性格，先从认识开始。TA 会在之后的相处里慢慢形成自己的样子。</span>
            </span>
            <span className="role-choice-chevron" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 6 6 6-6 6" />
              </svg>
            </span>
          </button>

          <button type="button" className="role-choice-card" onClick={openCustom}>
            <span className="role-choice-card-copy">
              <span className="role-choice-card-kicker">从设定开始</span>
              <span className="role-card-name">自定义 TA</span>
              <span className="role-card-tagline">心里已经有一个 TA？从名字、性格和你们的关系开始告诉我们。</span>
            </span>
            <span className="role-choice-chevron" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 6 6 6-6 6" />
              </svg>
            </span>
          </button>
        </div>

        <p className="role-choice-note">模板不会替你决定 TA 是谁，只会在自定义时帮你起个头。</p>
      </div>

      {onLogin && !isLoggedIn() && (
        <button type="button" className="role-login-link role-choice-login" onClick={onLogin}>
          已有账号直接登录
        </button>
      )}

      {setup?.open && (
        <RoleSetupModal
          title={setup.kind === 'natural' ? '认识 TA' : '自定义 TA'}
          kind={setup.kind}
          initial={setup.initial}
          onClose={() => setSetup(null)}
          onConfirm={(state) => void handleSetupConfirm(state)}
          submitting={submitting}
          error={submitError}
        />
      )}
    </div>
  )
}

function RoleSetupModal({
  title,
  kind,
  initial,
  onClose,
  onConfirm,
  submitting,
  error,
}: {
  title: string
  kind: RoleSetupKind
  initial: RoleSetupState
  onClose: () => void
  onConfirm: (state: RoleSetupState) => void
  submitting: boolean
  error: string | null
}) {
  const [form, setForm] = useState<RoleSetupState>(initial)
  const [identityConflictOpen, setIdentityConflictOpen] = useState(false)
  const [identityConflictAcknowledged, setIdentityConflictAcknowledged] = useState(false)
  const [templateLibraryOpen, setTemplateLibraryOpen] = useState(false)
  const [previewTemplate, setPreviewTemplate] = useState<RoleTemplate | null>(null)
  const [pendingTemplate, setPendingTemplate] = useState<RoleTemplate | null>(null)
  const [appliedTemplateName, setAppliedTemplateName] = useState('')
  const [templateCategory, setTemplateCategory] = useState<'all' | RoleTemplateCategory>('all')

  const setField = <K extends keyof RoleSetupState>(key: K, value: RoleSetupState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (key === 'personality') setAppliedTemplateName('')
  }

  const isNatural = kind === 'natural'
  const isCustom = kind === 'custom'
  const customPersona = isCustom ? buildCustomPersona(form) : ''
  const personaLength = isCustom ? countPersonaCharacters(customPersona) : 0
  const personaLengthValid = !isCustom || canSavePersonaLength(customPersona)
  // Natural 的名字明确允许空；自定义仍要求姓名 + 性格，性别保持选填。
  const valid = isNatural
    ? true
    : form.nickname.trim() !== '' && form.personality.trim() !== '' && personaLengthValid
  const visibleTemplates = templateCategory === 'all'
    ? ROLE_TEMPLATES
    : ROLE_TEMPLATES.filter((template) => template.category === templateCategory)

  const applyTemplate = (template: RoleTemplate) => {
    // 回归红线：模板只允许写 personality。其余 6 个字段完全不经过这里。
    setForm((prev) => applyRoleTemplatePersonality(prev, template))
    setAppliedTemplateName(template.name)
    setPendingTemplate(null)
    setPreviewTemplate(null)
    setTemplateLibraryOpen(false)
  }

  const requestTemplate = (template: RoleTemplate) => {
    const existing = form.personality.trim()
    if (existing && existing !== template.persona.trim()) {
      setPendingTemplate(template)
      return
    }
    applyTemplate(template)
  }

  const confirm = () => {
    if (!valid) return
    if (
      isCustom &&
      !identityConflictAcknowledged &&
      hasPersonaIdentityConflict(customPersona, form.nickname)
    ) {
      setIdentityConflictOpen(true)
      return
    }
    onConfirm(form)
  }

  return (
    <div className="role-modal-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="role-modal">
        <div className="role-modal-header">
          <h2 className="role-modal-title">{title}</h2>
          <button type="button" className="role-modal-close" onClick={onClose} aria-label="返回">
            ‹
          </button>
        </div>

        <div className="role-modal-body">
          <p className="role-modal-intro">
            {isNatural
              ? '不用提前决定 TA 是什么样的人，先留下一点认识的线索。'
              : '先写下你已经知道的部分，其余的可以以后慢慢补。'}
          </p>

          <div className="role-edit-section-label">
            <span>01</span>
            <strong>基本信息</strong>
          </div>

          <div className="role-identity-grid">
            <div className="role-avatar-field">
              <AvatarPicker value={form.avatar} onChange={(avatar) => setField('avatar', avatar)} kind="ai" uploadLabel="添加照片" showHint={false} />
            </div>

            <div className="role-identity-fields">
              <div className="field">
                <label htmlFor="setup-nickname">
                  TA姓名 <span className={isNatural ? 'optional-mark' : 'required-mark'}>{isNatural ? '选填' : '必填'}</span>
                </label>
                <input
                  id="setup-nickname"
                  className="input"
                  placeholder={NICKNAME_PLACEHOLDER}
                  value={form.nickname}
                  onChange={(e) => setField('nickname', e.target.value)}
                  maxLength={30}
                  autoComplete="off"
                />
                {isNatural && <p className="hint role-modal-hint">不填也可以，进入聊天后会先用「TA」称呼。</p>}
              </div>

              <div className="field">
                <label htmlFor="setup-remark">TA备注 <span className="optional-mark">选填</span></label>
                <input
                  id="setup-remark"
                  className="input"
                  placeholder="比如只有你会这样叫 TA"
                  value={form.remark}
                  onChange={(e) => setField('remark', e.target.value)}
                  maxLength={60}
                  autoComplete="off"
                />
              </div>
            </div>
          </div>

          <div className="field">
            <label>性别 <span className="optional-mark">选填</span></label>
            <GenderSelect value={form.gender} onChange={(g) => setField('gender', g)} />
            <p className="hint role-modal-hint">选定后会按现有规则锁定；保持「未设定」则不会锁。</p>
          </div>

          {!isNatural && (
            <>
              <div className="role-edit-section-label role-edit-section-label-personality">
                <span>02</span>
                <strong>性格</strong>
              </div>
              <div className="field">
              <label htmlFor="setup-personality" className="role-personality-label">TA 是怎样的人？ <span className="required-mark">必填</span></label>
              <textarea
                id="setup-personality"
                className="input persona-input"
                placeholder={PERSONALITY_PLACEHOLDER}
                value={form.personality}
                onChange={(e) => setField('personality', e.target.value)}
                rows={4}
              />

              <button type="button" className="role-template-entry" onClick={() => setTemplateLibraryOpen(true)}>
                <span className="role-template-entry-copy">
                  <span className="role-template-entry-title">
                    {appliedTemplateName ? `已使用「${appliedTemplateName}」` : '还没想好？从一个人设模板开始'}
                  </span>
                  {appliedTemplateName && <span className="role-template-entry-desc">可以继续修改，或换一个起点。</span>}
                </span>
                <span className="role-template-entry-action">→</span>
              </button>
              </div>
            </>
          )}

          {!isNatural && (
            <>
              <div className="role-edit-section-label role-edit-section-label-relationship">
                <span>03</span>
                <strong>关于你们</strong>
              </div>
              <div className="field">
              <label htmlFor="setup-background">关系与过去 <span className="optional-mark">选填</span></label>
              <textarea
                id="setup-background"
                className="input persona-input"
                placeholder={BACKGROUND_PLACEHOLDER}
                value={form.background}
                onChange={(e) => setField('background', e.target.value)}
                rows={3}
              />
              </div>
            </>
          )}

          {!isNatural && (
            <div className="field">
              <label htmlFor="setup-opening">TA 第一次会和你说什么 <span className="optional-mark">选填</span></label>
              <input
                id="setup-opening"
                className="input"
                placeholder={OPENING_PLACEHOLDER}
                value={form.opening}
                onChange={(e) => setField('opening', e.target.value)}
                autoComplete="off"
              />
            </div>
          )}

          {isCustom && (
            <div className="field">
              <p className="hint">{personaLength} / {PERSONA_HARD_LIMIT}</p>
              {personaLength > PERSONA_SOFT_LIMIT && (
                <p className="hint">人设越长、信息越杂，TA 越容易抓不住重点、混淆身份和关系。</p>
              )}
              {personaLength > PERSONA_HARD_LIMIT && (
                <>
                  <p className="role-modal-required-hint">
                    已超出 {personaLength - PERSONA_HARD_LIMIT} 字，暂时不能确认使用。
                  </p>
                  <p className="hint">可以合并重复描述，把剧情年表改成摘要，并把性格和共同背景分开写。</p>
                </>
              )}
            </div>
          )}
        </div>

        <div className="role-modal-footer">
          {error ? (
            <span className="role-modal-required-hint">{error}</span>
          ) : !valid && !isNatural ? (
            <span className="role-modal-required-hint">请填写 TA 姓名和角色性格</span>
          ) : null}
          <div className="role-modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>取消</button>
            <button type="button" className="btn btn-primary" onClick={confirm} disabled={!valid || submitting}>
              {submitting ? '正在创建…' : isNatural ? '开始认识' : '确认使用'}
            </button>
          </div>
        </div>
      </div>

      {isCustom && templateLibraryOpen && (
        <div
          className="role-template-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={previewTemplate ? `模板预览：${previewTemplate.name}` : '人设模板'}
          onClick={() => {
            setTemplateLibraryOpen(false)
            setPreviewTemplate(null)
          }}
        >
          <div className="role-template-sheet" onClick={(e) => e.stopPropagation()}>
            <span className="role-template-handle" aria-hidden="true" />

            {previewTemplate ? (
              <>
                <div className="role-template-sheet-header">
                  <button type="button" className="role-template-back" onClick={() => setPreviewTemplate(null)}>‹ 返回</button>
                  <span className="role-template-preview-header-spacer" aria-hidden="true" />
                  <button
                    type="button"
                    className="role-template-close"
                    onClick={() => {
                      setTemplateLibraryOpen(false)
                      setPreviewTemplate(null)
                    }}
                    aria-label="关闭模板库"
                  >
                    ×
                  </button>
                </div>

                <div className="role-template-preview">
                  <div className="role-template-preview-title">
                    <h4>{previewTemplate.name}</h4>
                    {previewTemplate.featured && <span className="role-template-badge">推荐</span>}
                  </div>
                  <p className="role-template-preview-tagline">{previewTemplate.tagline}</p>

                  <section className="role-template-preview-section">
                    <h5>人设描述</h5>
                    <p className="role-template-preview-persona">{previewTemplate.persona}</p>
                  </section>

                  <section className="role-template-preview-section">
                    <h5>适合的场景</h5>
                    <div className="role-template-tag-list">
                      {previewTemplate.tags.map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                  </section>

                  <p className="role-template-preserve-note">使用后只替换「性格特质」，姓名、头像、备注、性别、关系背景和开场白都不会改变。</p>
                </div>

                <div className="role-template-sheet-footer">
                  <button type="button" className="btn btn-primary role-template-use" onClick={() => requestTemplate(previewTemplate)}>
                    使用这个模板
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="role-template-sheet-header">
                  <span className="role-template-header-spacer" aria-hidden="true" />
                  <div className="role-template-heading-copy">
                    <h3>从一个起点开始</h3>
                    <p>这些只是起点，之后都可以继续修改。</p>
                  </div>
                  <button type="button" className="role-template-close" onClick={() => setTemplateLibraryOpen(false)} aria-label="关闭模板库">
                    ×
                  </button>
                </div>

                <div className="role-template-filters" role="tablist" aria-label="模板分类">
                  {TEMPLATE_FILTERS.map((filter) => (
                    <button
                      key={filter.id}
                      type="button"
                      role="tab"
                      aria-selected={templateCategory === filter.id}
                      className={`role-template-filter${templateCategory === filter.id ? ' active' : ''}`}
                      onClick={() => setTemplateCategory(filter.id)}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>

                <div className="role-template-list">
                  {visibleTemplates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      className={`role-template-row${template.featured ? ' featured' : ''}`}
                      onClick={() => setPreviewTemplate(template)}
                    >
                      <span className="role-template-row-copy">
                        <span className="role-template-row-title">
                          {template.name}
                          {template.featured && <span className="role-template-badge">推荐</span>}
                        </span>
                        <span className="role-template-row-tagline">{template.tagline}</span>
                      </span>
                      <span className="role-template-row-chevron" aria-hidden="true">›</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {pendingTemplate && (
        <div className="role-template-confirm-overlay" role="dialog" aria-modal="true" aria-label="替换性格特质">
          <div className="role-template-confirm">
            <h3>替换现在的性格特质？</h3>
            <p>使用「{pendingTemplate.name}」会替换当前的性格特质。姓名、头像、备注、性别、关系背景和开场白都不会改变。</p>
            <div className="role-template-confirm-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setPendingTemplate(null)}>取消</button>
              <button type="button" className="btn btn-primary" onClick={() => applyTemplate(pendingTemplate)}>使用模板</button>
            </div>
          </div>
        </div>
      )}

      {identityConflictOpen && (
        <div className="role-modal-overlay" role="dialog" aria-modal="true" aria-label="检查人设身份">
          <div className="role-modal">
            <div className="role-modal-body">
              <p>这张人设里好像出现了两个不同的身份。TA 可能会分不清谁是谁。你可以继续使用，也可以先检查一下人设。</p>
            </div>
            <div className="role-modal-footer">
              <div className="role-modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setIdentityConflictOpen(false)}>回去看看</button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setIdentityConflictAcknowledged(true)
                    setIdentityConflictOpen(false)
                    onConfirm(form)
                  }}
                >
                  知道了
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
