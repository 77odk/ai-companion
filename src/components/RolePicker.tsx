import { useState } from 'react'
import { ROLE_TEMPLATES, type RoleTemplate } from '../lib/personaTemplates'
import { buildCustomPersona } from '../lib/customPersona'
import {
  savePersona,
  saveAIProfile,
  saveAIRemark,
  saveAIGender,
  type AIGender,
} from '../lib/storage'
import { getToken, isLoggedIn } from '../lib/auth'
import { createSession, patchSession } from '../lib/sessionApi'
import { getActiveSessionId, setActiveSessionId } from '../lib/sessionStore'
import { resolveSessionName, type RolePickMode } from '../lib/sessionFlow'
import AvatarPicker from './AvatarPicker'
import GenderSelect from './GenderSelect'

interface Props {
  /** 选角色页用途：first=首次/游客新建；current=换个TA·当前会话换人设；new=换个TA·开新会话换TA */
  mode: RolePickMode
  /** 会话已建好/换好后调用，由 App 跳进聊天页（游客则触发登录墙）；新建会话时带上标题供 App 头部即时显示 */
  onDone: (info?: { title?: string }) => void
  /** 返回上一页（换 TA 进来退回原页；首次进来退回欢迎页）；不传则不显示返回键 */
  onBack?: () => void
  /** 底部「已有账号直接登录」小字链接：游客点击弹登录墙（登录后按云端会话分流） */
  onLogin?: () => void
}

/** 设定弹窗字段（模板预填 & 自定义共用同一套形态，TASK-UI1） */
interface RoleSetupState {
  avatar: string
  nickname: string
  remark: string
  gender: AIGender
  personality: string
  background: string
  opening: string
}

/** 自定义已确认的表单（含头像/备注/性别，创建失败重试时回填） */
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
const PERSONALITY_PLACEHOLDER = '描述性格、说话习惯，例如：温柔理智、嘴硬心软'
const BACKGROUND_PLACEHOLDER = '你们是什么关系，TA的经历、相处细节'
const OPENING_PLACEHOLDER = 'TA初次和你见面说的第一句话'

/** 模板默认设定：姓名=模板角色名，性别=模板默认，性格=模板人设；头像/备注/背景/开场白留空 */
function templateDefaults(t: RoleTemplate): RoleSetupState {
  return {
    avatar: '',
    nickname: t.charName,
    remark: '',
    gender: t.gender,
    personality: t.persona,
    background: '',
    opening: '',
  }
}

/** 模板人设：性格特质为基底；关系背景/开场第一句填了就追加对应行（不填就用模板自带的） */
function buildTemplatePersona(s: RoleSetupState): string {
  const lines: string[] = []
  const personality = s.personality.trim()
  if (personality) lines.push(personality)
  const background = s.background.trim()
  if (background) lines.push(`关系背景：${background}`)
  const opening = s.opening.trim()
  if (opening) lines.push(`初次见面开场白：${opening}`)
  return lines.join('\n')
}

/** 自定义卡片选中后的标记：表单里性格的前几个字，性格空则固定文案「已设置」 */
function customMarker(form: CustomFormState): string {
  const p = form.personality.trim()
  if (!p) return '已设置'
  return p.length > 8 ? `${p.slice(0, 8)}…` : p
}

export default function RolePicker({ mode, onDone, onBack, onLogin }: Props) {
  // 选中的角色：模板 id 或 'custom'；没选中时【开始】置灰
  const [selected, setSelected] = useState<string | null>(null)
  // 自定义已确认的表单；模板的设定草稿按模板 id 缓存（创建失败重开弹窗不丢编辑）
  const [customForm, setCustomForm] = useState<CustomFormState>(EMPTY_FORM)
  const [templateDraft, setTemplateDraft] = useState<{ state: RoleSetupState; templateId: string } | null>(null)
  // 设定弹窗：template 非 null = 模板模式；null = 自定义模式
  const [setup, setSetup] = useState<{ open: boolean; template: RoleTemplate | null; initial: RoleSetupState } | null>(null)
  // 建/换会话的进行中状态与错误提示（登录用户点「确认使用」后先建后端会话再进聊天）
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const pickTemplate = (t: RoleTemplate) => {
    setSelected(t.id)
  }

  const openCustom = () => {
    setSetup({
      open: true,
      template: null,
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

  const openTemplateSetup = () => {
    if (!selected || selected === 'custom') return
    const t = ROLE_TEMPLATES.find((x) => x.id === selected)
    if (!t) return
    const draft = templateDraft && templateDraft.templateId === t.id ? templateDraft.state : templateDefaults(t)
    setSetup({ open: true, template: t, initial: draft })
  }

  /** 选定后保存：ai_companion_persona 存人设原文，备注/性别存各自 key。
   *  头像/姓名不在这里写——有会话时写该会话自己的 key（角色隔离），见 proceed 里建会话后调用。 */
  const persistSetup = (persona: string) => {
    savePersona(persona)
  }

  /** 把头像/姓名/备注/性别写入目标角色：有会话 → 会话级 key（改 A 不影响 B）；无会话（游客）→ 全局兜底 */
  const saveProfileForSession = (s: RoleSetupState, sessionId?: string) => {
    saveAIProfile({ nickname: s.nickname.trim(), avatar: s.avatar }, sessionId)
    saveAIRemark(s.remark.trim(), sessionId)
    saveAIGender(s.gender, sessionId)
  }

  /**
   * 统一「开始」：全局 persona 仍写一份（兼容过渡期兜底），后续会话以 session.persona 为准。
   * 登录用户按用途建/换会话：current 换当前会话人设（无当前会话则兜底开新会话），first/new 新建会话；
   * 游客不建会话，交给 App 触发登录墙。会话标题用 TA 姓名（取姓名优先）。
   */
  const proceed = async (persona: string, s: RoleSetupState, roleKey: string | null) => {
    if (submitting) return
    if (!persona.trim()) return
    setSubmitting(true)
    setSubmitError(null)
    persistSetup(persona)
    const title = s.nickname.trim() || resolveSessionName(persona, roleKey ?? undefined)
    try {
      let createdTitle: string | undefined
      if (isLoggedIn()) {
        if (mode === 'current') {
          const sid = getActiveSessionId()
          if (sid) {
            const res = await patchSession(getToken(), sid, { persona, title })
            if (!res.ok) throw new Error(res.message)
            // 换人设：头像/姓名写回当前角色自己的 key
            saveProfileForSession(s, sid)
          } else {
            // 极端情况：没有当前会话 → 直接开个新会话换 TA
            const res = await createSession(getToken(), { persona, title })
            if (!res.ok) throw new Error(res.message)
            setActiveSessionId(String(res.data.id))
            createdTitle = res.data.title
            saveProfileForSession(s, String(res.data.id))
          }
        } else {
          // mode 'first' 或 'new'：新建会话进聊天（旧会话完整保留）
          const res = await createSession(getToken(), { persona, title })
          if (!res.ok) throw new Error(res.message)
          setActiveSessionId(String(res.data.id))
          createdTitle = res.data.title
          // 新角色：头像/姓名写入该会话自己的 key（角色隔离，改 A 不影响 B）
          saveProfileForSession(s, String(res.data.id))
        }
      } else {
        // 游客：不建会话，头像/姓名写全局兜底（登录后会按角色隔离）
        saveProfileForSession(s)
      }
      onDone(createdTitle ? { title: createdTitle } : undefined)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '创建会话失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  /** 设定弹窗确认：模板 → 缓存草稿；自定义 → 存表单并选中；都直接建/换会话 */
  const handleSetupConfirm = (s: RoleSetupState) => {
    if (!setup) return
    const template = setup.template
    const isTemplate = template !== null
    if (isTemplate && template) {
      setTemplateDraft({ state: s, templateId: template.id })
    } else {
      setCustomForm({
        nickname: s.nickname,
        personality: s.personality,
        background: s.background,
        opening: s.opening,
        avatar: s.avatar,
        remark: s.remark,
        gender: s.gender,
      })
      setSelected('custom')
    }
    setSetup(null)
    const persona = isTemplate
      ? buildTemplatePersona(s)
      : buildCustomPersona({
          nickname: s.nickname,
          personality: s.personality,
          background: s.background,
          opening: s.opening,
        })
    void proceed(persona, s, isTemplate ? template?.id ?? null : 'custom')
  }

  /** 开始：模板 → 弹设定弹窗预填模板默认值；自定义已确认 → 直接用已存表单开始 */
  const start = () => {
    if (!selected || submitting) return
    if (selected === 'custom') {
      void proceed(
        buildCustomPersona({
          nickname: customForm.nickname,
          personality: customForm.personality,
          background: customForm.background,
          opening: customForm.opening,
        }),
        {
          avatar: customForm.avatar,
          nickname: customForm.nickname,
          remark: customForm.remark,
          gender: customForm.gender,
          personality: customForm.personality,
          background: customForm.background,
          opening: customForm.opening,
        },
        'custom',
      )
      return
    }
    openTemplateSetup()
  }

  return (
    <div className="role-page">
      <div className="role-inner">
        {onBack && (
          <div className="role-topbar">
            <button type="button" className="link-btn ai-space-back" onClick={onBack}>
              ‹ 返回
            </button>
            <span aria-hidden="true" />
          </div>
        )}
        <h1 className="role-title">选择你想要的 TA</h1>
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
        {submitError && <p className="test-result error role-start-error">{submitError}</p>}
        <button
          type="button"
          className="btn btn-primary role-start-btn"
          onClick={start}
          disabled={!selected || submitting}
        >
          {submitting ? '正在创建…' : '开始'}
        </button>
        {onLogin && !isLoggedIn() && (
          <button type="button" className="role-login-link" onClick={onLogin}>
            已有账号直接登录
          </button>
        )}
      </div>

      {setup?.open && (
        <RoleSetupModal
          title={setup.template ? '设定 TA' : '自定义 TA'}
          initial={setup.initial}
          backgroundHint={
            setup.template ? '选填，不填就用模板自带的' : '选填，描述你们的关系与 TA 的经历、相处细节'
          }
          onClose={() => setSetup(null)}
          onConfirm={handleSetupConfirm}
        />
      )}
    </div>
  )
}

/**
 * 设定弹窗：模板预填 / 自定义 共用一套字段（TA头像 / TA姓名 / TA备注 / 性别 / 性格特质 / 关系&背景 / 开场第一句）。
 * 只留表单，高级文本编辑已下线（TASK-UI1）。
 */
function RoleSetupModal({
  title,
  initial,
  backgroundHint,
  onClose,
  onConfirm,
}: {
  title: string
  initial: RoleSetupState
  backgroundHint: string
  onClose: () => void
  onConfirm: (state: RoleSetupState) => void
}) {
  const [form, setForm] = useState<RoleSetupState>(initial)

  const setField = <K extends keyof RoleSetupState>(key: K, value: RoleSetupState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  // TA姓名 + 性格特质 必填，其余选填
  const valid = form.nickname.trim() !== '' && form.personality.trim() !== ''

  return (
    <div className="role-modal-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="role-modal">
        <div className="role-modal-header">
          <h2 className="role-modal-title">{title}</h2>
          <button type="button" className="role-modal-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="role-modal-body">
          <div className="field">
            <label htmlFor="setup-avatar">
              TA头像 <span className="optional-mark">选填</span>
            </label>
            <AvatarPicker value={form.avatar} onChange={(avatar) => setField('avatar', avatar)} kind="ai" />
          </div>
          <div className="field">
            <label htmlFor="setup-nickname">
              TA姓名 <span className="required-mark">必填</span>
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
          </div>
          <div className="field">
            <label htmlFor="setup-remark">
              TA备注 <span className="optional-mark">选填</span>
            </label>
            <input
              id="setup-remark"
              className="input"
              placeholder="比如：TA 喜欢怎么被你称呼、你们之间的小约定"
              value={form.remark}
              onChange={(e) => setField('remark', e.target.value)}
              maxLength={60}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label>
              性别 <span className="required-mark">必填</span>
            </label>
            <GenderSelect value={form.gender} onChange={(g) => setField('gender', g)} />
          </div>
          <div className="field">
            <label htmlFor="setup-personality">
              性格特质 <span className="required-mark">必填</span>
            </label>
            <textarea
              id="setup-personality"
              className="input persona-input"
              placeholder={PERSONALITY_PLACEHOLDER}
              value={form.personality}
              onChange={(e) => setField('personality', e.target.value)}
              rows={3}
            />
          </div>
          <div className="field">
            <label htmlFor="setup-background">
              关系&背景设定 <span className="optional-mark">选填</span>
            </label>
            <textarea
              id="setup-background"
              className="input persona-input"
              placeholder={BACKGROUND_PLACEHOLDER}
              value={form.background}
              onChange={(e) => setField('background', e.target.value)}
              rows={3}
            />
            <p className="hint role-modal-hint">{backgroundHint}</p>
          </div>
          <div className="field">
            <label htmlFor="setup-opening">
              开场第一句 <span className="optional-mark">选填</span>
            </label>
            <input
              id="setup-opening"
              className="input"
              placeholder={OPENING_PLACEHOLDER}
              value={form.opening}
              onChange={(e) => setField('opening', e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>

        <div className="role-modal-footer">
          {!valid && <span className="role-modal-required-hint">请填写 TA 姓名和角色性格</span>}
          <div className="role-modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              取消
            </button>
            <button type="button" className="btn btn-primary" onClick={() => onConfirm(form)} disabled={!valid}>
              确认使用
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
