// 自定义人设 · 结构化表单拼接（纯函数，可 Node 单测）
// 表单只是 UI 层拆分：前端把四个字段拼成一段完整 persona 文本，依旧只存 ai_companion_persona 单字段。
// 不新增存储字段、不碰后端。性格必填的校验交给 UI 层，拼接函数本身不抛错。

export const PERSONA_SOFT_LIMIT = 1500
export const PERSONA_HARD_LIMIT = 4000

/**
 * 人设统一字数口径：去掉空白与换行后计字符数。
 * B 的“明显较长”与 C 的软/硬上限必须复用这个函数，避免同一张卡口径漂移。
 */
export function countPersonaCharacters(text: string): number {
  return (text ?? '').replace(/\s/g, '').length
}

/**
 * 保存长度规则：
 * - 新卡 / 正常卡：<= 4000 才能保存；
 * - 存量已超长卡：绝不截断，允许不比当前已保存内容更长（5200→5100 可，5200→5300 不可）。
 */
export function canSavePersonaLength(nextPersona: string, savedPersona = ''): boolean {
  const nextLength = countPersonaCharacters(nextPersona)
  const savedLength = countPersonaCharacters(savedPersona)
  if (nextLength <= PERSONA_HARD_LIMIT) return true
  return savedLength > PERSONA_HARD_LIMIT && nextLength <= savedLength
}

function normalizePersonaName(value: string): string {
  return value
    .trim()
    .replace(/[。；;，,]+$/g, '')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase()
}

function explicitNameFields(persona: string): string[] {
  if (!persona) return []
  const names: string[] = []
  const re = /^\s*(?:姓名|名字)\s*[：:]\s*([^\r\n]+?)\s*$/gm
  for (const match of persona.matchAll(re)) {
    const normalized = normalizePersonaName(match[1] ?? '')
    if (normalized) names.push(normalized)
  }
  return names
}

/**
 * 身份冲突轻提示，只认强信号：
 * 1) 行首/字段式「姓名：」「名字：」出现两个及以上不同值；
 * 2) 「【她心中的我】」「【我】」分节内出现明确姓名，且与主角色名不同。
 *
 * 叙述中的“名字叫……”不算；主角色名为空时只走第 1 条。
 */
export function hasPersonaIdentityConflict(persona: string, primaryName?: string): boolean {
  const distinctNames = new Set(explicitNameFields(persona))
  if (distinctNames.size >= 2) return true

  const primary = normalizePersonaName(primaryName ?? '')
  if (!primary || !persona) return false

  let inTargetSection = false
  for (const rawLine of persona.split(/\r?\n/)) {
    const heading = rawLine.match(/^\s*【([^】]+)】\s*$/)
    if (heading) {
      const title = (heading[1] ?? '').trim()
      inTargetSection = title === '她心中的我' || title === '我'
      continue
    }
    if (!inTargetSection) continue

    const nameMatch = rawLine.match(/^\s*(?:姓名|名字)\s*[：:]\s*(.+?)\s*$/)
    if (!nameMatch) continue
    const sectionName = normalizePersonaName(nameMatch[1] ?? '')
    if (sectionName && sectionName !== primary) return true
  }

  return false
}

export interface CustomPersonaInput {
  /** TA昵称（选填） */
  nickname?: string
  /** 性格特质（必填，UI 层校验） */
  personality: string
  /** 关系&背景设定（选填） */
  background?: string
  /** 开场第一句（选填） */
  opening?: string
}

/**
 * 把结构化表单拼成完整 persona 文本。
 * 输入框为空的条目删掉对应整行，不写入；所有行按固定顺序用换行连接。
 */
export function buildCustomPersona(input: CustomPersonaInput): string {
  const nickname = input.nickname?.trim() ?? ''
  const personality = input.personality?.trim() ?? ''
  const background = input.background?.trim() ?? ''
  const opening = input.opening?.trim() ?? ''

  const lines: string[] = []
  if (nickname) lines.push(`角色昵称：${nickname}`)
  if (personality) lines.push(`性格特质：${personality}`)
  if (background) lines.push(`关系背景：${background}`)
  if (opening) lines.push(`初次见面开场白：${opening}`)
  return lines.join('\n')
}

/**
 * 从 persona 文本里解析「初次见面开场白：xxx」这一行的内容（开场白机制用）。
 * 没有这一行或内容为空 → 返回空串。
 */
export function extractOpeningLine(persona: string): string {
  if (!persona) return ''
  // 容忍行首空白（高级编辑可能贴进来的文本带缩进），只要这行以「初次见面开场白：」开头就算
  const m = persona.match(/^\s*初次见面开场白：(.+)$/m)
  return m ? m[1].trim() : ''
}

/**
 * 自定义表单是否有效：性格特质 trim 后非空。
 * 这里只做基础必填校验；长度由共用计数函数在 UI 保存前统一判断。
 */
export function isCustomPersonaValid(input: { personality?: string }): boolean {
  return (input.personality ?? '').trim() !== ''
}

// ---- 人设字段解析 / 编辑（TASK-UI1：设定弹窗 + TA 资料卡共用） ----

const LINE_LABELS = {
  nickname: '角色昵称',
  personality: '性格特质',
  background: '关系背景',
  opening: '初次见面开场白',
} as const

type PersonaField = keyof typeof LINE_LABELS

/** 读 persona 中某一行标签的内容（行首允许空白；无该行/内容为空返回空串） */
function personaLine(persona: string, field: PersonaField): string {
  if (!persona) return ''
  const m = persona.match(new RegExp(`^\\s*${LINE_LABELS[field]}：(.+)$`, 'm'))
  return m ? m[1].trim() : ''
}

/** 去掉 persona 里指定的几行（按行首标签精确匹配，容忍行首空白） */
function dropPersonaLines(persona: string, fields: PersonaField[]): string {
  if (!persona) return ''
  const labels = fields.map((f) => LINE_LABELS[f])
  return persona
    .split('\n')
    .filter((l) => !labels.some((label) => new RegExp(`^\\s*${label}：`).test(l.trim())))
    .join('\n')
}

/**
 * 从 persona 解析「性格特质」内容（资料卡显示用）：
 * - 结构化人设（自定义，含「性格特质：」行）→ 取该行内容；
 * - 模板原文（无结构化性格行）→ 返回去掉附加的背景/开场白/昵称行后的主体。
 */
export function extractPersonality(persona: string): string {
  const structured = personaLine(persona, 'personality')
  if (structured) return structured
  return dropPersonaLines(persona, ['background', 'opening', 'nickname']).trim()
}

/** 从 persona 解析「关系背景」行内容（无 → 空串） */
export function extractBackgroundLine(persona: string): string {
  return personaLine(persona, 'background')
}

export interface PersonaEdits {
  /** 性格特质正文；不传 = 保持原值，空串 = 删掉该行（模板原文即删掉主体） */
  personality?: string
  /** 关系背景正文；不传 = 保持原值，空串 = 删掉该行 */
  background?: string
  /** 开场第一句正文；不传 = 保持原值，空串 = 删掉该行 */
  opening?: string
}

/**
 * 应用人设编辑，返回新 persona 文本（TASK-UI1 资料卡逐项修改用）。
 * - 结构化人设（自定义：含「性格特质：」行）→ 保留角色昵称行，替换/追加其余行；
 * - 自由文本人设（模板原文：无结构化性格行）→ 主体 = 原文本去掉附加的背景/开场白行，改性格即替换主体。
 * 传 undefined 的字段保持原值，传空字符串 = 删除该行。
 */
export function applyPersonaEdits(persona: string, edits: PersonaEdits): string {
  const structured = /^\s*性格特质：/m.test(persona)
  const background = edits.background !== undefined ? edits.background.trim() : personaLine(persona, 'background')
  const opening = edits.opening !== undefined ? edits.opening.trim() : personaLine(persona, 'opening')

  if (structured) {
    const nickname = personaLine(persona, 'nickname')
    const personality =
      edits.personality !== undefined ? edits.personality.trim() : personaLine(persona, 'personality')
    const lines: string[] = []
    if (nickname) lines.push(`角色昵称：${nickname}`)
    if (personality) lines.push(`性格特质：${personality}`)
    if (background) lines.push(`关系背景：${background}`)
    if (opening) lines.push(`初次见面开场白：${opening}`)
    return lines.join('\n')
  }

  // 自由文本：主体去掉附加行后保留/替换，再追加背景与开场白
  const base = dropPersonaLines(persona, ['background', 'opening', 'nickname'])
  const personality = edits.personality !== undefined ? edits.personality.trim() : base.trim()
  const lines: string[] = []
  if (personality) lines.push(personality)
  if (background) lines.push(`关系背景：${background}`)
  if (opening) lines.push(`初次见面开场白：${opening}`)
  return lines.join('\n')
}
